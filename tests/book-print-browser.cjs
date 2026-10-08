/* Native print isolation and actual Chromium PDF, using anonymous local data only.
 * Native app button is tested with the final print-dialog method captured; the PDF
 * is generated separately by Chromium printToPDF, not claimed as a user save. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Print = require('../assets/life/book-print.js');
const { playwright, makeContext, observe } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { fixture, seedBooks, openBook, current, oldBody, latestBody, manuscript } = require('./book-projects-browser.cjs');
const out = path.resolve('.local/book-print');
const hostile = '<img src="https://example.invalid/image" onerror="globalThis.__injected=true"><script>globalThis.__injected=true</script>';
function projection() {
  const evidence = { versionId: 'exact_version_2016', missing: false, title: '첫 일을 고르며 남긴 생각', url: 'https://example.invalid/old',
    originalCreatedAt: '2016-03-14', originalAuthor: { label: '익명 작성자', relation: 'self' }, coverage: { status: 'partial', omissions: ['사진 미보관'] },
    versionNumber: 1, versionTotal: 2, hasBody: true, body: oldBody };
  const paragraphs = Array.from({ length: 60 }, (_, index) => `문단${String(index + 1).padStart(3, '0')} 그때의 글을 다시 읽으며 내가 고른 기준을 살펴본다. 잘 해내는 사람이 되고 싶었던 마음과 오래 좋아하는 일을 찾고 싶었던 마음은 서로 달랐다. 빈 시간도 내가 지나온 시간의 일부로 남긴다.`);
  return { title: '스무 살 무렵의 선택을 다시 읽는 책', fromYear: '2016', toYear: '2025', question: '그때의 선택과 지금의 해석 사이에는 무엇이 남아 있을까?', includeSources: true,
    chapters: [
      { title: '처음 일을 고르던 때', note: paragraphs.join('\n\n') + '\n\n문단끝060 고른 기준을 잊지 않기 위해 남긴 마지막 문장.', evidence: [evidence],
        insights: [{ statement: '남의 평가보다 내가 오래 좋아할 조건을 묻고 싶었다.', uncertainty: '당시에 적지 않은 이유는 지금 확정할 수 없다.', supportEvidence: [evidence], counterEvidence: [{ versionId: 'missing_version', missing: true }] }] },
      { title: '둘째장경계 쉬는 시간을 다시 이해하기', note: '둘째장첫문장 쉬는 동안에도 달라진 취향과 기준을 적어 본다.\n\n마크다운은 **굵게** 표시하지 않고 원고 그대로 읽는다.\n\n' + hostile,
        evidence: [], insights: [] }
    ] };
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), browser: browser.version(), scope: 'Linux Chromium real PDF generation and Korean text extraction; anonymous actual app print-button capture. Not Apple hardware, native iOS dialog or user Save PDF confirmation.', checks: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, operatingRemoteWrites: 0 };
  async function check(name, run) { try { await run(); report.checks.push({ name, pass: true }); console.log('PASS ' + name); } catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); } }
  try {
    await check('real A4 PDF preserves selectable Korean, whole text, chapter pagination and literal hostile text with no external request', async () => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
      try {
        await context.route('**/*', route => { report.external.push(route.request().url()); return route.abort('blockedbyclient'); });
        const page = await context.newPage(); observe(page, report, 'PDF');
        const value = projection(), html = Print.document(value); await fs.writeFile(path.join(out, 'anonymous-book.html'), html);
        await page.setContent(html); await page.evaluate(() => document.fonts.ready); await page.emulateMedia({ media: 'print' });
        assert.equal(await page.locator('script,img,iframe,a,link,object').count(), 0); assert.equal(await page.evaluate(() => !!globalThis.__injected), false);
        assert((await page.locator('body').textContent()).includes(hostile)); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const pdf = path.join(out, 'anonymous-book.pdf'); await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
        const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' }); await fs.writeFile(path.join(out, 'anonymous-book.txt'), text);
        const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' }), pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
        assert(pages >= 3); const dimensions = info.match(/Page size:\s+([\d.]+) x ([\d.]+) pts \(A4\)/);
        assert(dimensions && Math.abs(Number(dimensions[1]) - 595.28) < 1 && Math.abs(Number(dimensions[2]) - 841.89) < 1);
        const sheets = text.split('\f').filter(sheet => sheet.trim()), chapterAt = sheets.findIndex(sheet => sheet.includes('둘째장경계'));
        assert(chapterAt > 0); assert(!sheets[chapterAt - 1].includes('둘째장첫문장'));
        const lines = sheets[chapterAt].split('\n').map(line => line.trim()).filter(Boolean);
        assert(lines.slice(0, 3).some(line => line.includes('둘째장경계')), 'Second chapter starts at the top of a new page');
        for (let i = 1; i <= 60; i++) assert(text.includes('문단' + String(i).padStart(3, '0')), 'No missing paragraph ' + i);
        const sheetText = sheets.map(sheet => sheet.replace(/\s/g, ''));
        for (const paragraph of value.chapters[0].note.split('\n\n')) assert(sheetText.some(sheet => sheet.includes(paragraph.replace(/\s/g, ''))), 'Short paragraphs must not leave an orphan line across a page boundary');
        for (const token of ['문단끝060', '선택 버전: 1/2', 'exact_version_2016', '사진 미보관', '연결된 원문 없음', '마크다운은 **굵게**', 'globalThis.__injected=true', '둘째장첫문장']) assert(text.includes(token), token);
        const normalized = text.replace(/\s/g, ''); assert(normalized.includes(oldBody.replace(/\s/g, ''))); assert(!text.includes(latestBody));
        // Type 3 emoji rasterization warnings are recorded separately from browser errors.
        const { spawnSync } = require('node:child_process'); report.pdfToolWarnings = [];
        for (const [at, name] of [[1, 'pdf-first-page'], [chapterAt + 1, 'pdf-next-chapter']]) {
          const result = spawnSync('pdftoppm', ['-f', String(at), '-singlefile', '-scale-to', '1500', '-png', pdf, path.join(out, name)], { encoding: 'utf8' });
          assert.equal(result.status, 0); if (result.stderr.trim()) report.pdfToolWarnings.push({ page: at, message: result.stderr.trim() });
        }
        report.pdf = { filename: 'anonymous-book.pdf', pages, chapterTwoPage: chapterAt + 1, a4: true, koreanSelectable: true, all60ParagraphsPresent: true, requests: 0 };
      } finally { await context.close(); }
    });
    await check('real native window.print can be requested from the sandboxed isolated iframe and cancelled afterward', async () => {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      try {
        await context.route('**/*', route => { report.external.push(route.request().url()); return route.abort('blockedbyclient'); });
        const page = await context.newPage(); observe(page, report, 'native iframe'); await page.setContent('<!doctype html><html lang="ko"><body><button>인쇄</button></body></html>');
        await page.addScriptTag({ path: path.resolve('assets/life/book-print.js') });
        const result = await page.evaluate(async value => { const requested = await HaedoLife.BookPrint.print(value, { isCurrent: () => true }); HaedoLife.BookPrint.cancel(); return { requested, frames: document.querySelectorAll('iframe').length }; }, projection());
        assert.deepEqual(result, { requested: { requested: true }, frames: 0 });
      } finally { await context.close(); }
    });
    await check('actual app print button flushes and projects only the selected book; original-body option is explicit and no state or remote upload changes', async () => {
      const server = new FakeCloud(), context = await makeContext(browser, server, 'book-print', accounts.a, { viewport: { width: 390, height: 844 }, hasTouch: true });
      try {
        await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push(url.origin); return route.abort('blockedbyclient'); });
        const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, 'app print');
        const f = await fixture(page), seed = await seedBooks(page, f); await openBook(page, seed.books[0].id);
        await page.evaluate(() => {
          window.__printCaptures = [];
          const create = document.createElement.bind(document);
          document.createElement = function (tag, options) {
            const frame = create(tag, options); if (String(tag).toLowerCase() !== 'iframe') return frame;
            const add = frame.addEventListener.bind(frame);
            frame.addEventListener = function (type, listener, settings) {
              if (type !== 'load') return add(type, listener, settings);
              return add(type, function (event) {
                if (frame.contentDocument?.documentElement?.dataset.haedoPrint === 'v1') frame.contentWindow.print = function () {
                  window.__printCaptures.push({ html: frame.contentDocument.documentElement.outerHTML, text: frame.contentDocument.body.textContent });
                  frame.contentWindow.dispatchEvent(new Event('afterprint'));
                };
                return listener.call(this, event);
              }, settings);
            }; return frame;
          };
        });
        await page.locator('#wbBookPreviewOpen').click(); await page.locator('#wbBookPreview').waitFor(); const before = await current(page);
        await page.locator('#wbBookPrint').focus(); await page.keyboard.press('Enter'); await page.waitForFunction(() => __printCaptures.length === 1);
        const first = await page.evaluate(() => __printCaptures[0]); assert(first.text.includes(manuscript)); assert(first.text.includes(seed.books[0].title)); assert(!first.text.includes(oldBody));
        for (const token of [seed.books[1].title, '두 번째 책의 독립 원고.', latestBody, 'UNSELECTED_BOOK_PRIVATE', f.workspaceId, accounts.a.id]) assert(!first.html.includes(token), token);
        await page.locator('#wbBookPreviewOptions > summary').click(); await page.locator('#wbBookPreviewIncludeSources').check(); await page.locator('#wbBookPrint').tap(); await page.waitForFunction(() => __printCaptures.length === 2);
        const second = await page.evaluate(() => __printCaptures[1]); assert(second.text.replace(/\r/g, '').includes(oldBody.replace(/\r/g, ''))); assert(!second.text.includes(latestBody));
        assert.deepEqual(await current(page), before); assert.equal(server.writes().length, 0); assert.equal(await page.locator('iframe[data-book-print]').count(), 0);
        await page.screenshot({ path: path.join(out, 'app-print-preview-390.png'), fullPage: false });
        await fs.writeFile(path.join(out, 'app-selected-book.html'), second.html);
        report.app = { viewport: 390, keyboard: true, touch: true, requestedTwice: true, defaultBodyOff: true, nativeDialogMethodCaptured: true, storageUnchanged: true, remoteWrites: 0 };
      } finally { await context.close(); }
    });
    report.pass = report.checks.every(check => check.pass) && !report.consoleErrors.length && !report.pageErrors.length && !report.external.length;
  } finally { await browser.close(); report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify({ checks: report.checks.length, passed: report.checks.filter(check => check.pass).length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length, pdf: report.pdf, report: path.join(out, 'browser-report.json') }));
  if (!report.pass) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

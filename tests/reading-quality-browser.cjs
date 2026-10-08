/* Anonymous search → exact reader → excerpt → search return regression.
 * BASE_URL=http://127.0.0.1:4184 PW_MODULE_PATH=... node tests/reading-quality-browser.cjs
 * READING_QUALITY_BASELINE=1 captures existing behavior without new UX assertions.
 * Chromium viewport simulation is not real Apple-device validation. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, base } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, observe } = require('./unified-home-browser.cjs');
const baseline = process.env.READING_QUALITY_BASELINE === '1';
const out = path.resolve(__dirname, '../.local/reading-quality', baseline ? 'before' : 'after');
const quote = '같은 구절을 다시 읽으며🌱';
const raw = Array.from({ length: 24 }, (_, index) => `산책 기록 ${index + 1}. 정원에서 나무와 빛의 간격을 천천히 살폈다. 서두르지 않고 오래 보니 지나쳤던 모습도 기억에 남는다. ${quote} 다음 산책에서 무엇이 달라지는지 확인하고 싶다.`).join('\r\n\r\n');
const newer = '최신 버전에서는 다음 주 산책 일정만 정리했다.';
async function current(page) { return page.evaluate(async () => HaedoLife.Shell.storage.read(await HaedoLife.Shell.storage.getActive())); }
async function seed(page) {
  await page.goto(base + '/index.html?section=records'); await ready(page); await settle(page);
  return page.evaluate(async ({ raw, newer }) => {
    const storage = HaedoLife.Shell.storage, core = HaedoLife.Core;
    let bundle = await storage.read(await storage.getActive());
    for (let index = 0; index < 18; index++) {
      const imported = await core.prepareImport({ origin: 'apple_notes', title: '품질 원문 ' + String(index + 1).padStart(2, '0'), text: raw, forceSeparate: true }, bundle);
      imported.version.importedAt = '2026-10-01T09:00:' + String(index).padStart(2, '0') + '.000Z';
      const result = await storage.commitLocal({ workspaceId: bundle.workspaceId, baseRevision: bundle.revision, operationId: core.id(), changes: core.buildImportChanges(bundle, imported) });
      if (result.status !== 'stored') throw new Error('Anonymous reading fixture failed');
      bundle = await storage.read(bundle.workspaceId);
    }
    // A matching note also exposes its exact earlier version without inventing
    // a source-body location for the note's words. Latest bodies differ.
    for (const source of bundle.sources) {
      const version = bundle.sourceVersions.find(item => item.sourceId === source.id);
      const now = '2026-10-01T09:00:00.000Z';
      const record = { id: core.id(), kind: 'excerpt', text: raw.slice(0, 6), topic: '', note: '품질 원문 검색 참고', sourceRefs: [{ sourceId: source.id, sourceVersionId: version.id, locator: { start: 0, end: 6 } }], provenance: { kind: 'user' }, revision: 1, createdAt: now, updatedAt: now };
      const recorded = await storage.commitLocal({ workspaceId: bundle.workspaceId, baseRevision: bundle.revision, operationId: core.id(), changes: { put: { records: [record] } } });
      if (recorded.status !== 'stored') throw new Error('Anonymous reading note failed');
      bundle = await storage.read(bundle.workspaceId);
      const imported = await core.prepareImport({ origin: 'apple_notes', title: source.title, text: newer, existingSourceId: source.id }, bundle);
      const result = await storage.commitLocal({ workspaceId: bundle.workspaceId, baseRevision: bundle.revision, operationId: core.id(), changes: core.buildImportChanges(bundle, imported) });
      if (result.status !== 'stored') throw new Error('Anonymous reading version failed');
      bundle = await storage.read(bundle.workspaceId);
    }
    return bundle.workspaceId;
  }, { raw, newer });
}
async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), baseline, browser: browser.version(), checks: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, realRemoteWrites: 0 };
  try {
    for (const size of [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }]) {
      const name = 'note search → older reader → exact excerpt → return ' + size.width;
      const server = new FakeCloud(), context = await makeContext(browser, server, 'reading-quality-' + size.width, undefined, { viewport: size, hasTouch: size.width <= 820 });
      const page = await context.newPage(); page.setDefaultTimeout(15000); observe(page, report, name);
      try {
        await seed(page); await page.reload(); await ready(page); await settle(page);
        await page.locator('#lifeSearch').fill('품질 원문');
        await page.locator('#lifeFilterToggle').click(); await page.locator('#lifeOriginFilter').selectOption('apple_notes');
        const target = page.locator('.life-source-card[data-matched-by="note"] .life-source-open').last(), versionId = await target.getAttribute('data-version-id'), sourceId = await target.getAttribute('data-source-id');
        await target.scrollIntoViewIfNeeded();
        await target.evaluate(el => { window.__readingListY = scrollY; window.__readingFocusKey = el.dataset.focusKey; });
        const before = await current(page); await page.screenshot({ path: path.join(out, 'list-' + size.width + '.png') });
        await target.click(); await page.locator('#lifeSourceText').waitFor(); await page.waitForTimeout(80);
        const entry = await page.evaluate(() => ({ listY: __readingListY, readerY: scrollY, headingY: document.querySelector('.life-reader-heading').getBoundingClientRect().top }));
        report.observations ||= []; report.observations.push({ width: size.width, ...entry });
        assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
        assert.equal(await page.locator('#lifeVersion').inputValue(), versionId);
        await page.screenshot({ path: path.join(out, 'reader-entry-' + size.width + '.png') });
        if (!baseline) assert.equal(entry.readerY, 0, 'A result without a source-body location must start at the source heading');
        await page.locator('#lifeExcerptToggle').click();
        const save = page.getByRole('button', { name: '선택 구절 모음에 추가', exact: true });
        const emptySaveDisabled = await save.isDisabled();
        if (!baseline) assert.equal(emptySaveDisabled, true, 'Empty selection should explain itself before an invalid save');
        await page.getByRole('button', { name: '발췌 닫기', exact: true }).click();
        await page.locator('#lifeSourceText').evaluate((el, quote) => {
          el.focus({ preventScroll: true }); const start = el.textContent.indexOf(quote, Math.floor(el.textContent.length / 2)), range = document.createRange();
          range.setStart(el.firstChild, start); range.setEnd(el.firstChild, start + quote.length);
          getSelection().removeAllRanges(); getSelection().addRange(range);
          const rect = range.getBoundingClientRect(); scrollTo(0, scrollY + rect.top - innerHeight / 3);
          el.dispatchEvent(new Event('pointerup', { bubbles: true })); window.__readingSelectedY = scrollY;
        }, quote);
        await page.locator('#lifeExcerptToggle').evaluate(el => el.addEventListener('pointerdown', () => { window.__readingSelectedY = scrollY; }, { once: true }));
        await page.locator('#lifeExcerptToggle').click(); await page.locator('#lifeSourceTopic').fill('산책'); await page.locator('#lifeSourceNote').fill('두 번째로 만난 문장을 보관한다.');
        assert.equal(await page.locator('#lifeSelectedQuote').textContent(), quote); assert.equal(await save.isEnabled(), true);
        await page.screenshot({ path: path.join(out, 'excerpt-' + size.width + '.png') });
        await save.click(); await settle(page); await page.locator('#lifeSourceText').waitFor();
        report.observations.at(-1).savedPosition = await page.evaluate(() => ({ expected: __readingSelectedY, actual: scrollY }));
        await page.waitForFunction(() => Math.abs(scrollY - __readingSelectedY) <= 2);
        assert.equal(await page.evaluate(() => getSelection().toString()), quote);
        const after = await current(page), added = after.records.find(record => !before.records.some(old => old.id === record.id));
        assert.deepEqual(after.sources, before.sources); assert.deepEqual(after.sourceVersions, before.sourceVersions);
        assert.equal(added.text, quote); assert.deepEqual(added.sourceRefs, [{ sourceId, sourceVersionId: versionId, locator: { start: raw.indexOf(quote, Math.floor(raw.length / 2)), end: raw.indexOf(quote, Math.floor(raw.length / 2)) + quote.length } }]);
        await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeSearch').waitFor();
        await page.waitForFunction(() => Math.abs(scrollY - __readingListY) <= 2);
        assert.equal(await page.locator('#lifeSearch').inputValue(), '품질 원문'); assert.equal(await page.locator('#lifeOriginFilter').inputValue(), 'apple_notes');
        assert.equal(await page.locator('#lifeFilterToggle').getAttribute('aria-expanded'), 'true');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.focusKey), await page.evaluate(() => __readingFocusKey));
        assert.equal(server.writes().length, 0);
        report.checks.push({ name, pass: true, ...entry, emptySaveDisabled, exactUTF16Excerpt: true, unchangedSourcesAndVersions: true, searchFilterScrollFocusRestored: true });
        console.log('PASS ' + name);
      } catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error(error.stack); await page.screenshot({ path: path.join(out, 'failure-' + size.width + '.png'), fullPage: true }).catch(() => {}); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({ passed: report.checks.filter(item => item.pass).length, total: report.checks.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length }));
  if (report.checks.some(item => !item.pass) || report.consoleErrors.length || report.pageErrors.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

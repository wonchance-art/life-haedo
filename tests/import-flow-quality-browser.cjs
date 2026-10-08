/* Import outcome and review selection: anonymous SDK/IndexedDB UI regression.
 * BASE_URL=http://127.0.0.1:4184 PW_MODULE_PATH=... node tests/import-flow-quality-browser.cjs
 * IMPORT_FLOW_BASELINE=1 records incumbent UX without expecting the fixes.
 * Chromium viewport simulation does not verify Apple hardware or real OAuth. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, base, cloud } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, observe } = require('./unified-home-browser.cjs');
const baseline = process.env.IMPORT_FLOW_BASELINE === '1';
const out = path.resolve(__dirname, '../.local/product-flow-quality/import', baseline ? 'before' : 'after');
const quote = '천천히 다시 읽을 구절🌱';
const raw = '산책을 마치고 정원의 변화를 기록했다.\r\n' + quote + '\r\n\r\n멀리 돌아온 뒤 같은 문장을 만났다.\r\n' + quote + '\r\n다음 산책에서 무엇이 달라졌는지 확인한다.';
const title = '정원 산책과 긴 문장을 천천히 다시 읽은 익명 기록';
const current = page => page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.read(await s.getActive()); });
async function click(page, name) { await page.getByRole('button', { name, exact: true }).click(); await settle(page); }
async function choose(page, collapsed = false) {
  return page.locator('#lifeReviewText').evaluate((el, { quote, collapsed }) => {
    const start = el.value.lastIndexOf(quote); el.focus();
    el.setSelectionRange(collapsed ? start + quote.length : start, start + quote.length);
    el.dispatchEvent(new Event('select', { bubbles: true }));
    return { start: el.selectionStart, end: el.selectionEnd };
  }, { quote, collapsed });
}
async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), baseline, browser: browser.version(), checks: [], observations: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [], realRemoteWrites: 0 };
  try {
    for (const size of [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }]) {
      const name = 'filtered import → exact excerpt → saved original access ' + size.width;
      const server = new FakeCloud(), context = await makeContext(browser, server, 'import-flow-' + size.width, undefined, { viewport: size, hasTouch: size.width <= 820 });
      const page = await context.newPage(); page.setDefaultTimeout(15000); observe(page, report, name);
      await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback(); report.external.push(u.origin); return route.abort('blockedbyclient'); });
      try {
        await page.goto(base + '/index.html?section=records'); await ready(page); await settle(page);
        await page.locator('#lifeSearch').fill('지난 여행'); await page.locator('#lifeFilterToggle').click(); await page.locator('#lifeOriginFilter').selectOption('apple_notes');
        await click(page, '가져오기'); await page.locator('#lifeImportTitle').fill(title); await page.locator('#lifeImportOrigin').selectOption('obsidian');
        await click(page, '텍스트 파일'); await page.locator('#lifeImportFile').setInputFiles({ name: 'anonymous-walk.md', mimeType: 'text/markdown', buffer: Buffer.from(raw) }); await settle(page);
        await click(page, '원문·출처 확인');
        const add = page.getByRole('button', { name: '발췌 후보 추가', exact: true });
        const emptyAddDisabled = await add.isDisabled();
        await choose(page); assert.equal(await page.locator('.life-review .life-selection').textContent(), quote);
        await choose(page, true);
        const collapsedPreview = await page.locator('.life-review .life-selection').textContent(), collapsedAddDisabled = await add.isDisabled();
        await page.screenshot({ path: path.join(out, 'review-collapsed-' + size.width + '.png'), fullPage: true });
        if (!baseline) { assert.equal(emptyAddDisabled, true); assert.equal(collapsedAddDisabled, true); assert(!collapsedPreview.includes(quote), 'Collapsed selection must not retain a stale quote preview'); }
        await choose(page); await page.locator('#lifeExcerptTopic').fill('정원 읽기'); await page.locator('#lifeExcerptNote').fill('두 번째로 만난 문장의 정확한 위치를 보관한다.');
        if (!baseline) {
          // A browser can collapse its textarea selection after focus moves to
          // the note. This must not replace the last intentional source choice.
          await page.locator('#lifeReviewText').evaluate(el => { el.setSelectionRange(el.selectionEnd, el.selectionEnd); el.dispatchEvent(new Event('select', { bubbles: true })); });
          assert.equal(await page.locator('.life-review .life-selection').textContent(), quote);
        }
        assert.equal(await add.isEnabled(), true); await click(page, '발췌 후보 추가'); await click(page, '선택한 발췌 모음에 반영');
        const bundle = await current(page), saved = bundle.sourceVersions[0], record = bundle.records[0];
        assert.equal(saved.contentText, raw); assert.equal(saved.format, 'text/markdown'); assert.equal(record.text, quote);
        assert.deepEqual(record.sourceRefs[0].locator, { start: raw.lastIndexOf(quote), end: raw.lastIndexOf(quote) + quote.length });
        assert.equal(bundle.sources.length, 1); assert.equal(bundle.records.length, 1);
        assert.equal(await page.locator('#lifeSearch').inputValue(), '지난 여행'); assert.equal(await page.locator('#lifeOriginFilter').inputValue(), 'apple_notes');
        const visibleSavedCards = await page.locator('.life-source-card[data-source-id="' + bundle.sources[0].id + '"]').count();
        const savedOpen = page.locator('#lifeImportResultOpen'); const savedReadingAction = await savedOpen.isVisible();
        await page.screenshot({ path: path.join(out, 'saved-filtered-' + size.width + '.png') });
        if (!baseline) {
          assert.equal(savedReadingAction, true, 'Saving must leave access to the exact saved original even when prior filters hide it');
          await savedOpen.click(); await page.locator('#lifeSourceText').waitFor(); await settle(page);
          assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
          await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeSearch').waitFor();
          assert.equal(await page.locator('#lifeSearch').inputValue(), '지난 여행'); assert.equal(await page.locator('#lifeOriginFilter').inputValue(), 'apple_notes');
          await page.waitForFunction(() => document.activeElement?.id === 'lifeImportResultOpen');
          assert.deepEqual(await current(page), bundle, 'Opening the outcome must not alter saved originals or excerpts');
        }
        report.observations.push({ width: size.width, emptyAddDisabled, collapsedAddDisabled, collapsedPreview, visibleSavedCards, savedReadingAction });
        report.checks.push({ name, pass: true, exactRawVersionAndUTF16: true, retainedSearchFilters: true });
        assert.equal(server.writes().length, 0); console.log('PASS ' + name);
      } catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error(error.stack); await page.screenshot({ path: path.join(out, 'failure-' + size.width + '.png'), fullPage: true }).catch(() => {}); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({ passed: report.checks.filter(check => check.pass).length, total: report.checks.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length }));
  if (report.checks.some(check => !check.pass) || report.consoleErrors.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

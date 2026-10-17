'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { playwright, makeContext, ready, nav, settle } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const out = path.resolve('.local/flow-quality');
const thought = '좋아하는 일을 다시 만날 시간을 남겨 두기\n\n예전에는 잘하는 모습부터 보여 주고 싶었다. 지금은 오래 궁금한 것을 천천히 읽어 보고 싶다.\n\n다음 질문: 주말에 같은 길을 걸으면 무엇을 새로 알아차릴까?';
const raw = '산책하며 돌아본 오래된 질문🌱\r\n같은 길에서 달라진 생각을 다시 읽는다.';
const file = (name, text) => ({ name, mimeType: 'text/plain', buffer: Buffer.isBuffer(text) ? text : Buffer.from(text) });
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const report = { browser: browser.version(), checks: [], visual: [], pageErrors: [], consoleErrors: [], external: [], scope: 'UI anonymous file imports, actual IDB; mock Auth. Viewports and touch/IME events are not Apple hardware.' };
  const context = await makeContext(browser, new FakeCloud(), 'input-output-quality', accounts.a, { viewport: { width: 1440, height: 1000 }, hasTouch: true, reducedMotion: 'reduce' });
  await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback(); report.external.push(u.origin); return route.abort(); });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', e => report.pageErrors.push(e.message)); page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const row = i => page.locator('[data-batch-index="' + i + '"]');
  const check = async (name, action) => { await action(); report.checks.push(name); console.log('PASS ' + name); };
  const read = () => page.evaluate(async () => { const s = HaedoLife.Shell.storage, id = await s.getActive(); return { bundle: await s.read(id), stages: await s.listStages(id), wb: await s.readWorkbench(id), drafts: await s.readPageDrafts(id) }; });
  const snap = async (scene, focus) => { for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); if (focus) await focus();
    const metrics = await page.evaluate(inspect); report.visual.push({ scene, width, metrics });
    assert(!metrics.horizontalOverflow); for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ' ' + key);
    await page.screenshot({ path: path.join(out, scene + '-' + width + '.png') });
  }};
  const records = async () => { await nav(page, 'records'); if (await page.locator('#lifeMain').getAttribute('data-mode') !== 'sources') await nav(page, 'records'); };
  const selectFiles = async files => { await records(); await click('가져오기'); await click('텍스트 파일'); await page.locator('#lifeBatchPicker summary').click(); await page.locator('#lifeBatchFiles').setInputFiles(files); };
  let retained, original;
  try {
    await page.goto(base + '/index.html'); await ready(page); await page.locator('#homePosts[aria-busy="false"]').waitFor(); await snap('home');
    await check('Partial file failure keeps successful draft; only failed row is reselected and committed', async () => {
      await selectFiles([file('walk.md', raw), file('bad.txt', Buffer.from([0xc3, 0x28]))]);
      await row(0).filter({ hasText: '검토 중 보관됨' }).waitFor(); await row(1).filter({ hasText: '실패' }).waitFor();
      retained = (await read()).stages[0]; await snap('import-partial', () => row(1).scrollIntoViewIfNeeded());
      await page.locator('#lifeBatchRetry-1').setInputFiles(file('fixed.txt', '수정한 다른 익명 글')); await row(1).filter({ hasText: '검토 중 보관됨' }).waitFor();
      const saved = await read(); assert.equal(saved.stages.length, 2); assert.deepEqual(saved.stages.find(s => s.stageId === retained.stageId), retained); assert.equal(new Set(saved.stages.map(s => s.batchId)).size, 1); assert.equal(saved.bundle.sources.length, 0);
      await row(0).getByRole('button', { name: '이 파일 검토', exact: true }).click(); await page.locator('#lifeImportOrigin').selectOption('obsidian');
      await page.getByText('출처 상세·포함 범위 (선택)', { exact: true }).click(); await page.locator('#lifeImportRelation').selectOption('self'); await page.locator('#lifeImportDate').fill('2022-04-03');
      await click('원문·출처 확인'); assert.equal(await page.locator('#lifeReviewText').inputValue(), raw.replace(/\r\n/g, '\n')); await click('자료만 보관'); await row(0).filter({ hasText: '자료 보관됨' }).waitFor();
      original = (await read()).bundle; assert.equal(original.sourceVersions[0].contentText, raw); assert.equal(original.sourceVersions[0].originalCreatedAt, '2022-04-03'); assert.equal(original.sourceVersions[0].originalAuthor.relation, 'self');
    });
    await check('Search opens exact imported text; returning preserves query and source remains unchanged', async () => {
      await page.locator('#lifeFindOpen').click(); await page.locator('#lifeFind[aria-busy="false"]').waitFor(); await page.locator('#lifeFindQuery').fill('달라진 생각'); await snap('search-results'); await page.locator('.life-find-result').click();
      await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), raw); await snap('source-reading'); await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeFind[aria-busy="false"]').waitFor(); assert.equal(await page.locator('#lifeFindQuery').inputValue(), '달라진 생각'); assert.deepEqual((await read()).bundle, original);
    });
    await check('Thought actions are reachable without opening file settings at all widths', async () => {
      await records(); await page.locator('#lifeSelectionToggle').click(); await page.locator('.life-source-select').first().click(); await page.locator('#lifeArrangeReflection').click(); await page.locator('#wbIncomingApply').click(); await page.locator('#wbReflectionNote').fill(thought); await click('지금 저장');
      assert.equal(await page.locator('#wbReflectionToPage').evaluate(e => !!e.closest('details')), false);
      await snap('output-after', async () => { await page.locator('#wbReflectionUse').click(); await page.waitForFunction(() => document.activeElement?.id === 'wbReflectionToPage'); const rect = await page.locator('#wbReflectionToPage').boundingBox(); assert(rect.y > 0 && rect.y + rect.height < 900); });
      await page.locator('#wbReflectionFileOpen').click(); assert.equal(await page.locator('#wbReflectionIncludeSources').isChecked(), false);
      const pending = page.waitForEvent('download'); await page.locator('#wbReflectionExport').click(); const text = await fs.readFile(await (await pending).path(), 'utf8'); assert(text.includes(thought)); assert(!text.includes(raw)); await fs.writeFile(path.join(out, 'private-thought.md'), text);
    });
    await check('Write, attach, save and preview a private page then return without modifying reflection or sources', async () => {
      await page.locator('#wbReflectionToPage').click(); await page.locator('#ppBody').waitFor(); assert.equal(await page.locator('#ppBody').inputValue(), thought);
      await page.locator('#ppBody').fill(thought + '\n다음 주에 다시 걸어 보기.'); await click('음악·책·대상 붙이기'); await page.locator('#clPickerQuery').fill('조용한 산책'); await click('직접 입력'); await page.getByRole('textbox', { name: '아티스트·저자', exact: true }).fill('익명 창작자'); await click('첨부'); await click('저장'); await page.locator('.pp-feed .pp-post').waitFor();
      const data = await read(); assert.equal(data.wb.page.posts[0].visibility, 'private'); assert.equal(data.wb.reflection.note, thought); assert.deepEqual(data.bundle, original);
      await click('방문자 미리보기'); assert.equal(await page.locator('#wbVisitor .pp-post').count(), 0); await click('편집으로 돌아가기'); await snap('private-feed'); await click('회고로 돌아가기'); assert.equal(await page.locator('#wbReflectionNote').inputValue(), thought);
    });
    await check('Search refresh invalidates cached results while kind filters preserve exact results', async () => {
      await page.locator('#lifeFindOpen').click(); await page.locator('#lifeFind[aria-busy="false"]').waitFor(); await page.locator('#lifeFindQuery').fill('조용한 산책');
      const matches = await page.locator('.life-find-result').count(); assert(matches > 0); await page.getByRole('button', { name: /^페이지 \d+$/, exact: false }).click(); assert.equal(await page.locator('.life-find-result').count(), matches);
      await page.evaluate(async () => { const s = HaedoLife.Shell.storage, id = await s.getActive(), w = await s.readWorkbench(id); w.page.posts[0].attachments[0].title = '새로 바꾼 제목'; await s.saveWorkbench(id, w, w.revision); });
      await page.locator('#lifeFindReload').waitFor({ state: 'visible' }); await page.locator('#lifeFindReload').click(); await page.locator('#lifeFind[aria-busy="false"]').waitFor(); assert.equal(await page.locator('.life-find-result').count(), 0); await page.locator('#lifeFindQuery').fill('새로 바꾼 제목'); assert.equal(await page.locator('.life-find-result').count(), 1);
    });
    await check('Stopped retry cannot overwrite a newer retry for the same row', async () => {
      await selectFiles([file('broken.txt', Buffer.from([0xc3, 0x28]))]); await row(0).filter({ hasText: '실패' }).waitFor();
      await page.evaluate(() => { window.__arrayBuffer = File.prototype.arrayBuffer; File.prototype.arrayBuffer = async function() { const value = await __arrayBuffer.call(this); if (this.name === 'held.txt') await new Promise(resolve => { window.__releaseRetry = resolve; }); return value; }; });
      await page.locator('#lifeBatchRetry-0').setInputFiles(file('held.txt', '뒤늦은 입력')); await page.waitForFunction(() => !!window.__releaseRetry); await page.locator('#lifeBatchStop').click();
      await page.locator('#lifeBatchRetry-0').setInputFiles(file('new.txt', '현재 선택한 입력')); await row(0).filter({ hasText: '검토 중 보관됨' }).waitFor(); const before = await read(); await page.evaluate(() => { __releaseRetry(); File.prototype.arrayBuffer = __arrayBuffer; });
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); assert.deepEqual(await read(), before); assert((await read()).stages.some(s => s.input.text === '현재 선택한 입력')); assert(!(await read()).stages.some(s => s.input.text === '뒤늦은 입력'));
    });
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } finally { await browser.close(); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
}
main().catch(e => { console.error(e); if (process.env.GITHUB_ACTIONS) console.error('::error title=Input output quality::' + String(e.stack || e).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')); process.exitCode = 1; });

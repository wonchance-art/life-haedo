/* User-authored book interpretations: actual SDK/IndexedDB, synthetic Auth only.
 * BASE_URL=http://127.0.0.1:4184 PW_MODULE_PATH=... node tests/book-insights-browser.cjs */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base, openManagement } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, observe } = require('./unified-home-browser.cjs');
const { abortWorkbenchWrites } = require('./life-workbench-browser.cjs');
const { fixture: bookFixture, go, current, save, details, download, openBook, createBook, createChapter, evidence, seedBooks, switchAccount, oldBody, latestBody, legacyNote, manuscript, specs } = require('./book-projects-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const out = path.resolve('.local/book-insights');
const statement = '잘한다고 인정받는 일보다 오래 해 보고 싶은 일을 구분하게 되었다고 생각한다.';
const uncertainty = '당시에는 말하지 못한 다른 이유가 있었을 수 있다. 일부 글만으로 변화의 방향을 확정하지 않는다.';
const unknownBody = '작성한 때와 작성자를 확인하지 못한 메모다. 이 문장만으로 내 경험을 단정하지 않는다.';
function annotation(error) { if (process.env.GITHUB_ACTIONS) console.error('::error title=Book insights::' + String(error.stack || error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')); }
async function fixture(page, options) {
  const f = await bookFixture(page);
  f.refs.unknown = await page.evaluate(async text => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, b = await s.read(await s.getActive());
    const p = await c.prepareImport({ origin: 'other', title: '언제 누구의 글인지 확인하지 못한 메모', text, authorRelation: 'unknown', originalCreatedAt: null, coverage: 'unknown', forceSeparate: true }, b);
    const r = await s.commitLocal({ workspaceId: b.workspaceId, baseRevision: b.revision, operationId: c.id(), changes: c.buildImportChanges(b, p) });
    if (r.status !== 'stored') throw Error('Anonymous unknown relation fixture rejected'); return { sourceId: p.source.id, versionId: p.version.id };
  }, unknownBody);
  const seed = await seedBooks(page, f, options); await openBook(page, seed.books[0].id); return { ...f, ...seed };
}
async function seedInsight(page, f, { missing = false, excluded = false } = {}) {
  const value = await page.evaluate(async ({ f, statement, uncertainty, missing, excluded }) => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, w = await s.readWorkbench(f.workspaceId);
    const item = { id: c.id(), statement, uncertainty, supportVersionIds: [f.refs.work.versionId, f.refs.reference.versionId, f.refs.unknown.versionId, ...(missing ? [f.gap] : [])], counterVersionIds: [f.refs.latest.versionId, f.refs.link.versionId, ...(missing ? [f.gap] : [])], excluded };
    w.books[0].chapters[0].insights = [item];
    if (missing) w.books[0].chapters[1].insights = [{ ...item, id: c.id(), statement: '제외해 둔 별도 해석도 복원 사본에는 보존한다.', excluded: true, supportVersionIds: [f.gap], counterVersionIds: [f.refs.work.versionId] }];
    await s.saveWorkbench(f.workspaceId, w, w.revision); return item;
  }, { f, statement, uncertainty, missing, excluded });
  await go(page); await openBook(page, f.books[0].id); return value;
}
async function capture(page, report, scene, width) {
  await page.mouse.move(width - 2, 2);
  await page.evaluate(async () => { document.activeElement?.blur(); scrollTo(0, 0); await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const metrics = await page.evaluate(inspect), screenshot = `${scene}-${width}.png`; await page.screenshot({ path: path.join(out, screenshot), fullPage: true });
  if (width === 390) await page.screenshot({ path: path.join(out, `${scene}-${width}-viewport.png`), fullPage: false });
  report.visual.push({ scene, width, screenshot, ...metrics }); assert.equal(metrics.horizontalOverflow, false);
  for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ': ' + key);
}
async function expand(page, id) { const box = page.locator(id); if (!await box.evaluate(el => el.open)) await box.locator(':scope > summary').click(); return box; }
async function openInsight(page, id) { await expand(page, '#wbChapterInsights'); const row = page.locator(`[data-insight-id="${id}"]`); await row.getByRole('button', { name: '생각 열기', exact: true }).click(); await page.locator('#wbInsightStatement').waitFor(); }
async function selectRole(page, role, ids) {
  await expand(page, role === 'support' ? '#wbInsightSupport' : '#wbInsightCounter');
  const picker = await details(page, role === 'support' ? '뒷받침할 원문 연결' : '다른 관점의 원문 연결');
  for (const id of ids) await picker.locator(`input[data-version-id="${id}"]`).check(); await picker.locator(':scope > summary').click();
}
function sourceRow(page, role, id) { return page.locator(`#wbInsight${role === 'support' ? 'Support' : 'Counter'}Rows .wb-source[data-version-id="${id}"]`); }
async function readReturn(page, f, id, role, raw, width) {
  await expand(page, role === 'support' ? '#wbInsightSupport' : '#wbInsightCounter'); const button = sourceRow(page, role, id).getByRole('button', { name: '이 원문 버전 열기', exact: true });
  const key = await button.getAttribute('data-focus-key'); assert(key.startsWith(`insight:${f.books[0].id}:${f.books[0].chapters[0].id}:`)); assert(key.endsWith(`:${role === 'support' ? 'Support' : 'Counter'}:${id}`));
  if (width === 1440) { await button.focus(); await page.keyboard.press('Enter'); } else await button.tap();
  await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), raw); await page.locator('#lifeSearchReturn').click(); await page.locator('#wbInsightStatement').waitFor(); await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, key);
}
async function main() {
  await fs.mkdir(out, { recursive: true }); const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), browser: browser.version(), scope: 'Actual private books UI, SDK and isolated IndexedDB with anonymous intercepted HTTP. Chromium viewport/keyboard/touch only, no production SQL, Apple hardware or native IME.', checks: [], visual: [], observations: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, operatingRemoteWrites: 0 };
  async function check(name, width, run) {
    if (process.env.BOOK_INSIGHTS_MATCH && !new RegExp(process.env.BOOK_INSIGHTS_MATCH).test(name)) return;
    const server = new FakeCloud(), device = 'book-insights-' + report.checks.length, context = await makeContext(browser, server, device, accounts.a, { viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width <= 820, reducedMotion: 'reduce' });
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push(url.origin); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
    try { await run({ page, context, server, device }); assert.equal(server.writes().length, 0, 'Interpretations do not opt into remote upload'); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); annotation(error); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    for (const width of [1440, 820, 390]) await check(`authored interpretation with exact support/counter, independent references and reversible export exclusion at ${width}`, width, async ({ page }) => {
      const f = await fixture(page), baseline = await current(page); assert.equal(baseline.workbench.books[0].chapters[0].insights, undefined); await expand(page, '#wbChapterInsights'); if (width === 390) await capture(page, report, 'empty', width);
      await page.locator('#wbInsightCreate').click(); await page.locator('#wbInsightStatement').waitFor(); const edited = statement + '\n지금의 해석이라는 점을 함께 남긴다.';
      await page.locator('#wbInsightStatement').fill(edited); await page.locator('#wbInsightUncertainty').fill(uncertainty);
      await selectRole(page, 'support', [f.refs.work.versionId, f.refs.reference.versionId, f.refs.unknown.versionId]); await selectRole(page, 'counter', [f.refs.latest.versionId, f.refs.link.versionId]); await save(page);
      const item = (await current(page)).workbench.books[0].chapters[0].insights[0]; assert.equal(item.statement, edited); assert.equal(item.uncertainty, uncertainty); assert.equal(item.excluded, false); assert.deepEqual(item.supportVersionIds, [f.refs.work.versionId, f.refs.reference.versionId, f.refs.unknown.versionId]); assert.deepEqual(item.counterVersionIds, [f.refs.latest.versionId, f.refs.link.versionId]);
      assert.match(await sourceRow(page, 'support', f.refs.reference.versionId).textContent(), /다른 사람의 기록.*일부 본문/); assert.match(await sourceRow(page, 'support', f.refs.unknown.versionId).textContent(), /작성자 관계 미확인/); assert.match(await sourceRow(page, 'counter', f.refs.link.versionId).textContent(), /본문 미확보/);
      await readReturn(page, f, f.refs.work.versionId, 'support', oldBody, width); assert.equal(await page.locator('#wbInsightStatement').inputValue(), edited); assert.equal(await page.locator('#wbInsightUncertainty').inputValue(), uncertainty);
      await readReturn(page, f, f.refs.latest.versionId, 'counter', latestBody, width); assert.equal(await page.locator('#wbChapterNote').inputValue(), manuscript); await capture(page, report, 'insight', width);
      await evidence(page); await page.locator(`#wbChapterSources .wb-source[data-version-id="${f.refs.work.versionId}"]`).getByRole('button', { name: '연결 해제', exact: true }).click(); await save(page);
      let stored = await current(page), chapter = stored.workbench.books[0].chapters[0]; assert(!chapter.versionIds.includes(f.refs.work.versionId)); assert.deepEqual(chapter.insights[0], item); assert.equal(chapter.note, manuscript); assert.deepEqual(stored.workbench.reflection, f.legacy); assert.deepEqual(stored.bundle, baseline.bundle);
      await details(page, '책 원고 파일로 보관'); assert.equal(await page.locator('#wbBookIncludeSources').isChecked(), false); const metadata = await download(page, '#wbBookExport'); assert(metadata.text.includes(edited)); assert(metadata.text.includes(uncertainty)); assert(!metadata.text.includes(oldBody)); assert(!metadata.text.includes(latestBody)); assert(!metadata.text.includes(unknownBody));
      await page.locator('#wbBookIncludeSources').check(); const included = await download(page, '#wbBookExport'); for (const raw of [oldBody, latestBody, unknownBody]) assert(included.text.includes(raw)); assert(!included.text.includes(specs.at(-1).text)); assert(included.text.includes('사진과 댓글 미보관')); assert(included.text.includes('본문 미확보'));
      await page.locator('#wbInsightExclude').click(); await save(page); stored = await current(page); assert.equal(stored.workbench.books[0].chapters[0].insights[0].excluded, true); assert.equal(stored.workbench.books[0].chapters[0].note, manuscript);
      await details(page, '책 원고 파일로 보관'); await page.locator('#wbBookIncludeSources').check(); const excluded = await download(page, '#wbBookExport'); assert(!excluded.text.includes(edited)); assert(!excluded.text.includes(uncertainty)); assert(!excluded.text.includes(latestBody)); assert(!excluded.text.includes(unknownBody)); assert(excluded.text.includes(oldBody), 'A separate chapter selection still includes its original after excluding the interpretation'); assert(excluded.text.includes(manuscript));
      await expand(page, '#wbChapterInsights'); await expand(page, '#wbInsightExcluded'); await page.locator(`[data-insight-id="${item.id}"]`).getByRole('button', { name: '생각 복원', exact: true }).click(); await save(page); stored = await current(page); assert.deepEqual(stored.workbench.books[0].chapters[0].insights[0], item);
      await fs.writeFile(path.join(out, `active-manuscript-${width}.md`), included.text); await fs.writeFile(path.join(out, `excluded-manuscript-${width}.md`), excluded.text);
      await page.reload(); await ready(page); await openBook(page, f.books[0].id); await openInsight(page, item.id); assert.equal(await page.locator('#wbInsightStatement').inputValue(), edited); assert.equal(await page.locator('#wbInsightUncertainty').inputValue(), uncertainty); assert.deepEqual((await current(page)).workbench, stored.workbench); assert.equal(await page.locator('#wbBookIncludeSources').isChecked(), false);
      report.observations.push({ width, userAuthored: true, exactOldSupportAndLatestCounter: true, sourceReturnFocus: true, generalChapterUnlinkPreservesInsightAndManuscript: true, defaultExportNoBodies: true, exclusionReversibleAndIndependent: true, legacyReflectionUnchanged: true });
    });
    await check('save failure and concurrent composition retain interpretation, uncertainty and both competing drafts', 390, async ({ page }) => {
      const f = await fixture(page), item = await seedInsight(page, f); await openInsight(page, item.id); const before = await current(page), edited = statement + '\n실패해도 사라지지 않을 생각.';
      await abortWorkbenchWrites(page, true); await page.locator('#wbInsightStatement').fill(edited); await page.locator('#wbInsightUncertainty').fill(uncertainty + '\n추가로 확인할 점.'); const downloads = []; page.on('download', file => downloads.push(file.suggestedFilename()));
      await details(page, '책 원고 파일로 보관'); await page.locator('#wbBookExport').click(); await page.waitForFunction(() => __wbAborted > 0 && !document.querySelector('#wbBookExport').disabled); assert.equal(downloads.length, 0); await page.locator('#wbBooksBack').click(); assert.equal(await page.locator('#wbInsightStatement').inputValue(), edited); assert.deepEqual(await current(page), before); await capture(page, report, 'save-error', 390);
      await abortWorkbenchWrites(page, false); await page.locator('#wbError').getByRole('button', { name: '다시 저장', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#wbStatus')?.dataset.state === 'saved'); assert.equal((await current(page)).workbench.books[0].chapters[0].insights[0].statement, edited);
      const mine = edited + '\n현재 창의 추가 해석.', theirs = '다른 창에서 먼저 저장한 해석.'; await page.locator('#wbInsightStatement').dispatchEvent('compositionstart'); await page.locator('#wbInsightStatement').fill(mine);
      await page.evaluate(async ({ id, theirs }) => { const s = HaedoLife.Shell.storage, w = await s.readWorkbench(id); w.books[0].chapters[0].insights[0].statement = theirs; await s.saveWorkbench(id, w, w.revision); }, { id: f.workspaceId, theirs });
      await page.locator('#wbInsightStatement').dispatchEvent('compositionend'); await page.getByRole('button', { name: '지금 저장', exact: true }).click(); await page.locator('#wbError').getByRole('button', { name: '저장본과 비교', exact: true }).click(); const compare = page.locator('.wb-conflict'); assert((await compare.textContent()).includes(mine)); assert((await compare.textContent()).includes(theirs)); assert((await compare.textContent()).includes('추가로 확인할 점.'));
      await compare.getByRole('button', { name: '초안 유지하고 비교 닫기', exact: true }).click(); assert.equal(await page.locator('#wbInsightStatement').inputValue(), mine); assert.equal((await current(page)).workbench.books[0].chapters[0].insights[0].statement, theirs); assert.deepEqual((await current(page)).workbench.reflection, f.legacy);
    });
    await check('JSON restores all interpretations including excluded entries and consistently remaps shared missing references', 820, async ({ page }) => {
      const f = await fixture(page, { missing: true }), item = await seedInsight(page, f, { missing: true }); await openInsight(page, item.id); await expand(page, '#wbInsightSupport'); const missing = sourceRow(page, 'support', f.gap); assert.match(await missing.textContent(), /연결된 원문 없음/); assert.equal(await missing.getByRole('button', { name: '이 원문 버전 열기', exact: true }).count(), 0);
      await go(page, 'workbench-backup'); const before = await current(page), raw = await download(page, '#wbBackupDownload'); assert.deepEqual(JSON.parse(raw.text).workbench.books, before.workbench.books);
      await page.locator('#wbRestoreFile').setInputFiles({ name: '익명-해석과-근거.json', mimeType: 'application/json', buffer: Buffer.from(raw.text) }); await page.locator('#wbRestoreInstall').waitFor(); await page.locator('#wbRestoreInstall').click(); await page.locator('.life-workbench[data-mode="books"][aria-busy="false"]').waitFor(); assert.notEqual(await page.evaluate(() => HaedoLife.Shell.storage.getActive()), f.workspaceId);
      const copy = await current(page), book = copy.workbench.books[0], active = book.chapters[0].insights[0], excluded = book.chapters[1].insights[0], ids = new Set(copy.bundle.sourceVersions.map(version => version.id)), gap = active.supportVersionIds.find(id => !ids.has(id));
      assert.notEqual(copy.bundle.workspaceId, f.workspaceId); assert.notEqual(book.id, f.books[0].id); assert.notEqual(active.id, item.id); assert.notEqual(excluded.id, before.workbench.books[0].chapters[1].insights[0].id); assert.equal(active.statement, statement); assert.equal(active.uncertainty, uncertainty); assert.equal(excluded.excluded, true);
      assert(gap && gap !== f.gap); assert(active.counterVersionIds.includes(gap)); assert(excluded.supportVersionIds.includes(gap)); assert(book.chapters.every(chapter => chapter.versionIds.includes(gap))); assert(copy.workbench.groups[0].versionIds.includes(gap));
      assert.equal(copy.bundle.sourceVersions.find(version => version.id === active.supportVersionIds[0]).contentText, oldBody); assert.equal(copy.bundle.sourceVersions.find(version => version.id === active.counterVersionIds[0]).contentText, latestBody); assert.equal(excluded.counterVersionIds[0], active.supportVersionIds[0]); assert.equal(copy.workbench.reflection.note, legacyNote); assert.equal(book.chapters[0].note, manuscript);
      const record = copy.bundle.records[0], ref = record.sourceRefs[0], version = copy.bundle.sourceVersions.find(version => version.id === ref.sourceVersionId); assert.equal(version.contentText.slice(ref.locator.start, ref.locator.end), record.text); assert.equal(version.contentText, oldBody); assert.equal(await page.evaluate(id => HaedoLife.Shell.storage.getSyncState(id), copy.bundle.workspaceId), null);
      assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.readWorkbench(id), f.workspaceId), before.workbench); assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), f.workspaceId), before.bundle);
      await go(page); await openBook(page, book.id); await openInsight(page, active.id); await expand(page, '#wbInsightSupport'); assert.match(await sourceRow(page, 'support', gap).textContent(), /연결된 원문 없음/); await details(page, '책 원고 파일로 보관'); const exported = await download(page, '#wbBookExport'); assert(exported.text.includes('연결된 원문 없음')); assert(exported.text.includes(statement)); assert(!exported.text.includes(excluded.statement));
    });
    await check('interpretation selection remains private to its workspace and account across logout and return', 820, async ({ page, server, device }) => {
      const f = await fixture(page), item = await seedInsight(page, f); await openInsight(page, item.id); await openManagement(page); await page.getByRole('button', { name: '내보내기·사본 복원', exact: true }).click(); await page.locator('#lifeNewWorkspaceName').fill('해석을 따로 남기는 익명 공간'); await page.getByRole('button', { name: '빈 작업공간 만들기', exact: true }).click(); await settle(page); const other = (await current(page)).bundle.workspaceId; assert.notEqual(other, f.workspaceId); await go(page); assert.equal((await current(page)).workbench.books, undefined);
      const second = await createBook(page, '다른 공간의 책'); await createChapter(page, '다른 공간의 장'); await expand(page, '#wbChapterInsights'); await page.locator('#wbInsightCreate').click(); await page.locator('#wbInsightStatement').fill('다른 공간에서만 보여야 하는 해석.'); await save(page);
      await openManagement(page); await page.locator('#lifeWorkspace').selectOption(f.workspaceId); await settle(page); await go(page); await openBook(page, f.books[0].id); await openInsight(page, item.id); assert.equal(await page.locator('#wbInsightStatement').inputValue(), statement);
      await switchAccount(page, server, device, accounts.b); assert.equal((await current(page)).workbench.books, undefined); assert.equal(await page.evaluate(async id => { try { await HaedoLife.Shell.storage.read(id); return false; } catch (_) { return true; } }, f.workspaceId), true);
      await createBook(page, '계정 B만의 책'); await switchAccount(page, server, device, accounts.a); assert.equal((await current(page)).bundle.workspaceId, f.workspaceId); await openBook(page, f.books[0].id); await openInsight(page, item.id); assert.equal(await page.locator('#wbInsightStatement').inputValue(), statement); assert.equal(await page.locator('#wbInsightUncertainty').inputValue(), uncertainty); assert.deepEqual((await current(page)).workbench.reflection, f.legacy); assert.equal(await page.evaluate(async id => (await HaedoLife.Shell.storage.readWorkbench(id)).books[0].id, other), second.id);
    });
    await check('twenty-first exact evidence remains reachable with independent role pagination after reader return', 390, async ({ page }) => {
      const f = await fixture(page), item = await seedInsight(page, f);
      await page.evaluate(async ({ workspaceId, old }) => {
        const s = HaedoLife.Shell.storage, c = HaedoLife.Core, ids = []; let b = await s.read(workspaceId);
        for (let index = 1; index <= 20; index++) {
          const p = await c.prepareImport({ origin: 'apple_notes', title: `여러 날의 선택을 다시 읽는 메모 ${index}`, text: `기록 ${index}. 서둘러 결론을 내리기 전에 그날의 조건을 먼저 확인한다.`, authorRelation: 'self', coverage: 'full_text', forceSeparate: true }, b);
          const result = await s.commitLocal({ workspaceId, baseRevision: b.revision, operationId: c.id(), changes: c.buildImportChanges(b, p) }); if (result.status !== 'stored') throw Error('Anonymous pagination source rejected'); ids.push(p.version.id); b = await s.read(workspaceId);
        }
        ids.push(old); const w = await s.readWorkbench(workspaceId); w.books[0].chapters[0].insights[0].supportVersionIds = ids; w.books[0].chapters[0].insights[0].counterVersionIds = ids.slice(); await s.saveWorkbench(workspaceId, w, w.revision);
      }, { workspaceId: f.workspaceId, old: f.refs.work.versionId });
      await go(page); await openBook(page, f.books[0].id); await openInsight(page, item.id); await expand(page, '#wbInsightSupport'); assert.equal(await page.locator('#wbInsightSupportRows .wb-source').count(), 20); assert.equal(await sourceRow(page, 'support', f.refs.work.versionId).count(), 0);
      await page.locator('#wbInsightSupport').getByRole('button', { name: '연결한 글 더 보기', exact: true }).click(); assert.equal(await page.locator('#wbInsightSupportRows .wb-source').count(), 21); await readReturn(page, f, f.refs.work.versionId, 'support', oldBody, 390); assert.equal(await page.locator('#wbInsightSupportRows .wb-source').count(), 21);
      await expand(page, '#wbInsightCounter'); assert.equal(await page.locator('#wbInsightCounterRows .wb-source').count(), 20); await page.locator('#wbInsightCounter').getByRole('button', { name: '연결한 글 더 보기', exact: true }).click(); await readReturn(page, f, f.refs.work.versionId, 'counter', oldBody, 390); assert.equal(await page.locator('#wbInsightCounterRows .wb-source').count(), 21); assert.equal(await page.locator('#wbInsightSupportRows .wb-source').count(), 21); assert.equal(await page.locator('#wbInsightStatement').inputValue(), statement);
      const stored = (await current(page)).workbench.books[0].chapters[0].insights[0]; assert.equal(stored.supportVersionIds.length, 21); assert.equal(stored.counterVersionIds.length, 21); assert.equal(stored.supportVersionIds[20], f.refs.work.versionId); assert.equal(stored.counterVersionIds[20], f.refs.work.versionId);
    });
    assert(report.checks.length > 0); report.pass = report.checks.every(check => check.pass) && !report.consoleErrors.length && !report.pageErrors.length && !report.external.length;
  } finally { await browser.close(); report.finishedAt = new Date().toISOString(); const json = JSON.stringify(report, null, 2); await fs.writeFile(path.join(out, 'run-' + report.createdAt.replace(/[:.]/g, '-') + '.json'), json); await fs.writeFile(path.join(out, 'browser-report.json'), json); }
  console.log(JSON.stringify({ checks: report.checks.length, passed: report.checks.filter(check => check.pass).length, visual: report.visual.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length, report: path.join(out, 'browser-report.json') })); if (!report.pass) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); annotation(error); process.exitCode = 1; });
module.exports = { fixture, seedInsight, openInsight, expand, sourceRow, statement, uncertainty };

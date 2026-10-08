/* Private book projects: actual local app, bundled SDK and isolated IndexedDB.
 * BASE_URL=http://127.0.0.1:4184 PW_MODULE_PATH=... node tests/book-projects-browser.cjs
 * All source/Auth HTTP is synthetic. No production, SQL or Apple-device access. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base, openManagement } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, observe } = require('./unified-home-browser.cjs');
const { current, abortWorkbenchWrites } = require('./life-workbench-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const out = path.resolve('.local/book-projects');
const layoutOnly = process.env.BOOK_PROJECTS_LAYOUT_ONLY === '1';
const oldBody = '첫 일을 고를 때는 잘하는 일을 빨리 정해야 한다고 생각했다.\r\n기억해 둘 질문🌱: 남의 기준과 내가 오래 해 보고 싶은 일을 어떻게 구분할까.\r\n결론보다 그때 망설인 이유를 먼저 남긴다.';
const latestBody = '몇 년 뒤 같은 메모를 다시 읽었다.\r\n잘한다고 평가받은 일과 계속 해 보고 싶은 일을 이제는 따로 적는다.\r\n이 문장은 새로 덧붙인 내용이며 이전 기록을 대신하지 않는다.';
const legacyNote = '이전에 쓴 회고는 책 프로젝트를 만들어도 그대로 남겨 둔다.';
const manuscript = '잘 해내는 사람이 되고 싶었던 시기의 글부터 읽었다.\n\n지금의 해석🌱: 결과보다 내가 고른 기준을 설명하는 장이 필요하다.';
const specs = [
  { key: 'work', title: '첫 일을 고르며 남긴 생각과 몇 년 뒤 다시 읽어 본 질문', origin: 'apple_notes', authorRelation: 'self', originalCreatedAt: '2016-03-14', text: oldBody, coverage: 'full_text' },
  { key: 'pause', title: '쉬는 시간을 설명하기 어려웠던 해', origin: 'obsidian', authorRelation: 'self', originalCreatedAt: '2020-11', text: '쉬는 시간을 낭비라고 불렀지만 무엇을 다시 해 보고 싶은지는 적지 않았다. 쉬는 동안에도 달라진 취향이 있었다.', coverage: 'full_text' },
  { key: 'reference', title: '선택의 이유를 다시 묻는 다른 사람의 글', origin: 'naver_blog', authorRelation: 'other', originalCreatedAt: '2017-09-12', text: '타인의 참고 글: 서두르지 않고 결정의 조건부터 확인해 보자는 제안이다. 저장했다고 해서 모두 동의한 것은 아니다.', url: 'https://example.invalid/book/reference', coverage: { status: 'partial', omissions: ['사진과 댓글 미보관'] } },
  { key: 'link', title: '다시 확인하려고 주소만 보관한 인터뷰', origin: 'naver_blog', authorRelation: 'other', originalCreatedAt: null, text: null, url: 'https://example.invalid/book/interview', coverage: 'link_only' },
  { key: 'unselected', title: '이번 책에는 고르지 않은 별도 원고', origin: 'obsidian', authorRelation: 'self', originalCreatedAt: '2018-07-11', text: 'UNSELECTED_BOOK_PRIVATE: 다른 프로젝트로 엮을 별도 기록이다.', coverage: 'full_text' }
];
function annotation(error) { if (process.env.GITHUB_ACTIONS) console.error('::error title=Book projects::' + String(error.stack || error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')); }
async function go(page, view = 'books') { await page.goto(base + '/index.html?section=' + (view === 'workbench-backup' ? 'manage' : 'tools') + '&view=' + view); await ready(page); await settle(page); await page.locator(`.life-workbench[data-mode="${view}"][aria-busy="false"]`).waitFor(); }
async function fixture(page) {
  await go(page);
  const value = await page.evaluate(async ({ specs, latestBody, legacyNote }) => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, refs = {}; let b = await s.read(await s.getActive());
    for (const spec of specs) {
      const { key, ...input } = spec, p = await c.prepareImport({ ...input, forceSeparate: true }, b);
      const result = await s.commitLocal({ workspaceId: b.workspaceId, baseRevision: b.revision, operationId: c.id(), changes: c.buildImportChanges(b, p) });
      if (result.status !== 'stored') throw Error('Anonymous book source rejected'); refs[key] = { sourceId: p.source.id, versionId: p.version.id }; b = await s.read(b.workspaceId);
    }
    const p = await c.prepareImport({ origin: 'apple_notes', title: specs[0].title, text: latestBody, authorRelation: 'self', originalCreatedAt: '2024-05-20', coverage: 'full_text', existingSourceId: refs.work.sourceId }, b);
    const result = await s.commitLocal({ workspaceId: b.workspaceId, baseRevision: b.revision, operationId: c.id(), changes: c.buildImportChanges(b, p) });
    if (result.status !== 'stored') throw Error('Anonymous exact latest source rejected'); refs.latest = { sourceId: p.source.id, versionId: p.version.id }; b = await s.read(b.workspaceId);
    const text = '기억해 둘 질문🌱', start = specs[0].text.indexOf(text), stamp = new Date().toISOString();
    const record = { id: c.id(), kind: 'excerpt', text, topic: '선택의 이유', note: '과거 버전의 정확한 구절', sourceRefs: [{ sourceId: refs.work.sourceId, sourceVersionId: refs.work.versionId, locator: { start, end: start + text.length } }], provenance: { kind: 'user' }, revision: 1, createdAt: stamp, updatedAt: stamp };
    await s.commitLocal({ workspaceId: b.workspaceId, baseRevision: b.revision, operationId: c.id(), changes: { put: { records: [record] } } });
    const wb = await s.readWorkbench(b.workspaceId); wb.reflection = { versionIds: [refs.work.versionId, refs.reference.versionId], note: legacyNote }; await s.saveWorkbench(b.workspaceId, wb, wb.revision);
    return { workspaceId: b.workspaceId, refs, legacy: wb.reflection };
  }, { specs, latestBody, legacyNote });
  await page.reload(); await ready(page); return value;
}
async function save(page) { await page.getByRole('button', { name: '지금 저장', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#wbStatus')?.dataset.state === 'saved'); }
async function details(page, label) { const summary = page.getByText(label, { exact: true }); const container = summary.locator('..'); if (!await container.evaluate(el => el.open)) await summary.click(); return container; }
async function download(page, selector) { const waiting = page.waitForEvent('download'); await page.locator(selector).click(); const file = await waiting; return { name: file.suggestedFilename(), text: await fs.readFile(await file.path(), 'utf8') }; }
async function capture(page, report, scene, width) {
  await page.mouse.move(width - 2, 2);
  await page.evaluate(async () => { document.activeElement?.blur(); scrollTo(0, 0); await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const metrics = await page.evaluate(inspect), screenshot = `${scene}-${width}.png`; await page.screenshot({ path: path.join(out, screenshot), fullPage: true });
  if (width === 390) await page.screenshot({ path: path.join(out, `${scene}-${width}-viewport.png`), fullPage: false });
  const positions = await page.evaluate(() => ({ manuscriptTop: document.querySelector('#wbChapterNote')?.getBoundingClientRect().top ?? null, firstSourceTop: document.querySelector('#wbChapterSources .wb-source')?.getBoundingClientRect().top ?? null }));
  report.visual.push({ scene, width, screenshot, ...positions, ...metrics }); assert.equal(metrics.horizontalOverflow, false);
  for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ': ' + key);
}
async function bookList(page) { if (await page.locator('#wbBooksBack').isVisible()) await page.locator('#wbBooksBack').click(); await page.locator('#wbBookList').waitFor({ state: 'attached' }); }
async function createBook(page, title, fromReflection = false) {
  await bookList(page); await details(page, '새 책'); await page.locator('#wbBookCreateTitle').fill(title); await page.locator(fromReflection ? '#wbBookFromReflection' : '#wbBookCreate').click(); await page.locator('#wbBooksBack').waitFor(); await save(page);
  return (await current(page)).workbench.books.find(book => book.title === title);
}
async function openBook(page, id) { await bookList(page); await page.locator(`[data-book-id="${id}"]`).getByRole('button', { name: '책 열기', exact: true }).click(); await page.locator('#wbBooksBack').waitFor(); }
async function chapterPicker(page, ids) { await evidence(page); const picker = await details(page, '이 장에 원문 연결'); for (const id of ids) await picker.locator(`input[data-version-id="${id}"]`).check(); await picker.locator(':scope > summary').click(); }
async function evidence(page) { const box = page.locator('#wbChapterEvidence'); if (!await box.evaluate(el => el.open)) await box.locator(':scope > summary').click(); return box; }
async function createChapter(page, title) { const outline = await details(page, '목차'); await page.locator('#wbChapterCreateTitle').fill(title); await page.locator('#wbChapterCreate').click(); await page.locator('#wbChapterNote').waitFor(); await save(page); return outline; }
async function seedBooks(page, f, { missing = false } = {}) {
  const result = await page.evaluate(async ({ f, manuscript, missing }) => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, w = await s.readWorkbench(f.workspaceId), gap = c.id();
    const books = [
      { id: c.id(), title: '선택의 기준을 다시 읽는 시간', fromYear: '2016', toYear: '2025', question: '그때의 선택과 지금의 해석 사이에는 무엇이 남아 있을까?', chapters: [
        { id: c.id(), title: '처음 일을 고르던 때', note: manuscript, versionIds: [f.refs.work.versionId, f.refs.reference.versionId, ...(missing ? [gap] : [])] },
        { id: c.id(), title: '쉬는 시간을 다시 이해하기', note: '쉬는 동안에도 달라진 취향과 기준을 적어 본다.', versionIds: [f.refs.pause.versionId, f.refs.work.versionId, ...(missing ? [gap] : [])] }
      ] },
      { id: c.id(), title: '공간을 걸으며 고른 질문', fromYear: '', toYear: '', question: '다른 책은 다른 물음으로 시작한다.', chapters: [{ id: c.id(), title: '다시 걷고 싶은 길', note: '두 번째 책의 독립 원고.', versionIds: [f.refs.latest.versionId] }] }
    ]; w.books = books;
    if (missing) w.groups.push({ id: c.id(), title: '없는 연결을 함께 참조하는 묶음', versionIds: [gap] });
    await s.saveWorkbench(f.workspaceId, w, w.revision); return { books, gap };
  }, { f, manuscript, missing });
  await go(page); return result;
}
async function switchAccount(page, server, device, account) {
  await page.evaluate(() => { window.__bookSignout = HaedoAuth.client.auth.signOut({ scope: 'local' }); });
  await page.waitForFunction(() => document.querySelector('#lifeApp').hidden && !HaedoLife.Shell.storage);
  server.oauthAccounts.set(device, account); await page.locator('[data-life-login]').click(); await page.locator('#googleLogin').click(); await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page); await go(page);
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), browser: browser.version(), scope: 'Actual private book UI, SDK and IndexedDB with intercepted anonymous Auth HTTP. Chromium viewports/keyboard/touch, not Apple hardware, native IME or production SQL.', checks: [], visual: [], observations: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, operatingRemoteWrites: 0 };
  async function check(name, width, run) {
    if (layoutOnly && !name.startsWith('chapter layout')) return;
    if (process.env.BOOK_PROJECTS_MATCH && !new RegExp(process.env.BOOK_PROJECTS_MATCH).test(name)) return;
    const server = new FakeCloud(), device = 'book-projects-' + report.checks.length, context = await makeContext(browser, server, device, accounts.a, { viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width <= 820, reducedMotion: 'reduce' });
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push(url.origin); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
    try { await run({ page, context, server, device }); assert.equal(server.writes().length, 0, 'Books do not automatically enable remote upload'); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); annotation(error); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    for (const width of [1440, 820, 390]) await check(layoutOnly ? `chapter layout, source return and outline at ${width}` : `two books, exact chapter sources, reordered whole-book Markdown and reload at ${width}`, width, async ({ page }) => {
      const f = await fixture(page), before = await current(page); assert.equal(before.workbench.books, undefined); if (width === 390 && !layoutOnly) await capture(page, report, 'empty', width);
      const created = await createBook(page, '스무 살 무렵의 선택을 다시 읽는 책', true); assert.equal(created.chapters.length, 1); assert.equal(created.chapters[0].note, legacyNote); assert.deepEqual(created.chapters[0].versionIds, f.legacy.versionIds);
      await details(page, '책 설정'); const title = '일과 쉼 사이에서 내가 고른 기준을 다시 읽는 시간';
      await page.locator('#wbBookTitle').fill(title); await page.locator('#wbBookFromYear').fill('2016'); await page.locator('#wbBookToYear').fill('2017'); await page.locator('#wbBookQuestion').fill('잘한다고 평가받은 일과 오래 해 보고 싶은 일은 어떻게 달랐을까?');
      await details(page, '책 설정').then(box => box.locator(':scope > summary').click());
      await page.locator('#wbChapterTitle').fill('처음 일을 고르던 때'); await page.locator('#wbChapterNote').fill(manuscript); await chapterPicker(page, [f.refs.latest.versionId]); await save(page);
      const first = (await current(page)).workbench.books[0], firstChapter = first.chapters[0]; assert.deepEqual(firstChapter.versionIds, [...f.legacy.versionIds, f.refs.latest.versionId], 'Book period metadata must not silently exclude a 2024 exact version');
      assert.match(await page.locator(`#wbChapterSources .wb-source[data-version-id="${f.refs.reference.versionId}"]`).textContent(), /다른 사람의 기록.*일부 본문/);
      const originalButton = page.locator(`#wbChapterSources .wb-source[data-version-id="${f.refs.work.versionId}"]`).getByRole('button', { name: '이 원문 버전 열기', exact: true });
      if (width === 1440) { await originalButton.focus(); await page.keyboard.press('Enter'); } else await originalButton.tap();
      await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), oldBody); await page.locator('#lifeSearchReturn').click(); await page.locator('#wbChapterNote').waitFor();
      assert.equal(await page.locator('#wbChapterNote').inputValue(), manuscript); await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, `books:${first.id}:${firstChapter.id}:${f.refs.work.versionId}`);
      await capture(page, report, 'chapter', width);
      await createChapter(page, '쉬는 시간을 다시 이해하기'); const secondNote = '쉬는 시간을 낭비라고만 부르던 문장을 다시 읽었다. 지금은 그때 달라진 취향도 한 장의 근거로 남긴다.'; await page.locator('#wbChapterNote').fill(secondNote); await chapterPicker(page, [f.refs.pause.versionId, f.refs.link.versionId, f.refs.work.versionId]); await save(page);
      let book = (await current(page)).workbench.books[0]; const secondChapter = book.chapters[1]; const outline = await details(page, '목차'); await outline.locator(`[data-chapter-id="${secondChapter.id}"]`).getByRole('button', { name: '위로 이동', exact: true }).click(); await save(page);
      book = (await current(page)).workbench.books[0]; assert.deepEqual(book.chapters.map(chapter => chapter.id), [secondChapter.id, firstChapter.id]); assert.equal(book.chapters[0].note, secondNote); await capture(page, report, 'outline', width);
      if (layoutOnly) { report.observations.push({ width, scope: 'Final visual compaction only', exactOldVersionReturnFocus: true, reorderedChapterLayout: true, legacyReflectionUnchanged: JSON.stringify((await current(page)).workbench.reflection) === JSON.stringify(f.legacy) }); return; }
      await details(page, '책 원고 파일로 보관'); assert.equal(await page.locator('#wbBookIncludeSources').isChecked(), false); const metadata = await download(page, '#wbBookExport');
      assert.match(metadata.name, /\.md$/); assert(metadata.text.includes(manuscript)); assert(metadata.text.includes(secondNote)); assert(metadata.text.includes(title)); assert(metadata.text.includes(book.question)); assert(metadata.text.indexOf(secondNote) < metadata.text.indexOf(manuscript));
      for (const text of [oldBody, latestBody, ...specs.filter(spec => spec.text).map(spec => spec.text)]) assert(!metadata.text.includes(text), 'Default manuscript must exclude original bodies');
      await page.locator('#wbBookIncludeSources').check(); const originals = await download(page, '#wbBookExport');
      for (const text of [oldBody, latestBody, specs[1].text, specs[2].text]) assert(originals.text.includes(text)); assert(!originals.text.includes(specs.at(-1).text)); assert(originals.text.includes('본문 미확보')); assert(originals.text.includes('사진과 댓글 미보관'));
      await fs.writeFile(path.join(out, `book-metadata-${width}.md`), metadata.text); await fs.writeFile(path.join(out, `book-with-originals-${width}.md`), originals.text);
      const secondBook = await createBook(page, '걷는 동안 달라진 취향'); assert.equal(secondBook.chapters.length, 0); await createChapter(page, '다시 걷고 싶은 길'); await page.locator('#wbChapterNote').fill('두 번째 책의 독립 원고.'); await save(page);
      await openBook(page, first.id); const saved = await current(page); assert.equal(saved.workbench.books.length, 2); assert.equal(saved.workbench.books[0].chapters[0].note, secondNote); assert.deepEqual(saved.workbench.reflection, f.legacy); assert.deepEqual(saved.bundle, before.bundle);
      await details(page, '책 원고 파일로 보관'); const onlyFirst = await download(page, '#wbBookExport'); assert(onlyFirst.text.includes(manuscript)); assert(!onlyFirst.text.includes('두 번째 책의 독립 원고.')); assert(!onlyFirst.text.includes(secondBook.title));
      await page.reload(); await ready(page); await openBook(page, first.id); assert.deepEqual((await current(page)).workbench, saved.workbench); assert.equal(await page.locator('#wbBookHeading').textContent(), title); assert.equal(await page.locator('#wbBookIncludeSources').isChecked(), false);
      report.observations.push({ width, books: 2, chapters: 3, exactOldVersionAndFocus: true, metadataDoesNotFilterSources: true, defaultBodyExportOff: true, entireBookExportPreservesChapterOrder: true, legacyReflectionUnchanged: true });
    });
    await check('failed chapter save preserves text and blocks project, chapter and export transitions', 390, async ({ page }) => {
      const f = await fixture(page), seed = await seedBooks(page, f); await openBook(page, seed.books[0].id); const baseline = await current(page); await abortWorkbenchWrites(page, true);
      const note = manuscript + '\n저장에 실패해도 남아야 하는 문장.'; await page.locator('#wbChapterNote').fill(note); await page.locator('#wbBooksBack').click(); await page.locator('#wbError').waitFor({ state: 'visible' }); assert.equal(await page.locator('#wbChapterNote').inputValue(), note);
      const outline = await details(page, '목차'); let aborts = await page.evaluate(() => __wbAborted); await outline.locator(`[data-chapter-id="${seed.books[0].chapters[1].id}"]`).getByRole('button', { name: /^장 열기:/ }).click(); await page.waitForFunction(before => __wbAborted > before, aborts); assert.equal(await page.locator('#wbChapterNote').inputValue(), note);
      const downloads = []; page.on('download', item => downloads.push(item.suggestedFilename())); await details(page, '책 원고 파일로 보관'); aborts = await page.evaluate(() => __wbAborted); await page.locator('#wbBookExport').click(); await page.waitForFunction(before => __wbAborted > before && !document.querySelector('#wbBookExport').disabled, aborts); assert.deepEqual(downloads, []); assert.deepEqual(await current(page), baseline); await capture(page, report, 'save-error', 390);
      await abortWorkbenchWrites(page, false); await page.locator('#wbError').getByRole('button', { name: '다시 저장', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#wbStatus')?.dataset.state === 'saved');
      assert.equal((await current(page)).workbench.books[0].chapters[0].note, note); assert((await download(page, '#wbBookExport')).text.includes(note)); assert.equal(downloads.length, 1); assert.deepEqual((await current(page)).workbench.reflection, f.legacy);
    });
    await check('concurrent IndexedDB chapter edits retain both manuscripts for explicit comparison', 820, async ({ page }) => {
      const f = await fixture(page), seed = await seedBooks(page, f); await openBook(page, seed.books[0].id); const mine = manuscript + '\n지금 창에서 이어 쓴 문장.', theirs = '다른 창에서 먼저 저장한 장 원고.';
      await page.locator('#wbChapterNote').dispatchEvent('compositionstart'); await page.locator('#wbChapterNote').fill(mine);
      await page.evaluate(async ({ id, theirs }) => { const s = HaedoLife.Shell.storage, w = await s.readWorkbench(id); w.books[0].chapters[0].note = theirs; await s.saveWorkbench(id, w, w.revision); }, { id: f.workspaceId, theirs });
      await page.locator('#wbChapterNote').dispatchEvent('compositionend'); await page.getByRole('button', { name: '지금 저장', exact: true }).click(); await page.locator('#wbError').getByRole('button', { name: '저장본과 비교', exact: true }).waitFor();
      assert.equal(await page.locator('#wbChapterNote').inputValue(), mine); assert.equal((await current(page)).workbench.books[0].chapters[0].note, theirs);
      await page.locator('#wbError').getByRole('button', { name: '저장본과 비교', exact: true }).click(); const compare = page.locator('.wb-conflict'); assert((await compare.textContent()).includes(mine)); assert((await compare.textContent()).includes(theirs));
      await compare.getByRole('button', { name: '초안 유지하고 비교 닫기', exact: true }).click(); assert.equal(await page.locator('#wbChapterNote').inputValue(), mine); assert.equal((await current(page)).workbench.books[0].chapters[0].note, theirs); assert.deepEqual((await current(page)).workbench.reflection, f.legacy);
    });
    await check('integrated JSON restore remaps projects, exact versions and shared missing references', 390, async ({ page }) => {
      const f = await fixture(page), seed = await seedBooks(page, f, { missing: true }); await openBook(page, seed.books[0].id); await evidence(page); const missing = page.locator(`#wbChapterSources .wb-source[data-version-id="${seed.gap}"]`); assert.match(await missing.textContent(), /연결된 원문 없음/); assert.equal(await missing.getByRole('button', { name: '이 원문 버전 열기', exact: true }).count(), 0);
      await go(page, 'workbench-backup'); const before = await current(page), raw = await download(page, '#wbBackupDownload'), backup = JSON.parse(raw.text); assert.deepEqual(backup.workbench.books, before.workbench.books);
      await page.locator('#wbRestoreFile').setInputFiles({ name: '익명-책-구성.json', mimeType: 'application/json', buffer: Buffer.from(raw.text) }); await page.locator('#wbRestoreInstall').waitFor(); await page.locator('#wbRestoreInstall').click(); await page.waitForFunction(id => HaedoLife.Shell.storage.getActive().then(active => active !== id), f.workspaceId); await page.locator('.life-workbench[data-mode="page"]').waitFor();
      const copy = await current(page), book = copy.workbench.books[0], sourceIds = new Set(copy.bundle.sourceVersions.map(version => version.id)), gaps = book.chapters.map(chapter => chapter.versionIds.filter(id => !sourceIds.has(id)));
      assert.notEqual(copy.bundle.workspaceId, f.workspaceId); assert.equal(copy.workbench.books.length, 2); assert.notEqual(book.id, seed.books[0].id); assert(book.chapters.every((chapter, index) => chapter.id !== seed.books[0].chapters[index].id)); assert.deepEqual(gaps[0], gaps[1]); assert.equal(gaps[0].length, 1); assert.notEqual(gaps[0][0], seed.gap); assert.deepEqual(copy.workbench.groups[0].versionIds, gaps[0]);
      assert.equal(copy.bundle.sourceVersions.find(version => version.id === book.chapters[0].versionIds[0]).contentText, oldBody); assert.equal(book.chapters[0].versionIds[0], book.chapters[1].versionIds[1]); assert.equal(book.chapters[0].note, manuscript); assert.equal(copy.workbench.reflection.note, legacyNote);
      const record = copy.bundle.records[0], ref = record.sourceRefs[0], version = copy.bundle.sourceVersions.find(version => version.id === ref.sourceVersionId); assert.equal(version.contentText.slice(ref.locator.start, ref.locator.end), record.text); assert.equal(version.contentText, oldBody); assert.equal(await page.evaluate(id => HaedoLife.Shell.storage.getSyncState(id), copy.bundle.workspaceId), null);
      assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), f.workspaceId), before.bundle); assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.readWorkbench(id), f.workspaceId), before.workbench);
      await go(page); await openBook(page, book.id); assert.match(await page.locator(`#wbChapterSources .wb-source[data-version-id="${gaps[0][0]}"]`).textContent(), /연결된 원문 없음/); await details(page, '책 원고 파일로 보관'); const exported = await download(page, '#wbBookExport'); assert(exported.text.includes('연결된 원문 없음')); assert(!exported.text.includes(latestBody));
    });
    await check('books and legacy reflection remain isolated across workspaces and account changes', 820, async ({ page, server, device }) => {
      const f = await fixture(page), seed = await seedBooks(page, f); await openBook(page, seed.books[0].id); await openManagement(page); await page.getByRole('button', { name: '내보내기·사본 복원', exact: true }).click(); await page.locator('#lifeNewWorkspaceName').fill('책을 따로 쓰는 익명 공간'); await page.getByRole('button', { name: '빈 작업공간 만들기', exact: true }).click(); await settle(page); const other = (await current(page)).bundle.workspaceId; assert.notEqual(other, f.workspaceId);
      await go(page); assert.equal((await current(page)).workbench.books, undefined); const second = await createBook(page, '다른 공간의 책'); await createChapter(page, '다른 공간의 장'); await page.locator('#wbChapterNote').fill('다른 공간에서만 보여야 하는 문장.'); await save(page);
      await openManagement(page); await page.locator('#lifeWorkspace').selectOption(f.workspaceId); await settle(page); await go(page); await openBook(page, seed.books[0].id); assert.equal(await page.locator('#wbChapterNote').inputValue(), manuscript); assert.deepEqual((await current(page)).workbench.reflection, f.legacy);
      await switchAccount(page, server, device, accounts.b); assert.equal((await current(page)).workbench.books, undefined); assert.equal((await current(page)).workbench.reflection.note, ''); assert.equal(await page.evaluate(async id => { try { await HaedoLife.Shell.storage.read(id); return false; } catch (_) { return true; } }, f.workspaceId), true);
      await createBook(page, '계정 B만의 책'); await switchAccount(page, server, device, accounts.a); assert.equal((await current(page)).bundle.workspaceId, f.workspaceId); assert.equal((await current(page)).workbench.books.length, 2); assert.deepEqual((await current(page)).workbench.reflection, f.legacy); assert.equal(await page.evaluate(async id => (await HaedoLife.Shell.storage.readWorkbench(id)).books[0].id, other), second.id);
    });
    assert(report.checks.length > 0); report.pass = report.checks.every(check => check.pass) && !report.consoleErrors.length && !report.pageErrors.length && !report.external.length;
  } finally { await browser.close(); report.finishedAt = new Date().toISOString(); const json = JSON.stringify(report, null, 2); await fs.writeFile(path.join(out, 'run-' + report.createdAt.replace(/[:.]/g, '-') + '.json'), json); await fs.writeFile(path.join(out, 'browser-report.json'), json); }
  console.log(JSON.stringify({ checks: report.checks.length, passed: report.checks.filter(check => check.pass).length, visual: report.visual.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length, report: path.join(out, 'browser-report.json') })); if (!report.pass) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); annotation(error); process.exitCode = 1; });

module.exports = { fixture, go, current, save, details, download, capture, openBook, createBook, createChapter, chapterPicker, evidence, seedBooks, switchAccount, oldBody, latestBody, legacyNote, manuscript, specs };

/* Actual local app/IndexedDB and anonymous intercepted Auth. This checks private
 * page editing, not Google OAuth, operating publication or Apple hardware. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, observe, nav } = require('./unified-home-browser.cjs');
const { current } = require('./life-workbench-browser.cjs');
const baseline = process.env.PAGE_FLOW_BASELINE === '1';
const out = path.resolve('.local/product-flow-quality');
const comment = '페이지에 남긴 생각. 원문과 개인 자료 메모를 바꾸지 않고 이 구성에서만 다듬는다.\n다음 독서에서 확인할 질문을 남긴다.';
async function go(page) {
  await page.goto(base + '/index.html?section=records&view=page'); await ready(page); await settle(page);
  await page.locator('.life-workbench[data-mode="page"][aria-busy="false"]').waitFor();
}
async function fixture(page) {
  await go(page);
  const f = await page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, refs = [], ids = [];
    let b = await s.read(await s.getActive());
    for (const title of ['산책에서 떠오른 질문', '다시 읽고 싶은 책', '관찰을 남긴 사진', '오래 머무는 문장']) {
      const text = title + '.\n' + Array.from({ length: 14 }, (_, i) => `${i + 1}번째 문단. 천천히 읽으며 생각을 확인한다. 오래된 원문은 최신 버전으로 대신 열지 않고 그대로 다시 읽는다.`).join('\n\n');
      const p = await c.prepareImport({ origin: 'apple_notes', title, text, authorRelation: 'self', coverage: 'full_text', forceSeparate: true }, b);
      const result = await s.commitLocal({ workspaceId: b.workspaceId, baseRevision: b.revision, operationId: c.id(),
        changes: c.buildImportChanges(b, p, [{ start: 0, end: title.length, topic: '익명 질문', note: '개인 자료 메모. 페이지 코멘트와는 별도다.' }]) });
      if (result.status !== 'stored') throw Error('Anonymous source fixture failed');
      refs.push({ sourceId: p.source.id, versionId: p.version.id }); b = await s.read(b.workspaceId);
    }
    const wb = await s.readWorkbench(b.workspaceId);
    wb.page.title = '읽으며 남긴 생각'; wb.page.intro = '원문을 따로 보관하고 페이지에서 생각을 정리한다.';
    refs.forEach((ref, index) => {
      const id = c.id(); ids.push(id);
      wb.page.entries.push({ id, title: ['산책의 질문', '책의 질문', '사진의 질문', '문장의 질문'][index], parts: [{ versionId: ref.versionId, enabled: true }],
        note: '각 항목의 페이지 코멘트 ' + index, pinned: index % 2 === 1, enabled: true, showBody: false, showNote: true });
    });
    await s.saveWorkbench(b.workspaceId, wb, wb.revision);
    const newer = await c.prepareImport({ origin: 'apple_notes', title: '수정한 문장의 제목', text: '최신 원문에는 다른 내용이 있다.', existingSourceId: refs[3].sourceId }, b);
    const result = await s.commitLocal({ workspaceId: b.workspaceId, baseRevision: b.revision, operationId: c.id(), changes: c.buildImportChanges(b, newer) });
    if (result.status !== 'stored') throw Error('Anonymous second version fixture failed');
    return { workspaceId: b.workspaceId, ids, refs };
  });
  await page.reload(); await ready(page); await page.locator('.wb-page-entry').first().waitFor(); return f;
}
const displayed = page => page.locator('.wb-page-entries > .wb-page-entry').evaluateAll(nodes => nodes.map(node => node.dataset.entryId));
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), baseline, browser: browser.version(), scope: 'Actual app, SDK and IndexedDB with anonymous HTTP; Chromium viewport/touch simulation, no operating writes or Apple hardware.', checks: [], observations: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0 };
  try {
    for (const width of [1440, 820, 390]) {
      const server = new FakeCloud(), context = await makeContext(browser, server, 'page-quality-' + width, accounts.a, { viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width <= 820 });
      await context.route('**/*', route => {
        const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback();
        report.external.push(url.origin); return route.abort('blockedbyclient');
      });
      const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, 'page-' + width);
      try {
        const f = await fixture(page), original = (await current(page)).bundle;
        const pinned = page.locator('.wb-page-entry[data-entry-id="' + f.ids[1] + '"]');
        await pinned.locator('.wb-page-entry-open').click();
        const upInitiallyDisabled = await pinned.getByRole('button', { name: '위로', exact: true }).isDisabled(), beforeOrder = await displayed(page);
        await page.screenshot({ path: path.join(out, `page-${baseline ? 'before' : 'after'}-${width}.png`), fullPage: true });
        await pinned.getByRole('button', { name: '아래로', exact: true }).click();
        const afterOrder = await displayed(page);
        report.observations.push({ width, scene: 'pinned-order', upInitiallyDisabled, beforeOrder, afterOrder });
        if (!baseline) {
          assert.equal(upInitiallyDisabled, true); assert.deepEqual(beforeOrder, [f.ids[1], f.ids[3], f.ids[0], f.ids[2]]);
          assert.deepEqual(afterOrder, [f.ids[3], f.ids[1], f.ids[0], f.ids[2]]);
          assert.equal(await pinned.getByRole('button', { name: '아래로', exact: true }).isDisabled(), true);
          const plain = page.locator('.wb-page-entry[data-entry-id="' + f.ids[0] + '"]'); await plain.locator('.wb-page-entry-open').click();
          assert.equal(await plain.getByRole('button', { name: '위로', exact: true }).isDisabled(), true);
          await plain.getByRole('button', { name: '아래로', exact: true }).click(); assert.deepEqual(await displayed(page), [f.ids[3], f.ids[1], f.ids[2], f.ids[0]]);
        }
        const edit = page.locator('.wb-page-entry[data-entry-id="' + f.ids[3] + '"]'); await edit.locator('.wb-page-entry-open').click();
        await edit.getByLabel('원문 본문 표시', { exact: true }).check(); const input = edit.getByLabel('내 코멘트', { exact: true }); await input.fill(comment.repeat(8));
        await input.evaluate(el => { el.setSelectionRange(13, 31, 'backward'); el.scrollTop = 65; el.focus(); });
        const position = await input.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection, top: el.scrollTop }));
        await page.locator('#wbPagePreview').click(); await page.locator('#wbVisitor').waitFor();
        const previewEntry = page.locator('#wbVisitor article[data-entry-id="' + f.ids[3] + '"]');
        assert((await previewEntry.textContent()).includes(comment));
        assert.equal(await previewEntry.locator('.wb-source[data-version-id="' + f.refs[3].versionId + '"]').count(), 1);
        assert(!(await previewEntry.textContent()).includes('최신 원문에는 다른 내용이 있다.')); assert(!(await previewEntry.textContent()).includes('개인 자료 메모.'));
        await page.locator('#wbPagePreview').click(); await page.locator('#wbVisitor').waitFor({ state: 'detached' });
        const editorOpen = await edit.locator('.wb-page-entry-edit').evaluate(el => el.open);
        const restored = await input.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection, top: el.scrollTop }));
        report.observations.push({ width, scene: 'preview-return', editorOpen, before: position, after: restored });
        if (!baseline) {
          assert.equal(editorOpen, true); assert.deepEqual(restored, position); assert.equal(await input.evaluate(el => document.activeElement === el), true);
          await input.press('ArrowRight'); await input.press('End'); await input.press('X'); await page.locator('#wbPagePreview').click(); await page.locator('#wbVisitor').waitFor();
          assert((await previewEntry.textContent()).includes('X')); await page.locator('#wbPagePreview').click();
          await nav(page, 'tools'); await nav(page, 'records'); await edit.locator('.wb-page-entry-edit').waitFor();
          assert.equal(await edit.locator('.wb-page-entry-edit').evaluate(el => el.open), true);
          assert.deepEqual((await current(page)).bundle, original);
          await page.reload(); await ready(page); await edit.waitFor(); assert((await edit.locator('.wb-page-content .wb-comment-body').textContent()).includes('X'));
          assert.deepEqual(await displayed(page), [f.ids[3], f.ids[1], f.ids[2], f.ids[0]]); assert.deepEqual((await current(page)).bundle, original);
          // A real IndexedDB abort blocks preview, retains the editable draft and
          // offers recovery before the retry publishes any saved-state claim.
          await edit.locator('.wb-page-entry-open').click(); await input.evaluate(el => { window.__pageInput = el; });
          await page.evaluate(() => {
            window.__pagePut = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function (value, ...args) { const result = __pagePut.call(this, value, ...args); if (this.name === 'meta' && value?.key.startsWith('workbench:')) this.transaction.abort(); return result; };
          });
          await input.fill('저장에 실패해도 보존할 페이지 코멘트'); await page.locator('#wbPagePreview').click(); await page.locator('#wbError').waitFor({ state: 'visible' });
          assert.equal(await page.locator('#wbVisitor').count(), 0); assert.equal(await input.inputValue(), '저장에 실패해도 보존할 페이지 코멘트');
          assert.equal(await input.evaluate(el => el === __pageInput), true);
          await page.evaluate(() => { IDBObjectStore.prototype.put = __pagePut; }); await page.locator('#wbError').getByRole('button', { name: '다시 저장', exact: true }).click();
          await page.locator('#wbPagePreview').click(); await page.locator('#wbVisitor').waitFor(); assert((await previewEntry.textContent()).includes('저장에 실패해도 보존할 페이지 코멘트'));
          assert.equal(server.writes().length, 0); assert.deepEqual((await current(page)).bundle, original);
        }
        report.checks.push({ width, pass: true });
      } catch (error) {
        report.checks.push({ width, pass: false, error: error.stack }); console.error('FAIL ' + width + '\n' + error.stack);
        await page.screenshot({ path: path.join(out, 'page-failure-' + width + '.png'), fullPage: true }).catch(() => {});
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await fs.writeFile(path.join(out, baseline ? 'page-before-report.json' : 'page-after-report.json'), JSON.stringify(report, null, 2) + '\n'); }
  assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []);
  console.log(`Page flow quality: ${report.checks.filter(value => value.pass).length}/${report.checks.length}; baseline=${baseline}.`);
  if (report.checks.some(value => !value.pass)) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

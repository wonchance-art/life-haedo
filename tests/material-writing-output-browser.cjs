/* Confirmed post deletion → retained preparation → explicit fresh preparation.
 * Actual application/IndexedDB in Chromium; synthetic Auth HTTP only. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4311';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { FakeCloud, base } = require('./life-sync-browser.cjs');
const output = path.resolve(__dirname, '../.local/e1-deleted-output/browser');
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const report = { checks: [], pageErrors: [], consoleErrors: [], browser: browser.version(), scope: 'Synthetic Auth/FakeCloud; actual app and IndexedDB. No real account, production DB or Apple hardware.' };
  try {
    for (const width of [1440, 390]) {
      const server = new FakeCloud(), context = await makeContext(browser, server, `output-${width}`, undefined, { viewport: { width, height: 1000 } });
      try {
        const page = await context.newPage(); page.on('pageerror', error => report.pageErrors.push(error.message));
        page.on('console', entry => { if (entry.type() === 'error') report.consoleErrors.push(entry.text()); });
        await page.goto(base + '/index.html?section=records&view=page'); await ready(page);
        const seeded = await page.evaluate(async () => {
          const s = HaedoLife.Shell.storage, C = HaedoLife.Core, M = HaedoLife.MaterialWriting, ws = await s.getActive();
          const state = await s.readMaterialWriting(ws), plan = M.create(C.id); plan.title = '삭제 후에도 남길 작성 준비'; plan.question = '준비에만 남길 익명 질문';
          plan.blocks = [{ id: C.id(), kind: 'paragraph', text: '새 준비에서 계속 쓸 익명 문단' }]; state.plans.push(plan);
          const saved = await s.saveMaterialWriting(ws, state, state.revision), created = await s.createMaterialWritingPost(ws, plan.id, saved.revision);
          let post = await s.readPhotoPost(ws, created.postId); post.status = 'saved'; post = await s.savePhotoPost(ws, post, post.revision);
          await s.deletePhotoPost(ws, post.id, post.revision);
          return { ws, planId: plan.id, postId: post.id };
        });
        await page.locator('#wbPageMaterialWriting').click();
        await page.locator('#mwDeletedCopy').waitFor();
        assert.equal(await page.locator('#mwContinue').count(), 0);
        assert.match(await page.locator('.mw-output').innerText(), /글을 삭제했습니다/);
        await page.waitForFunction(() => document.querySelector('.mw-output-tools')?.dataset.state === 'deleted');
        assert.equal(await page.locator('#mwManageOutput').isVisible(), false);
        assert.equal(await page.locator('#mwPreserveOutput').isVisible(), false);
        assert.match(await page.locator('#mwOutputStatus').innerText(), /지웠|삭제/);
        assert.equal(await page.locator('#mwQuestion').inputValue(), '준비에만 남길 익명 질문');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        await page.screenshot({ path: path.join(output, `deleted-${width}.png`), fullPage: true });
        await page.locator('#mwDeletedCopy').click();
        await page.waitForFunction(id => document.querySelector('#mwPlanSelect')?.value !== id, seeded.planId);
        await page.waitForFunction(() => document.querySelector('.mw-status')?.dataset.state === 'saved');
        const result = await page.evaluate(async ({ ws, planId, postId }) => {
          const s = HaedoLife.Shell.storage, state = await s.readMaterialWriting(ws), selected = document.querySelector('#mwPlanSelect').value;
          const original = state.plans.find(plan => plan.id === planId), fresh = state.plans.find(plan => plan.id === selected);
          return { oldReferencePreserved: original.output.postId === postId, fresh: { output: fresh.output, question: fresh.question, text: fresh.blocks[0].text }, posts: (await s.listPhotoPosts(ws)).length };
        }, seeded);
        assert.equal(result.oldReferencePreserved, true); assert.deepEqual(result.fresh, { output: null, question: '준비에만 남길 익명 질문', text: '새 준비에서 계속 쓸 익명 문단' }); assert.equal(result.posts, 0);
        await page.locator('#mwPreview').click(); await page.locator('#mwConsent').waitFor();
        assert.match(await page.locator('#mwPreviewContent').innerText(), /새 준비에서 계속 쓸 익명 문단/);
        assert.equal(await page.locator('#mwContinue').count(), 0);
        await page.screenshot({ path: path.join(output, `fresh-${width}.png`), fullPage: true });
        const remote = await page.evaluate(async () => {
          const s = HaedoLife.Shell.storage, C = HaedoLife.Core, M = HaedoLife.MaterialWriting, ws = await s.getActive(), state = await s.readMaterialWriting(ws);
          const plan = M.create(C.id); plan.title = '다른 기기 삭제 검수'; plan.blocks = [{ id: C.id(), kind: 'paragraph', text: '삭제 뒤에도 남을 준비 문단' }]; state.plans.push(plan);
          const saved = await s.saveMaterialWriting(ws, state, state.revision), created = await s.createMaterialWritingPost(ws, plan.id, saved.revision), post = await s.readPhotoPost(ws, created.postId);
          const binding = await s.writeBlogSyncState(ws, post.id, { remoteId: C.id(), enabled: true, remoteRevision: 1, localRevision: post.revision });
          return { ws, planId: plan.id, postId: post.id, revision: post.revision, bindingRevision: binding.revision };
        });
        await page.waitForFunction(id => Array.from(document.querySelector('#mwPlanSelect')?.options || []).some(option => option.value === id), remote.planId);
        await page.locator('#mwPlanSelect').selectOption(remote.planId); await page.locator('#mwContinue').waitFor();
        await page.locator('#mwTitle').evaluate(node => { node.focus(); node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); node.value = '조합 중인 내 제목'; node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true })); node.dataset.e1Ime = 'preserve'; });
        await page.evaluate(async value => HaedoLife.Shell.storage.commitBlogSync(value.ws, { postId: value.postId, remove: true, baseRevision: value.revision, bindingRevision: value.bindingRevision }), remote);
        await page.locator('#mwDeletedCopy').waitFor();
        await page.waitForFunction(() => document.querySelector('.mw-output-tools')?.dataset.state === 'deleted');
        assert.equal(await page.locator('#mwContinue').count(), 0); assert.equal(await page.locator('#mwManageOutput').isVisible(), false);
        assert.equal(await page.locator('#mwTitle').inputValue(), '조합 중인 내 제목'); assert.equal(await page.locator('#mwTitle').getAttribute('data-e1-ime'), 'preserve');
        assert.equal(await page.locator('#mwIncoming').isVisible(), true);
        await page.screenshot({ path: path.join(output, `remote-delete-ime-${width}.png`), fullPage: true });
        report.checks.push({ width, confirmedDeletion: true, deadActionsRemoved: true, exactPreparationRetained: true, explicitFreshPreparation: true, remoteDeletePreservesIME: true });
      } finally { await context.close(); }
    }
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []);
  } finally { await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify(report));
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

/* Confirmed post deletion → retained preparation → explicit fresh preparation.
 * Actual application/IndexedDB in Chromium; synthetic Auth HTTP only. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4311';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { FakeCloud, base, cloud } = require('./life-sync-browser.cjs');
const output = path.resolve(process.env.MATERIAL_OUTPUT_OUTPUT_DIR || path.join(__dirname, '../.local/e1-deleted-output/browser'));
const sharedDeleted = '이 준비에서 만든 글을 삭제했습니다. 준비와 자료는 남아 있습니다. 새 준비 사본을 만들어 다시 시작할 수 있습니다.';
async function contextFor(browser, report, device, width) {
  const context = await makeContext(browser, new FakeCloud(), device, undefined, { viewport: { width, height: 1000 } });
  if (process.env.MATERIAL_OUTPUT_UI_OVERRIDE) {
    const source = await fs.readFile(process.env.MATERIAL_OUTPUT_UI_OVERRIDE, 'utf8');
    await context.route('**/assets/life/material-writing-ui.js', route => route.fulfill({ contentType: 'application/javascript', body: source }));
  }
  return context;
}
function observe(page, report) {
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error') report.consoleErrors.push(entry.text()); });
  page.on('request', request => {
    if (!['data:', 'blob:'].some(prefix => request.url().startsWith(prefix)) &&
        ![new URL(base).origin, new URL(cloud).origin].includes(new URL(request.url()).origin)) report.external.push(request.url());
  });
}
async function continuityRecovery(browser, report, width, mode) {
  const context = await contextFor(browser, report, `output-${mode}-${width}`, width);
  try {
    const page = await context.newPage(); observe(page, report);
    await page.goto(base + '/index.html?section=records&view=page'); await ready(page);
    const seeded = await page.evaluate(async mode => {
      const s = HaedoLife.Shell.storage, C = HaedoLife.Core, M = HaedoLife.MaterialWriting, ws = await s.getActive();
      const originalBundle = await s.read(ws), raw = '정확한 원문 🌱\r\n새 사본에서도 바꾸지 않을 문장';
      const imported = await C.prepareImport({ title: '삭제 준비의 익명 근거', text: raw, origin: 'obsidian', fileName: '익명 근거.md' }, originalBundle);
      const changes = C.buildImportChanges(originalBundle, imported);
      const stored = await s.commitLocal({ workspaceId: ws, baseRevision: originalBundle.revision, operationId: C.id(), changes });
      if (stored.status !== 'stored') throw Error('Synthetic source was not stored');
      const bundle = await s.read(ws), state = await s.readMaterialWriting(ws), plan = M.create(C.id), other = M.create(C.id);
      plan.title = '삭제 준비의 조회와 복구'; plan.question = '그대로 남길 비공개 질문';
      plan.blocks = [{ id: C.id(), kind: 'paragraph', text: '새 준비에서 이어 쓸 문단' }];
      plan.materials.push(M.material(bundle, imported.source.id, imported.version.id, C.id));
      other.title = '늦은 조회가 바꾸면 안 되는 다른 준비'; state.plans.push(plan, other);
      const saved = await s.saveMaterialWriting(ws, state, state.revision);
      const created = await s.createMaterialWritingPost(ws, plan.id, saved.revision);
      const post = await s.readPhotoPost(ws, created.postId); await s.deletePhotoPost(ws, post.id, post.revision);
      const before = (await s.readMaterialWriting(ws)).plans.find(value => value.id === plan.id);
      if (mode === 'account-head') {
        const row = { id: C.id(), revision: 1, data: HaedoLife.MaterialContinuity.snapshot(bundle, before, null) };
        await s.writeMaterialContinuityState(ws, plan.id, { binding: s.account, enabled: true, remoteId: row.id,
          remoteRevision: row.revision, head: row, mapping: null, output: null, pending: null, conflict: null, localClaim: null, error: null }, 0);
      }
      // Inject only the UI's optional read. The primary deleted-output lookup,
      // persisted continuity state, copies, saves and other managers stay real.
      const create = HaedoLife.MaterialWritingUI.create;
      const control = window.__outputContinuity = { calls: 0, mode, hold: false, started: false, settled: false, observedHead: false };
      HaedoLife.MaterialWritingUI = Object.freeze({ create(options) {
        return create({ ...options, storage: { ...options.storage, async readMaterialContinuityState(workspaceId, planId) {
          if (workspaceId !== ws || planId !== plan.id) return options.storage.readMaterialContinuityState(workspaceId, planId);
          control.calls++;
          try {
            if (control.hold) { control.started = true; await new Promise(resolve => { control.release = resolve; }); }
            if (control.mode === 'lookup-failure') throw Object.assign(Error('Synthetic optional continuity lookup failed'), { code: 'storage_error' });
            const value = await options.storage.readMaterialContinuityState(workspaceId, planId);
            control.observedHead = !!value?.head && value.output === null && value.head.data.output === null; return value;
          } finally { control.settled = true; }
        } } });
      } });
      return { ws, planId: plan.id, otherId: other.id, postId: post.id, before, raw, sourceId: imported.source.id, versionId: imported.version.id };
    }, mode);
    await page.locator('#wbPageMaterialWriting').click();
    await page.waitForFunction(() => document.querySelector('#mwDeletedCopy') || document.querySelector('#mwOutputRetry'));
    assert.equal(await page.locator('#mwDeletedCopy').count(), 1, `${mode}: optional lookup must retain the copy action`);
    assert.equal(await page.locator('#mwOutputRetry').count(), 0, `${mode}: optional lookup does not replace the confirmed deletion`);
    assert.equal(await page.locator('.mw-output .life-help').innerText(), sharedDeleted, `${mode}: use the shared deletion notice`);
    assert.equal(await page.locator('.mw-output').getByRole('button', { name: '새 준비 사본 만들기', exact: true }).count(), 1);
    assert(await page.evaluate(() => __outputContinuity.calls > 0));
    if (mode === 'account-head') assert.equal(await page.evaluate(() => __outputContinuity.observedHead), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: path.join(output, `${mode}-${width}.png`), fullPage: true });

    // Both late success and late rejection must leave the new preparation and
    // detached placeholder untouched after the user switches preparations.
    await page.locator('#mwPlanSelect').selectOption(seeded.otherId);
    await page.evaluate(() => { __outputContinuity.hold = true; __outputContinuity.started = __outputContinuity.settled = false; });
    await page.locator('#mwPlanSelect').selectOption(seeded.planId);
    await page.waitForFunction(() => __outputContinuity.started);
    await page.evaluate(() => { window.__retiredOutputPlaceholder = document.querySelector('.mw-output .life-help'); });
    await page.locator('#mwPlanSelect').selectOption(seeded.otherId);
    const nextOutput = await page.locator('.mw-output').innerText();
    await page.evaluate(() => { __outputContinuity.hold = false; __outputContinuity.release(); });
    await page.waitForFunction(() => __outputContinuity.settled);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await page.locator('.mw-output').innerText(), nextOutput);
    assert.equal(await page.locator('#mwTitle').inputValue(), '늦은 조회가 바꾸면 안 되는 다른 준비');
    assert.deepEqual(await page.evaluate(() => ({ connected: __retiredOutputPlaceholder.isConnected, text: __retiredOutputPlaceholder.textContent })),
      { connected: false, text: '연결한 글을 확인하는 중…' });

    await page.locator('#mwPlanSelect').selectOption(seeded.planId); await page.locator('#mwDeletedCopy').waitFor();
    await page.locator('.mw-output').getByRole('button', { name: '새 준비 사본 만들기', exact: true }).focus();
    assert.equal(await page.locator('#mwDeletedCopy').evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Enter');
    await page.waitForFunction(id => document.querySelector('#mwPlanSelect')?.value !== id, seeded.planId);
    const freshId = await page.locator('#mwPlanSelect').inputValue();
    await page.locator('#mwTitle').fill('새 준비 사본에서 이어 쓴 제목');
    await page.locator('#mwQuestion').fill('새 사본에만 이어 쓴 비공개 질문');
    await page.locator('#mwBlocks [data-kind="paragraph"] textarea').fill('새 사본의 본문에 이어 쓴 문장\n🌱 원래 준비는 그대로 남깁니다.');
    await page.locator('.mw-status[data-state="saved"]').waitFor();
    await page.locator('#mwPlanSelect').selectOption(seeded.otherId);
    await page.locator('#mwPlanSelect').selectOption(freshId);
    assert.equal(await page.locator('#mwTitle').inputValue(), '새 준비 사본에서 이어 쓴 제목');
    assert.equal(await page.locator('#mwQuestion').inputValue(), '새 사본에만 이어 쓴 비공개 질문');
    assert.equal(await page.locator('#mwBlocks [data-kind="paragraph"] textarea').inputValue(), '새 사본의 본문에 이어 쓴 문장\n🌱 원래 준비는 그대로 남깁니다.');
    const result = await page.evaluate(async seed => {
      const s = HaedoLife.Shell.storage, state = await s.readMaterialWriting(seed.ws), bundle = await s.read(seed.ws);
      const fresh = state.plans.find(value => value.id === document.querySelector('#mwPlanSelect').value);
      return { original: state.plans.find(value => value.id === seed.planId), fresh,
        posts: (await s.listPhotoPosts(seed.ws)).length,
        output: await s.readMaterialWritingOutput(seed.ws, seed.planId),
        raw: bundle.sourceVersions.find(value => value.id === seed.versionId).contentText };
    }, seeded);
    assert.deepEqual(result.original, seeded.before, 'continuing in the copy must preserve the original preparation');
    assert.equal(result.fresh.output, null); assert.equal(result.posts, 0);
    assert.deepEqual(result.output, { status: 'deleted', postId: seeded.postId });
    assert.equal(result.fresh.materials[0].sourceId, seeded.sourceId); assert.equal(result.fresh.materials[0].sourceVersionId, seeded.versionId);
    assert.equal(result.raw, seeded.raw);
    assert.equal(result.fresh.blocks[0].text, '새 사본의 본문에 이어 쓴 문장\n🌱 원래 준비는 그대로 남깁니다.');
    assert.notEqual(result.fresh.blocks[0].id, seeded.before.blocks[0].id);
    await page.screenshot({ path: path.join(output, `${mode}-continued-${width}.png`), fullPage: true });
    report.checks.push({ width, scenario: mode, sharedDeletionNotice: true, copyActionRetained: true, lateLookupIsolated: true,
      keyboardCopy: true, originalAndExactSourcePreserved: true, continuedCopyReopened: true });
  } finally { await context.close(); }
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const uiPath = process.env.MATERIAL_OUTPUT_UI_OVERRIDE || path.resolve(__dirname, '../assets/life/material-writing-ui.js');
  const report = { checks: [], pageErrors: [], consoleErrors: [], external: [], browser: browser.version(),
    uiSha256: createHash('sha256').update(await fs.readFile(uiPath)).digest('hex'), uiOverride: !!process.env.MATERIAL_OUTPUT_UI_OVERRIDE,
    scope: 'Synthetic Auth/FakeCloud; actual app and IndexedDB. No real account, production DB or Apple hardware.' };
  try {
    for (const width of [1440, 390]) {
      const context = await contextFor(browser, report, `output-${width}`, width);
      try {
        const page = await context.newPage(); observe(page, report);
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
        assert.match(await page.locator('.mw-output').innerText(), /이 기기에만 있는 준비/);
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
      for (const mode of ['lookup-failure', 'account-head']) await continuityRecovery(browser, report, width, mode);
    }
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.external, []);
  } finally { await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify(report));
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

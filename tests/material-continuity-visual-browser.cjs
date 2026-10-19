'use strict';
// Independent view/input checks. The integration suite owns the complete A/B,
// public-media and evidence-file journey; its real source fixture is reused here.
process.env.BASE_URL ||= 'http://127.0.0.1:4215';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { LocalSQLMaterialCloud } = require('./material-continuity-sql-fixture.cjs');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { seedMaterials, seedPlan, enter, saved, readPreparation } = require('./material-writing-browser.cjs');
const { seedContinuity, connect, call, uiReceive } = require('./material-continuity-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const newSourceOnly = process.argv.includes('--new-source-only');
const output = path.resolve(__dirname, '../.local/material-continuity-visual' + (newSourceOnly ? '-new-source' : ''));
const migration = 'supabase/migrations/20261019005829_life_material_continuity.sql';

async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  await fs.mkdir(output, { recursive: true });
  const databaseBase = (process.env.BLOG_POSTGRES_DATABASE || 'haedo_blog_qa').slice(0, 32);
  const server = new LocalSQLMaterialCloud({ container: process.env.BLOG_POSTGRES_CONTAINER,
    database: databaseBase + '_material_visual_' + process.pid });
  await server.prepare(migration); await server.initialize();
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const context = await makeContext(browser, server, 'material-continuity-visual', accounts.a, { viewport: { width: 820, height: 1000 } });
  const report = { checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0,
    browser: browser.version(), node: process.version,
    scope: 'Real workbench/preparation/continuity UI, SDK, IndexedDB and isolated PostgreSQL material RPCs. Shared synthetic source fixture and synthetic Auth. Composition events and viewport simulation; no Apple/native IME/Google OAuth, production, installation, merge or deployment claims.' };
  await context.route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    if ([new URL(base).origin, cloud].includes(origin)) return route.fallback();
    report.external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (message.location().url.startsWith(cloud) && /Failed to load resource:.*ERR_FAILED/.test(message.text()) && server.expectedFailures > report.expectedErrors) report.expectedErrors++;
    else report.consoleErrors.push(message.text());
  });
  const writes = () => server.materialRequests.filter(entry => entry.rpc === 'life_material_put');
  const idle = () => page.waitForFunction(() => {
    const panel = document.getElementById('mcPanel');
    return panel && panel.getAttribute('aria-busy') !== 'true' && !!document.getElementById('mcStatus')?.dataset.state;
  });
  async function panel() { await page.locator('#mcPanel').waitFor(); if (!await page.locator('#mcPanel').evaluate(node => node.open)) await page.locator('#mcPanel > summary').click(); await idle(); }
  async function click(id) { await page.locator(id).click(); await idle(); }
  async function capture(scene, widths = [1440, 820, 390]) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => { document.activeElement?.blur(); document.querySelector('#mcPanel > summary')?.scrollIntoView({ block: 'start', behavior: 'instant' }); });
      const metrics = await page.evaluate(inspect);
      assert.equal(metrics.horizontalOverflow, false, scene + ': overflow');
      for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ': ' + key);
      const file = scene + '-' + width + '.png', fullFile = scene + '-' + width + '-full.png';
      await page.screenshot({ path: path.join(output, file) });
      await page.screenshot({ path: path.join(output, fullFile), fullPage: true });
      report.visual.push({ scene, width, file, fullFile, metrics });
    }
    await page.setViewportSize({ width: 820, height: 1000 });
  }
  async function check(name, run) {
    if (newSourceOnly && !name.startsWith('Receiving a new source')) return;
    console.log('START ' + name); await run(); report.checks.push(name); console.log('PASS ' + name);
  }
  try {
    await page.goto(base + '/index.html'); await ready(page);
    const fixture = await seedMaterials(page), planId = await seedPlan(page, fixture, '다른 기기에서도 정확한 자료와 내 생각으로 완성할 여행 글 🌱');
    const otherId = await seedPlan(page, fixture, '현재 입력을 보존할 두 번째 작성 준비');
    await enter(page, planId); await panel();
    await check('All private preparation fields and exact original texts are reviewed at three widths without a write or default consent', async () => {
      const before = writes().length; await click('#mcReview'); await page.locator('#mcReviewContent').waitFor();
      assert.equal(await page.locator('#mcConsent').isChecked(), false); assert.equal(writes().length, before);
      const review = await page.locator('#mcReviewContent').innerText(); assert(review.includes('PRIVATE_QUESTION_SENTINEL')); assert(review.includes('PRIVATE_NOTE_SENTINEL'));
      await page.locator('#mcReviewContent .mc-originals').evaluate(node => { node.open = true; });
      const full = await page.locator('#mcReviewContent').innerText(); assert(full.includes('PRIVATE_FULL_BODY_NOT_PUBLIC')); assert(full.includes('SECOND_UNQUOTED_BODY'));
      assert(!full.includes('LATEST_MUST_NOT_REPLACE_OLD'), 'The selected old version is not silently replaced');
      assert(full.includes('첫 자료.md')); assert(full.includes('익명 자료 작성자'));
      await capture('private-transfer-review');
    });
    await check('Composition and edits invalidate reviewed consent while preserving the real input node and caret', async () => {
      await page.locator('#mcConsent').check(); const count = writes().length;
      await page.locator('#mwQuestion').evaluate(node => {
        window.__continuityQuestion = node; node.focus(); node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        node.value = '개인 질문을 조합 중 한'; node.setSelectionRange(node.value.length, node.value.length);
        node.dispatchEvent(new InputEvent('input', { bubbles: true, data: '한', inputType: 'insertCompositionText', isComposing: true }));
      });
      await click('#mcConnect'); await page.locator('.mc-error:not([hidden])').waitFor();
      assert.equal(writes().length, count); assert.equal(await page.locator('#mwQuestion').evaluate(node => node === __continuityQuestion), true);
      assert.equal(await page.locator('#mwQuestion').inputValue(), '개인 질문을 조합 중 한');
      await page.locator('#mwQuestion').evaluate(node => { node.focus(); node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '한' })); }); await saved(page);
      // The earlier review still cannot authorize the changed question.
      await click('#mcConnect'); assert.equal(writes().length, count);
      assert.equal(await page.locator('#mcConsent').count(), 0, 'One-use review is consumed');
      assert.equal(await page.locator('#mwQuestion').inputValue(), '개인 질문을 조합 중 한');
      await capture('changed-review-error', [820]);
      await click('#mcReview'); await page.locator('#mcReviewContent').waitFor();
      assert.equal(await page.locator('#mcConsent').isChecked(), false);
      await page.locator('#mcConsent').check(); await click('#mcConnect');
      await page.waitForFunction(() => document.getElementById('mcStatus')?.dataset.state === 'synced');
    });
    await check('A delayed server-list response preserves active question input, caret and the current preparation', async () => {
      const gate = server.holdMaterialNext(entry => entry.rpc === 'life_material_list');
      await page.locator('#mcList').click(); await gate.arrived;
      try {
        await page.locator('#mwQuestion').fill('읽기 응답을 기다리는 동안 쓴 내 질문 🌱');
        await page.locator('#mwQuestion').evaluate(node => { window.__continuityFocused = node; node.focus(); node.setSelectionRange(4, 9); });
        gate.release(); await idle();
        assert.equal(await page.locator('#mwQuestion').evaluate(node => node === __continuityFocused && node === document.activeElement), true);
        assert.deepEqual(await page.locator('#mwQuestion').evaluate(node => [node.selectionStart, node.selectionEnd]), [4, 9]);
        assert.equal(await page.locator('#mwPlanSelect').inputValue(), planId); await saved(page);
      } finally { gate.release(); }
    });
    await check('A late preparation preview cannot replace another selected preparation or leave its old connection state', async () => {
      await page.evaluate(() => {
        const original = SubtleCrypto.prototype.digest;
        window.__continuityPreviewGate = { held: false, released: false };
        SubtleCrypto.prototype.digest = async function (...args) {
          const result = await original.apply(this, args);
          if (!__continuityPreviewGate.held) {
            __continuityPreviewGate.held = true;
            await new Promise(resolve => { window.__releaseContinuityPreview = () => { __continuityPreviewGate.released = true; SubtleCrypto.prototype.digest = original; resolve(); }; });
          }
          return result;
        };
      });
      await page.locator('#mcReview').click(); await page.waitForFunction(() => __continuityPreviewGate.held);
      try {
        await page.locator('#mwPlanSelect').selectOption(otherId);
        await page.waitForFunction(() => document.getElementById('mwTitle')?.value === '현재 입력을 보존할 두 번째 작성 준비');
        await page.locator('#mwQuestion').fill('새 준비의 입력을 남긴다');
        await page.locator('#mwQuestion').evaluate(node => { window.__continuitySecondInput = node; });
        await page.evaluate(() => __releaseContinuityPreview()); await idle();
        await page.waitForFunction(() => document.getElementById('mcStatus')?.dataset.state === 'not_enabled');
        assert.equal(await page.locator('#mwPlanSelect').inputValue(), otherId);
        assert.equal(await page.locator('#mwQuestion').evaluate(node => node === __continuitySecondInput), true);
        assert.equal(await page.locator('#mwQuestion').inputValue(), '새 준비의 입력을 남긴다');
        assert.equal(await page.locator('#mcReviewContent').count(), 0); await saved(page);
      } finally { await page.evaluate(() => __releaseContinuityPreview?.()); }
    });
    await check('The saved-output review shows additional evidence originals and actual photo metadata with a separate unchecked consent', async () => {
      await enter(page, planId); await panel();
      await click('#mcReview'); await page.locator('#mcConsent').check(); await click('#mcConnect');
      await page.locator('#mwPreview').click(); await page.locator('#mwConsent').check(); await page.locator('#mwCreate').click(); await page.locator('#photoTitle').waitFor();
      await page.locator('.photo-commandbar').getByRole('button', { name: '닫기', exact: true }).click(); await page.locator('#mwContinue').waitFor();
      await page.evaluate(async ({ ws, planId, versionId, sourceId }) => {
        const L = HaedoLife, s = L.Shell.storage, state = await s.readMaterialWriting(ws), postId = state.plans.find(p => p.id === planId).output.postId;
        const doc = await s.readPhotoPost(ws, postId), evidence = await s.readPostEvidence(ws, postId), bundle = await s.read(ws);
        const version = bundle.sourceVersions.find(v => v.id === versionId), extra = await L.SourceReference.build({ bundle, sourceId, versionId, locator: { start: 0, end: version.contentText.length } });
        const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 100; canvas.getContext('2d').fillRect(0, 0, 80, 100);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const photo = await L.PhotoPost.readPhoto(new File([blob], '범위 검토 사진.png', { type: 'image/png' }), L.Core.id);
        doc.status = 'saved'; doc.photos.push(photo);
        doc.ops.push({ insert: extra.quote + '\n' }, { insert: { photo: { id: photo.id, caption: '실제 사진 설명 🌱', alt: '실제 대체 텍스트' } } }, { insert: '\n' });
        await s.savePhotoPostWithEvidence(ws, doc, doc.revision, [...evidence.refs, extra], evidence.revision);
      }, { ws: fixture.workspaceId, planId, versionId: fixture.latestId, sourceId: fixture.first.sourceId });
      await enter(page, planId); await panel();
      const before = server.blogRequests.filter(entry => ['life_blog_save', 'life_blog_prepare_asset'].includes(entry.name)).length;
      await click('#mcOutputReview'); await page.locator('#mcOutputConsent').waitFor();
      assert.equal(await page.locator('#mcOutputConsent').isChecked(), false);
      await page.locator('#mcReviewContent .mc-originals').evaluateAll(nodes => nodes.forEach(node => { node.open = true; }));
      const text = await page.locator('#mcReviewContent').innerText();
      for (const value of ['LATEST_MUST_NOT_REPLACE_OLD', 'PRIVATE_FULL_BODY_NOT_PUBLIC', '범위 검토 사진.png', '실제 사진 설명 🌱', '실제 대체 텍스트']) assert(text.includes(value), value);
      assert.equal(server.blogRequests.filter(entry => ['life_blog_save', 'life_blog_prepare_asset'].includes(entry.name)).length, before, 'Reviewing originals does not upload them');
      await capture('saved-output-review');
      assert.equal(await page.locator('#mcOutputConsent').isChecked(), false);
    });
    await check('Receiving a new source in the same workspace updates the parent reader snapshot and returns to the exact preparation', async () => {
      const contexts = [];
      try {
        const devices = [];
        for (const name of ['material-visual-new-source-a', 'material-visual-new-source-b']) {
          const ctx = await makeContext(browser, server, name, accounts.a); contexts.push(ctx);
          await ctx.route('**/*', route => {
            const origin = new URL(route.request().url()).origin;
            if ([new URL(base).origin, cloud].includes(origin)) return route.fallback();
            report.external.push(route.request().url()); return route.abort();
          });
          const p = await ctx.newPage(); p.setDefaultTimeout(20000);
          p.on('pageerror', error => report.pageErrors.push(error.message));
          p.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
          await p.goto(base + '/index.html'); await ready(p); devices.push(p);
        }
        const [a, b] = devices, f = await seedContinuity(a, '새 정확 원문을 받아 다시 읽을 준비');
        await connect(a, f.workspaceId, f.planId);
        const state = await call(a, 'getState', [f.workspaceId, f.planId]);
        const received = await call(b, 'receive', [state.remoteId, state.remoteRevision]);
        // Mount A before B creates the new source: the shell must genuinely have
        // the previous bundle. Reloading the whole page after receive hides this defect.
        await enter(a, f.planId);
        const raw = 'B_ONLY_NEW_ORIGINAL_全文🌱\r\n새 버전의 정확한 원문';
        await b.evaluate(async ({ ws, planId, raw }) => {
          const L = HaedoLife, s = L.Shell.storage, bundle = await s.read(ws);
          const prepared = await L.Core.prepareImport({ origin: 'obsidian', author: '합성 저자', authorRelation: 'other',
            title: 'B에서 새로 추가한 원문', text: raw, url: 'https://example.org/new-exact-original', fileName: 'B신규.md' }, bundle);
          const result = await s.commitLocal({ workspaceId: ws, baseRevision: bundle.revision, operationId: L.Core.id(), changes: L.Core.buildImportChanges(bundle, prepared) });
          if (result.status !== 'stored') throw Error('Synthetic new source commit failed');
          const next = await s.read(ws), state = await s.readMaterialWriting(ws), plan = state.plans.find(p => p.id === planId);
          plan.materials.push(L.MaterialWriting.material(next, prepared.source.id, prepared.version.id, L.Core.id));
          await s.saveMaterialWriting(ws, state, state.revision);
        }, { ws: received.workspaceId, planId: received.planId, raw });
        await connect(b, received.workspaceId, received.planId);
        const result = await uiReceive(a, state.remoteId);
        assert.equal(result.workspaceId, f.workspaceId); assert.equal(result.planId, f.planId);
        const local = await a.evaluate(async ({ ws, planId, raw }) => {
          const s = HaedoLife.Shell.storage, bundle = await s.read(ws), state = await s.readMaterialWriting(ws);
          const version = bundle.sourceVersions.find(v => v.contentText === raw), plan = state.plans.find(p => p.id === planId);
          return { versionId: version.id, sourceId: version.sourceId, materialId: plan.materials.find(m => m.sourceVersionId === version.id).id };
        }, { ws: f.workspaceId, planId: f.planId, raw });
        await a.locator('.mw-material-tab[data-material-id="' + local.materialId + '"]').click();
        const card = a.locator('.mw-material[data-material-id="' + local.materialId + '"]');
        assert.equal(await card.locator('.mw-material-body').inputValue(), raw.replace(/\r\n/g, '\n'));
        await card.locator('.mw-material-open').click();
        await a.locator('#lifeMain[data-mode="source"] .life-reader').waitFor();
        assert((await a.locator('#lifeMain').innerText()).includes('B_ONLY_NEW_ORIGINAL_全文🌱'));
        assert(!(await a.locator('#lifeMain').innerText()).includes('요청한 원문 버전을 찾을 수 없습니다'));
        await a.getByRole('button', { name: '선택 자료 페이지로 돌아가기', exact: true }).click();
        await a.locator('#mwPlanSelect').waitFor(); assert.equal(await a.locator('#mwPlanSelect').inputValue(), f.planId);
        await a.locator('.mw-material-tab[data-material-id="' + local.materialId + '"]').click();
        assert.equal(await a.locator('.mw-material[data-material-id="' + local.materialId + '"] .mw-material-body').inputValue(), raw.replace(/\r\n/g, '\n'));
      } finally { for (const ctx of contexts) await ctx.close(); }
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []);
    report.materialWrites = writes().length; report.productionWrites = 0; report.pass = true;
  } catch (error) {
    report.pass = false; report.error = error.stack;
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(output, 'failure-dom.json'), JSON.stringify(await page.evaluate(() => ({ text: document.body.innerText, panel: document.getElementById('mcPanel')?.outerHTML })).catch(() => null), null, 2));
    throw error;
  } finally {
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); await browser.close();
  }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { main };

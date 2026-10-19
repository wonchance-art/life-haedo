'use strict';
// Independent visual/input review of the real preparation surface. The separate
// material-writing-browser suite owns SQL, publication and preservation journeys.
process.env.BASE_URL ||= 'http://127.0.0.1:4214';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { seedMaterials, seedPlan, enter, saved, readPreparation } = require('./material-writing-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const output = path.resolve(__dirname, '../.local/material-writing-visual');

async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  await fs.mkdir(output, { recursive: true });
  const server = new FakeCloud();
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const context = await makeContext(browser, server, 'material-visual', accounts.a, { viewport: { width: 820, height: 1000 } });
  const report = { checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], browser: browser.version(), node: process.version,
    scope: 'Actual workbench/preparation/PhotoPost UI, IndexedDB and shared synthetic source fixture. Computed styles and synthetic composition events. SQL/publication/preservation are verified separately; no native IME, Apple hardware, Google OAuth, production, merge or deployment claims.' };
  await context.route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    if ([new URL(base).origin, cloud].includes(origin)) return route.fallback();
    report.external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  async function check(name, run) { console.log('START ' + name); await run(); report.checks.push(name); console.log('PASS ' + name); }
  async function capture(scene, widths = [1440, 820, 390]) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => { document.activeElement?.blur(); scrollTo({ top: 0, left: 0, behavior: 'instant' }); });
      const metrics = await page.evaluate(inspect);
      assert.equal(metrics.horizontalOverflow, false, scene + ': overflow');
      // Quill's editable body retains its ordinary inline links. Record those
      // separately from form/toolbar actions; do not enlarge or restyle authored
      // inline content merely to satisfy an all-controls audit.
      metrics.inlineEditorLinks = [];
      if (scene === 'existing-editor') {
        const links = await page.locator('.ql-editor a').evaluateAll(nodes => nodes.map(node => ({
          text: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 80),
          width: +node.getBoundingClientRect().width.toFixed(1), height: +node.getBoundingClientRect().height.toFixed(1),
          display: getComputedStyle(node).display
        })));
        metrics.inlineEditorLinks = metrics.smallTargets.filter(target => target.tag === 'a' && links.some(link => link.display === 'inline' && link.text === target.text && link.width === target.width && link.height === target.height));
      }
      assert.deepEqual(metrics.smallTargets.filter(target => !metrics.inlineEditorLinks.includes(target)), [], scene + ': small action targets');
      for (const key of ['smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ': ' + key);
      const file = scene + '-' + width + '.png'; await page.screenshot({ path: path.join(output, file), fullPage: true });
      report.visual.push({ scene, width, file, metrics });
    }
    await page.setViewportSize({ width: 820, height: 1000 });
  }
  try {
    await page.goto(base + '/index.html'); await ready(page);
    const fixture = await seedMaterials(page), planId = await seedPlan(page, fixture, '서로 다른 자료에서 내 글을 완성하는 긴 한글 제목 🌱');
    await enter(page, planId);
    await check('Preparation and comparison remain readable with actual site styles at three widths', async () => {
      const state = await readPreparation(page), plan = state.plans.find(item => item.id === planId);
      await page.locator('.mw-compare-select').selectOption(plan.materials[1].id);
      await capture('preparation-compare');
      assert.equal(await page.locator('.mw-material-body').count(), 2, '820px comparison is available');
    });
    await check('Synthetic Korean composition preserves its input node and blocks preview until composition ends', async () => {
      const input = page.locator('#mwQuestion');
      await input.evaluate(node => { window.__materialVisualInput = node; node.focus(); node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); node.value = '조합 중인 비공개 질문 한'; node.setSelectionRange(node.value.length, node.value.length); node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '한', isComposing: true })); });
      await page.locator('#mwPreview').click(); await page.locator('.mw-error:not([hidden])').waitFor();
      assert.equal(await input.evaluate(node => node === window.__materialVisualInput), true);
      assert.equal(await input.inputValue(), '조합 중인 비공개 질문 한');
      assert.equal(await page.locator('#mwPreviewContent').count(), 0);
      await input.evaluate(node => { node.focus(); node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '한' })); });
      await saved(page);
      assert.equal(await input.evaluate(node => document.activeElement === node), true);
      assert.equal(await input.evaluate(node => node.selectionStart), '조합 중인 비공개 질문 한'.length);
    });
    await check('An unapplied exact quote keeps its selection until explicitly cancelled', async () => {
      const body = page.locator('.mw-material-body').first();
      const range = await body.evaluate(node => { node.focus(); const start = node.value.indexOf('같은 풍경'), end = start + '같은 풍경'.length; node.setSelectionRange(start, end); node.dispatchEvent(new Event('select', { bubbles: true })); return { start, end }; });
      await page.locator('#mwPreview').click(); await page.locator('.mw-error:not([hidden])').waitFor();
      assert.equal(await page.locator('#mwPreviewContent').count(), 0);
      assert.deepEqual(await body.evaluate(node => ({ start: node.selectionStart, end: node.selectionEnd })), range);
      const card = body.locator('xpath=ancestor::section[contains(@class,"mw-material")]');
      await card.locator('.mw-quote-cancel').click();
      await page.locator('#mwPreview').click(); await page.locator('#mwPreviewContent').waitFor();
      assert.equal(await page.locator('.mw-error').isHidden(), true, 'Resolved pending input must not remain a save-failure alert');
      await saved(page);
      const preview = await page.locator('#mwPreviewContent').innerText();
      assert(!preview.includes('조합 중인 비공개 질문 한')); assert(!preview.includes('PRIVATE_NOTE_SENTINEL'));
      await capture('outline-preview');
    });
    await check('Invalid input remains editable with focus and caret intact while navigation is refused', async () => {
      const input = page.locator('#mwTitle');
      await input.evaluate(node => { window.__materialVisualInvalid = node; node.focus(); node.value = '너'.repeat(501); node.setSelectionRange(210, 220); node.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.locator('.mw-error:not([hidden])').waitFor();
      const original = await input.inputValue(); await page.locator('#mwClose').click();
      assert.equal(await input.evaluate(node => node === window.__materialVisualInvalid), true);
      assert.equal(await input.inputValue(), original);
      assert.deepEqual(await input.evaluate(node => ({ start: node.selectionStart, end: node.selectionEnd })), { start: 210, end: 220 });
      await input.focus(); assert.equal(await input.evaluate(node => document.activeElement === node), true);
      await capture('input-error', [820]);
      await input.fill('자료를 비교해 내 생각으로 다시 쓴 여행'); await saved(page);
    });
    await check('Keyboard block ordering returns focus and the handoff opens the existing PhotoPost editor', async () => {
      const blockId = await page.locator('#mwBlocks [data-block-id]').first().getAttribute('data-block-id');
      await page.locator('#mwBlocks [data-block-id="' + blockId + '"] [data-action="down"]').focus(); await page.keyboard.press('Enter');
      const moved = page.locator('#mwBlocks [data-block-id="' + blockId + '"]');
      assert.equal(await moved.getAttribute('data-kind'), 'paragraph');
      assert.equal(await moved.locator('[data-action="down"]').evaluate(node => document.activeElement === node), true);
      await saved(page); await page.locator('#mwPreview').click(); await page.locator('#mwConsent').check(); await page.locator('#mwCreate').click();
      await page.locator('#photoTitle').waitFor();
      assert.equal(await page.locator('.ql-container').count(), 1, 'Existing Quill editor is reused');
      await capture('existing-editor');
      await page.locator('.photo-commandbar').getByRole('button', { name: '닫기', exact: true }).click(); await page.locator('#mwContinue').waitFor();
      await capture('handoff-return', [820]);
      const state = await readPreparation(page); assert(state.plans.find(item => item.id === planId).output.postId);
    });
    await check('A late output read for preparation A cannot open tools beneath newly selected preparation B', async () => {
      const secondId = await seedPlan(page, fixture, '다른 자료로 새롭게 준비하는 두 번째 글');
      await enter(page, planId);
      const firstPostId = (await readPreparation(page)).plans.find(item => item.id === planId).output.postId;
      await page.evaluate(({ workspaceId, postId }) => {
        const original = IDBObjectStore.prototype.get, key = 'photo-post:' + workspaceId + ':' + postId;
        window.__materialOutputGate = { held: false, released: false };
        IDBObjectStore.prototype.get = function (requested) {
          const request = original.call(this, requested);
          if (requested === key && !__materialOutputGate.held) request.addEventListener('success', event => {
            if (__materialOutputGate.released) return;
            event.stopImmediatePropagation(); __materialOutputGate.held = true;
            window.__releaseMaterialOutput = () => {
              __materialOutputGate.released = true; IDBObjectStore.prototype.get = original; request.dispatchEvent(new Event('success'));
            };
          });
          return request;
        };
      }, { workspaceId: fixture.workspaceId, postId: firstPostId });
      await page.locator('#mwManageOutput').click(); await page.waitForFunction(() => __materialOutputGate.held);
      try {
        await page.locator('#mwPlanSelect').selectOption(secondId);
        await page.waitForFunction(() => document.getElementById('mwTitle')?.value === '다른 자료로 새롭게 준비하는 두 번째 글');
        await page.locator('#mwQuestion').fill('B의 현재 입력은 A의 늦은 조회와 분리한다');
        await page.locator('#mwQuestion').evaluate(node => { window.__materialSecondInput = node; });
        await page.evaluate(async () => { __releaseMaterialOutput(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
        assert.equal(await page.locator('#mwPlanSelect').inputValue(), secondId);
        assert.equal(await page.locator('#mwQuestion').inputValue(), 'B의 현재 입력은 A의 늦은 조회와 분리한다');
        assert.equal(await page.locator('#mwQuestion').evaluate(node => node === __materialSecondInput), true);
        assert.equal(await page.locator('#mwOutputTool').isVisible(), false);
        assert.equal(await page.locator('#mwOutputTool .blog-manager').count(), 0);
        await saved(page);
      } finally { await page.evaluate(() => __releaseMaterialOutput?.()); }
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []);
    assert.equal(server.writes().length, 0); report.remoteWrites = 0; report.pass = true;
  } catch (error) {
    report.pass = false; report.error = error.stack;
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(output, 'failure-dom.json'), JSON.stringify(await page.evaluate(() => ({ url: location.href, text: document.body.innerText, html: document.querySelector('.mw-workspace')?.outerHTML })).catch(() => null), null, 2));
    throw error;
  } finally {
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await context.close(); await browser.close();
  }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { main };

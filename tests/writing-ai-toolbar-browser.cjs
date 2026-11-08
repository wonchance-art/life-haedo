/* AI toolbar integration: real app/Quill/SDK/IDB, synthetic Auth and usage.
 * Screenshots are Chromium viewport/pointer emulation, not Apple hardware.
 * Run npm run dev; node tests/writing-ai-toolbar-browser.cjs. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, base, cloud } = require('./life-sync-browser.cjs');
const { AIHTTP } = require('./writing-ai-browser.cjs');
const { awaitCondition } = require('./helpers/await-condition.cjs');
const output = path.resolve(__dirname, '../.local/writing-ai-toolbar', new Date().toISOString().replaceAll(':', '-'));
const report = { scope: 'Chromium, synthetic HTTP only; viewport and pointer emulation, not Apple devices.', checks: [], metrics: [], visual: [], consoleErrors: [], pageErrors: [], external: [] };
const widths = [320, 360, 390, 391, 768, 1440];
const TEXT = '선택 밖 문장. 이 문장은 AI에게 물어볼 선택 구간입니다. 뒤의 문장도 그대로 남습니다.';
const SELECTED = '이 문장은 AI에게 물어볼 선택 구간입니다.';
const selection = { index: TEXT.indexOf(SELECTED), length: SELECTED.length };
const state = page => page.evaluate(() => {
  const q = Quill.find(document.querySelector('.photo-quill'));
  return { sameEditor: q === window.__toolbarTestEditor, ops: q.getContents().ops,
    range: q.selection.savedRange && { index: q.selection.savedRange.index, length: q.selection.savedRange.length } };
});
async function settledResize(page, width) {
  await page.setViewportSize({ width, height: 1000 });
  await awaitCondition(page, narrow => {
    const link = document.querySelector('.photo-toolbar .ql-link');
    return !!link && !!link.closest('.photo-format-panel') === narrow;
  }, width <= 390, { timeout: 5000, label: 'link moved to its approved responsive container' });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function measure(page) {
  return page.evaluate(() => {
    const toolbar = document.querySelector('.photo-toolbar-floating');
    const rect = node => {
      const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const visible = node => {
      const closed = node.closest('details:not([open])');
      // Native closed details can retain descendant layout rectangles; only
      // the summary is painted and interactive until the disclosure opens.
      if (closed && node !== closed.querySelector('summary')) return false;
      return node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none';
    };
    return {
      width: innerWidth, coarse: matchMedia('(pointer: coarse)').matches,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      toolbar: rect(toolbar), toolbarOverflow: toolbar.scrollWidth - toolbar.clientWidth,
      controls: [...toolbar.querySelectorAll('button, summary')].filter(visible).map(node => ({ name: node.getAttribute('aria-label') || node.textContent.trim(), rect: rect(node) })),
      linkInPrimary: !!toolbar.querySelector('.photo-format-primary .ql-link'),
      linkInExtra: !!toolbar.querySelector('.photo-format-panel .ql-link'),
      link: rect(toolbar.querySelector('.ql-link')), ai: rect(toolbar.querySelector('#photoAI')),
      keyboardVisible: !!visible(toolbar.querySelector('.photo-keyboard-close')),
      aiIcon: toolbar.querySelector('#photoAI svg')?.outerHTML,
      markIcon: toolbar.querySelector('.photo-author-toggle svg')?.outerHTML,
    };
  });
}
function assertLayout(metrics, hasTouch) {
  assert.equal(metrics.coarse, hasTouch, 'the pointer query matches the tested input mode');
  assert(metrics.pageOverflow <= 1, 'document does not overflow horizontally');
  assert(metrics.toolbarOverflow <= 1, 'toolbar content does not overflow horizontally');
  assert(metrics.toolbar.x >= -1 && metrics.toolbar.right <= metrics.width + 1, 'toolbar stays inside viewport');
  assert.equal(metrics.linkInPrimary, metrics.width > 390);
  assert.equal(metrics.linkInExtra, metrics.width <= 390);
  const tops = metrics.controls.map(control => control.rect.y);
  assert(Math.max(...tops) - Math.min(...tops) <= 1, 'all visible tools occupy one row');
  for (const control of metrics.controls) {
    assert(control.rect.width >= 43.9 && control.rect.height >= 43.9, control.name + ' has a 44px target');
    assert(control.rect.x >= metrics.toolbar.x - 1 && control.rect.right <= metrics.toolbar.right + 1, control.name + ' stays within the toolbar');
  }
  if (metrics.width > 390) {
    assert(metrics.ai.x >= metrics.link.right - 1 && metrics.ai.x - metrics.link.right <= 8, 'AI suggestion is directly beside the wide-screen link button');
  }
  // The existing <=359px native keyboard Done fallback is preserved. Every
  // wider coarse-pointer viewport must include the actual keyboard control.
  assert.equal(metrics.keyboardVisible, hasTouch && metrics.width >= 360);
  assert(metrics.aiIcon && metrics.markIcon && metrics.aiIcon !== metrics.markIcon, 'AI suggestion and AI authorship use different icons');
}
async function flow(browser, hasTouch) {
  const label = hasTouch ? 'coarse' : 'fine';
  const server = new FakeCloud(), ai = new AIHTTP();
  const context = await makeContext(browser, server, 'writing-ai-toolbar-' + label, accounts.a, { viewport: { width: 1440, height: 1000 }, hasTouch });
  await ai.attach(context);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if ([new URL(base).origin, cloud].includes(url.origin) || ['blob:', 'data:'].includes(url.protocol)) return route.fallback();
    report.external.push(url.origin); return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ label, message: message.text(), url: message.location().url }); });
  page.on('pageerror', error => report.pageErrors.push({ label, message: error.message }));
  const check = async (name, run) => {
    try { await run(); report.checks.push({ label, name, pass: true }); console.log('PASS ' + label + ': ' + name); }
    catch (error) { report.checks.push({ label, name, pass: false, error: error.message }); await page.screenshot({ path: path.join(output, label + '-failure.png') }).catch(() => {}); throw error; }
  };
  try {
    await page.goto(base + '/index.html'); await ready(page); await settle(page);
    await page.locator('[data-haedo-compose]:visible').first().click();
    await page.locator('#photoTitle').fill('도구 막대 익명 확인');
    await page.locator('.ql-editor').fill(TEXT);
    await page.evaluate(range => {
      const q = Quill.find(document.querySelector('.photo-quill')); window.__toolbarTestEditor = q;
      q.setSelection(range.index, range.length, 'user');
    }, selection);
    const initial = await state(page);
    for (const width of widths) {
      await check(width + 'px one-row tools, responsive link and 44px targets', async () => {
        await settledResize(page, width);
        const metrics = await measure(page); report.metrics.push({ label, ...metrics }); assertLayout(metrics, hasTouch);
        assert.deepEqual(await state(page), initial, 'resize preserves the same editor, text and selected range');
        if (width <= 390) {
          await page.locator('.photo-format-options > summary').click();
          const link = page.locator('.photo-format-panel .ql-link'); assert.equal(await link.isVisible(), true, 'narrow link is reachable inside additional formats');
          const box = await link.boundingBox(); assert(box.width >= 43.9 && box.height >= 43.9, 'moved link retains its target size');
          await page.locator('.photo-format-options > summary').click();
        }
        const screenshot = label + '-' + width + '.png'; await page.screenshot({ path: path.join(output, screenshot) }); report.visual.push(screenshot);
      });
    }
    await check('resizing an open AI review preserves its DOM, pending input and editor selection', async () => {
      await page.locator('#photoAI').click();
      const panel = page.locator('.writing-ai-panel'); await panel.waitFor();
      await page.locator('#writingAITask').selectOption('custom');
      await page.locator('#writingAIInstruction').fill('고른 문장만 간결하게 다듬어 주세요.');
      await page.evaluate(() => { window.__toolbarTestPanel = document.querySelector('.writing-ai-panel'); });
      for (const width of [390, 1440, 320, 768]) {
        await settledResize(page, width);
        assert.equal(await page.evaluate(() => document.querySelector('.writing-ai-panel') === window.__toolbarTestPanel), true, 'same open review survives resize');
        assert.equal(await page.locator('#writingAIInstruction').inputValue(), '고른 문장만 간결하게 다듬어 주세요.');
        assert.deepEqual(await state(page), initial, 'review resize leaves editor input/selection untouched');
      }
      assert.equal(ai.requests.length, 0, 'resizing/review never sends the selected text');
      await panel.getByRole('button', { name: '닫기', exact: true }).click();
      assert.deepEqual(await state(page), initial, 'closing review preserves the selected document');
    });
  } finally { await context.close(); }
}
async function main() {
  await fs.mkdir(output, { recursive: true }); console.log('Evidence: ' + output);
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version();
  try {
    await flow(browser, false); await flow(browser, true);
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []);
    report.pass = true;
  } finally { await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

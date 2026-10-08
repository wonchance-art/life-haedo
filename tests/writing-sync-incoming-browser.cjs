/* Focused writing UI race regression with controlled storage delays.
 * Real Chromium/DOM and actual Writing model; not IndexedDB, remote sync,
 * Google OAuth, operating SQL or actual Apple IME validation.
 * BASE_URL=http://127.0.0.1:4184 node tests/writing-sync-incoming-browser.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright } = require('./unified-home-browser.cjs');
const base = process.env.BASE_URL || 'http://127.0.0.1:4184';
const out = path.resolve('.local/writing-sync/' + (process.env.WRITING_UI_REVIEW_SOURCE ? 'incoming-negative-control-report.json' : 'incoming-report.json'));
const fixture = base + '/__writing-incoming-test.html';
const html = '<!doctype html><html lang="ko"><meta charset="utf-8"><body><main id="editor"></main>' +
  ['core', 'writing', 'icons', 'writing-ui'].map(name => '<script src="/assets/life/' + name + '.js"></script>').join('') + '</body></html>';
async function setup(page) {
  await page.goto(fixture);
  return page.evaluate(async () => {
    const copy = value => structuredClone(value), bundle = HaedoLife.Core.createWorkspace();
    const original = { ...HaedoLife.Writing.createDraft(bundle), revision: 5, title: '다시 이어 쓸 글', text: '처음 보관한 문장' };
    const stages = new Map([[original.stageId, original]]), listeners = new Set(), held = new Map();
    let holdNext = null;
    const emit = stage => { for (const listener of listeners) listener({ type: 'writing_draft_changed', workspaceId: bundle.workspaceId, stageId: stage.stageId }); };
    const storage = {
      async getStage(id) {
        const snapshot = copy(stages.get(id));
        if (holdNext) { const key = holdNext; holdNext = null; return new Promise(resolve => held.set(key, () => resolve(snapshot))); }
        return snapshot;
      },
      async listStages() { return [...stages.values()].map(copy); },
      async saveStage(stage) {
        const previous = stages.get(stage.stageId);
        if (previous && previous.revision !== stage.revision) throw Object.assign(new Error('Controlled competing edit'), { code: 'stage_conflict' });
        const saved = { ...copy(stage), revision: stage.revision + 1 };
        stages.set(saved.stageId, saved); emit(saved); return copy(saved);
      },
      subscribe(_, listener) { listeners.add(listener); return () => listeners.delete(listener); }
    };
    const writer = HaedoLife.WritingUI.create({ host: document.querySelector('#editor'), storage, core: HaedoLife.Core, getBundle: () => bundle });
    await writer.open({ stageId: original.stageId });
    window.fixture = {
      changed(revision, state = 'draft', delay = null) {
        const stage = { ...original, revision, text: state === 'applied' ? '다른 기기에서 저장한 문장' : '다른 탭에서 바꾼 문장', state };
        if (state === 'applied') stage.appliedResult = { sourceId: HaedoLife.Core.id(), sourceVersionId: HaedoLife.Core.id() };
        stages.set(original.stageId, stage); holdNext = delay; emit(stage);
      },
      release(key) { held.get(key)(); held.delete(key); },
      snapshot() { return { originalId: original.stageId, stages: [...stages.values()].map(copy) }; },
      dispose: () => writer.dispose()
    };
    return original.stageId;
  });
}
async function main() {
  const report = { createdAt: new Date().toISOString(), scope: 'Chromium DOM and actual Writing modules, controlled in-memory storage delays; no remote or operating data.', negativeControl: !!process.env.WRITING_UI_REVIEW_SOURCE, checks: [], pageErrors: [], consoleErrors: [], externalRequests: [] };
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  const context = await browser.newContext();
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url === fixture) return route.fulfill({ contentType: 'text/html', body: html });
    if (new URL(url).origin === new URL(base).origin) {
      // Allows a pre-fix source file as a local negative control without editing the app.
      if (process.env.WRITING_UI_REVIEW_SOURCE && url.endsWith('/assets/life/writing-ui.js')) return route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(process.env.WRITING_UI_REVIEW_SOURCE, 'utf8') });
      return route.continue();
    }
    report.externalRequests.push(url); return route.abort('blockedbyclient');
  });
  async function check(name, run) {
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push(event.text()); });
    try { await setup(page); await run(page); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + ': ' + error.message); }
    finally { await page.close(); }
  }
  try {
    await check('a late old-draft response cannot attach its incoming notice to a rescued new draft', async page => {
      await page.evaluate(() => fixture.changed(6, 'draft', 'old-draft'));
      await page.locator('#lifeWritingBody').fill('현재 입력을 새 초안으로 보존한다.');
      await page.locator('#lifeWritingRescue').waitFor(); await page.locator('#lifeWritingRescue').click();
      await page.waitForFunction(() => document.querySelector('#lifeWritingStatus')?.dataset.state === 'draft');
      const before = await page.evaluate(() => fixture.snapshot());
      const recovery = before.stages.find(stage => stage.stageId !== before.originalId);
      assert.ok(recovery); assert.equal(recovery.text, '현재 입력을 새 초안으로 보존한다.');
      await page.evaluate(async () => { fixture.release('old-draft'); await new Promise(resolve => setTimeout(resolve, 0)); });
      assert.equal(await page.locator('#lifeWritingIncoming').isVisible(), false);
      assert.equal(await page.locator('#lifeWritingBody').inputValue(), recovery.text);
      assert.deepEqual(await page.evaluate(() => fixture.snapshot()), before);
    });
    await check('a slower earlier revision cannot replace a newer applied notice or the active Korean input', async page => {
      await page.locator('#lifeWritingBody').evaluate(element => {
        window.originalInput = element; element.focus();
        element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'ㅎ' }));
        element.value += '\n조합 중인 한글';
        element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: '조합 중인 한글', inputType: 'insertCompositionText' }));
      });
      const input = await page.locator('#lifeWritingBody').inputValue();
      await page.evaluate(() => { fixture.changed(6, 'draft', 'older-revision'); fixture.changed(7, 'applied'); });
      await page.waitForFunction(() => document.querySelector('#lifeWritingIncoming')?.textContent.includes('다른 기기에서 기록으로 저장했습니다.'));
      await page.evaluate(async () => { fixture.release('older-revision'); await new Promise(resolve => setTimeout(resolve, 0)); });
      assert.match(await page.locator('#lifeWritingIncoming').innerText(), /다른 기기에서 기록으로 저장했습니다/);
      assert.equal(await page.locator('#lifeWritingBody').inputValue(), input);
      assert.equal(await page.locator('#lifeWritingBody').evaluate(element => element === window.originalInput), true);
      assert.equal(await page.locator('#lifeWritingSave').isDisabled(), true);
    });
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.externalRequests, []);
  } finally { await browser.close(); await fs.mkdir(path.dirname(out), { recursive: true }); await fs.writeFile(out, JSON.stringify(report, null, 2) + '\n'); }
  if (report.checks.some(check => !check.pass)) process.exitCode = 1;
  console.log('Incoming UI race checks: ' + report.checks.filter(check => check.pass).length + '/' + report.checks.length);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

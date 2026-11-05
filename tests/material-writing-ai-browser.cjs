/* Materials AI: actual app/SDK/IndexedDB and synthetic Auth/AI HTTP only.
 * No real account, provider, SQL, Apple device or native IME claim.
 * Start npm run dev, then node tests/material-writing-ai-browser.cjs. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, session, base, cloud } = require('./life-sync-browser.cjs');
const { AIHTTP } = require('./writing-ai-browser.cjs');
const output = path.resolve(__dirname, '../.local/material-writing-ai', new Date().toISOString().replace(/[:.]/g, '-'));
const report = { scope: 'Linux Chromium, synthetic Auth/AI HTTP and composition events; no real provider or Apple hardware.', checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [] };
const ANSWER = '산책이 생각 정리를 도울 수 있습니다.';
const QUESTION = '이 발췌의 관찰을 설명해 주세요.';
const panel = page => page.locator('.writing-ai-panel');
const action = (page, name) => panel(page).getByRole('button', { name, exact: true });
async function seed(page) {
  return page.evaluate(async () => {
    const C = HaedoLife.Core, M = HaedoLife.MaterialWriting, R = HaedoLife.SourceReference, s = HaedoLife.Shell.storage;
    const workspaceId = await s.getActive(), initial = await s.read(workspaceId);
    let bundle = initial;
    const entries = [];
    for (const [title, quote] of [['첫 관찰', '천천히 걸으면 생각을 정리할 수 있다.'], ['둘째 관찰', '낯선 길에서 다른 풍경을 발견했다.']]) {
      const raw = 'PRIVATE_UNSELECTED_BODY\n' + quote + '\nPRIVATE_SOURCE_TAIL';
      const value = await C.prepareImport({ origin: 'obsidian', author: '익명 작성자', authorRelation: 'other', title, text: raw, fileName: title + '.md' }, bundle);
      bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, value));
      entries.push({ sourceId: value.source.id, versionId: value.version.id, raw, quote });
    }
    const committed = await s.commitLocal({ workspaceId, baseRevision: initial.revision, operationId: C.id(), changes: { put: { sources: bundle.sources, sourceVersions: bundle.sourceVersions } } });
    if (committed.status !== 'stored') throw Error('synthetic material seed failed');
    const state = await s.readMaterialWriting(workspaceId), owner = M.create(C.id);
    owner.title = '익명 자료 AI 준비'; owner.question = 'PRIVATE_QUESTION_SENTINEL';
    owner.blocks.push({ id: C.id(), kind: 'paragraph', text: 'PRIVATE_OWNER_PARAGRAPH' });
    for (const entry of entries) {
      const material = M.material(bundle, entry.sourceId, entry.versionId, C.id); material.note = 'PRIVATE_NOTE_SENTINEL'; owner.materials.push(material);
      const start = entry.raw.indexOf(entry.quote);
      const reference = await R.build({ bundle, sourceId: entry.sourceId, versionId: entry.versionId, locator: { start, end: start + entry.quote.length } });
      owner.blocks.push({ id: C.id(), kind: 'quote', materialId: material.id, reference });
    }
    state.plans.push(owner); await s.saveMaterialWriting(workspaceId, state, state.revision);
    return { workspaceId, planId: owner.id, entries };
  });
}
async function enter(page) {
  await page.goto(base + '/index.html?section=records&view=page'); await ready(page);
  await page.locator('#wbPageMaterialWriting').click(); await page.locator('#mwAI').waitFor();
  await page.waitForFunction(() => !document.querySelector('#mwAI')?.disabled);
}
async function snapshot(page, fixture) {
  return page.evaluate(async workspaceId => {
    const s = HaedoLife.Shell.storage;
    return { preparation: await s.readMaterialWriting(workspaceId), posts: await s.listPhotoPosts(workspaceId) };
  }, fixture.workspaceId);
}
async function open(page, source = 0, task = 'ask') {
  await page.locator('#mwAI').click(); await panel(page).waitFor();
  await page.locator('#writingAITask').selectOption(task);
  await panel(page).locator('[data-ai-source]').nth(source).check();
  await page.locator('#writingAIInstruction').fill(QUESTION);
  await action(page, '보낼 내용 확인').click(); await action(page, '보내기').waitFor();
}
async function flow(browser, label, viewport) {
  const server = new FakeCloud(), ai = new AIHTTP();
  const context = await makeContext(browser, server, 'material-ai-' + label, accounts.a, { viewport, hasTouch: label === 'mobile' });
  await ai.attach(context);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if ([new URL(base).origin, cloud].includes(url.origin) || ['blob:', 'data:'].includes(url.protocol)) return route.fallback();
    report.external.push(url.origin); return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ label, text: message.text(), url: message.location().url }); });
  page.on('pageerror', error => report.pageErrors.push({ label, message: error.message }));
  const check = async (name, run) => {
    console.log('START ' + label + ': ' + name);
    try { await run(); report.checks.push({ label, name, pass: true }); console.log('PASS ' + label + ': ' + name); }
    catch (error) { report.checks.push({ label, name, pass: false, error: error.message }); await page.screenshot({ path: path.join(output, label + '-failure.png') }).catch(() => {}); throw error; }
  };
  const shot = async name => { const file = label + '-' + name + '.png'; await page.screenshot({ path: path.join(output, file) }); report.visual.push(file); };
  try {
    await page.goto(base + '/index.html'); await ready(page); await settle(page);
    const fixture = await seed(page); await enter(page);
    await check('explicit excerpt selection and exact preview omit all private notes and unselected text', async () => {
      const before = await snapshot(page, fixture);
      await page.locator('#mwAI').click(); await panel(page).waitFor();
      assert.equal(ai.requests.length, 0);
      assert.equal(await page.locator('#writingAIInstruction').inputValue(), '', 'private plan question is never copied');
      const checks = panel(page).locator('[data-ai-source]'); assert.equal(await checks.count(), 2);
      assert.equal(await checks.nth(0).isChecked(), false); assert.equal(await checks.nth(1).isChecked(), false);
      await page.locator('#writingAIInstruction').fill(QUESTION);
      await action(page, '보낼 내용 확인').click();
      await panel(page).getByRole('alert').getByText('질문할 자료 발췌를 골라 주세요.', { exact: true }).waitFor();
      assert.equal(ai.requests.length, 0);
      await checks.nth(0).check(); await action(page, '보낼 내용 확인').click();
      const preview = await panel(page).locator('.writing-ai-preview').textContent();
      assert(preview.includes(fixture.entries[0].quote)); assert(!preview.includes(fixture.entries[1].quote));
      assert(!preview.includes('PRIVATE_')); assert.match(preview, /Anthropic/); assert.match(preview, /30일/);
      assert.equal(ai.requests.length, 0); assert.deepEqual(await snapshot(page, fixture), before);
      await page.waitForFunction(() => document.querySelector('.writing-ai-usage')?.textContent.includes('$7.50'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await shot('preview');
      const backgroundY = await page.evaluate(() => scrollY);
      const hold = ai.hold(); await action(page, '보내기').evaluate(button => { button.click(); button.click(); }); await hold.entered;
      assert.equal(ai.requests.length, 1, 'duplicate click sends once');
      const body = ai.requests[0].body;
      assert.deepEqual(Object.keys(body).sort(), ['instruction', 'requestId', 'sources', 'task']);
      assert.equal(body.task, 'ask'); assert.equal(body.instruction, QUESTION); assert.deepEqual(body.sources, [fixture.entries[0].quote]);
      assert(!ai.requests[0].raw.includes('PRIVATE_'));
      assert(!ai.requests[0].raw.includes(fixture.entries[0].sourceId));
      hold.release(); await panel(page).getByText(ANSWER, { exact: true }).waitFor();
      assert.equal(await panel(page).locator('.writing-ai-citations blockquote').textContent(), fixture.entries[0].quote);
      assert.equal(await panel(page).locator('.writing-ai-unverified').textContent(), '출처 미확인');
      assert(!((await panel(page).textContent()).includes('가짜 인용을 만들어 넣었습니다.')));
      assert.equal(await action(page, '선택한 제안 적용').count(), 0, 'material results are read-only');
      assert.deepEqual(await snapshot(page, fixture), before, 'reply writes neither preparation nor posts');
      await page.waitForFunction(() => {
        const result = document.querySelector('.writing-ai-result > h3')?.getBoundingClientRect();
        const header = document.querySelector('.writing-ai-header')?.getBoundingClientRect();
        return result && header && result.top >= header.bottom - 1 && result.bottom < innerHeight;
      });
      assert.equal(await page.evaluate(() => scrollY), backgroundY, 'showing the response keeps the preparation scroll position');
      await shot('result'); await action(page, '닫기').click();
    });
    await check('outline uses only the newly selected excerpt and leaves the preparation unchanged', async () => {
      const before = await snapshot(page, fixture);
      await open(page, 1, 'outline'); await action(page, '보내기').click(); await panel(page).getByText(ANSWER, { exact: true }).waitFor();
      assert.equal(ai.requests.at(-1).body.task, 'outline'); assert.deepEqual(ai.requests.at(-1).body.sources, [fixture.entries[1].quote]);
      assert.deepEqual(await snapshot(page, fixture), before);
      await action(page, '닫기').click();
    });
    if (label === 'mobile') return;
    await check('request IME composition cannot create or send a stale preview', async () => {
      await page.locator('#mwAI').click(); await panel(page).waitFor(); await panel(page).locator('[data-ai-source]').first().check();
      await page.locator('#writingAIInstruction').fill(QUESTION);
      const count = ai.requests.length;
      await page.locator('#writingAIInstruction').evaluate(node => node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'ㅎ' })));
      await action(page, '보낼 내용 확인').evaluate(button => button.click());
      await panel(page).getByRole('alert').getByText('한글 입력이 끝난 뒤 적용해 주세요.', { exact: true }).waitFor();
      assert.equal(ai.requests.length, count); assert.equal(await action(page, '보내기').isVisible(), false);
      await page.locator('#writingAIInstruction').evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' })));
      await action(page, '닫기').click();
    });
    await check('a newer preparation invalidates an in-flight answer without overwriting the new input', async () => {
      await open(page); const hold = ai.hold(); await action(page, '보내기').click(); await hold.entered;
      await page.evaluate(async f => {
        const s = HaedoLife.Shell.storage, state = await s.readMaterialWriting(f.workspaceId);
        state.plans.find(plan => plan.id === f.planId).question = '다른 기기에서 바꾼 비공개 질문';
        await s.saveMaterialWriting(f.workspaceId, state, state.revision);
      }, fixture);
      await panel(page).waitFor({ state: 'hidden' }); hold.release();
      await page.waitForFunction(() => document.querySelector('#mwQuestion')?.value === '다른 기기에서 바꾼 비공개 질문');
      assert.equal(await page.getByText(ANSWER, { exact: true }).count(), 0);
      assert.equal((await snapshot(page, fixture)).preparation.plans.find(plan => plan.id === fixture.planId).question, '다른 기기에서 바꾼 비공개 질문');
    });
    await check('source trash cancels pending excerpts and blocks another request until restored', async () => {
      await open(page); const hold = ai.hold(); await action(page, '보내기').click(); await hold.entered;
      await page.evaluate(async f => {
        const s = HaedoLife.Shell.storage, C = HaedoLife.Core, bundle = await s.read(f.workspaceId);
        const result = await s.commitLocal({ workspaceId: f.workspaceId, baseRevision: bundle.revision, operationId: C.id(), changes: C.buildSourceStateChanges(bundle, f.entries[0].sourceId, 'trash') });
        if (result.status !== 'stored') throw Error('synthetic source mutation failed');
      }, fixture);
      await panel(page).waitFor({ state: 'hidden' }); hold.release();
      assert.equal(await page.getByText(ANSWER, { exact: true }).count(), 0);
      const ref = (await snapshot(page, fixture)).preparation.plans.find(plan => plan.id === fixture.planId).blocks.find(block => block.kind === 'quote').reference;
      assert.equal(ref.sourceVersionId, fixture.entries[0].versionId); assert.equal(ref.quote, fixture.entries[0].quote);
      const count = ai.requests.length; await page.locator('#mwAI').click();
      await page.locator('.mw-error').getByText('휴지통에 있는 자료의 인용은 AI에 보내지 않습니다. 자료를 복원하거나 개요에서 해당 인용을 빼 주세요.', { exact: true }).waitFor();
      assert.equal(await panel(page).count(), 0); assert.equal(ai.requests.length, count);
      await page.evaluate(async f => {
        const s = HaedoLife.Shell.storage, C = HaedoLife.Core, bundle = await s.read(f.workspaceId);
        const result = await s.commitLocal({ workspaceId: f.workspaceId, baseRevision: bundle.revision, operationId: C.id(), changes: C.buildSourceStateChanges(bundle, f.entries[0].sourceId, 'active') });
        if (result.status !== 'stored') throw Error('synthetic source restoration failed');
      }, fixture);
    });
    await check('account switch removes private excerpt choices and drops the late response', async () => {
      await open(page); const hold = ai.hold(); await action(page, '보내기').click(); await hold.entered;
      await page.evaluate(value => HaedoAuth.client.auth.setSession(value), session(accounts.b));
      await page.waitForFunction(() => !HaedoAuth.user && !HaedoLife.Shell.storage);
      await panel(page).waitFor({ state: 'hidden' }); hold.release();
      await page.evaluate(() => HaedoLife.Shell.start()); await ready(page); await settle(page);
      await page.waitForFunction(id => HaedoAuth.user?.id === id, accounts.b.id);
      assert.equal(await page.getByText(ANSWER, { exact: true }).count(), 0);
      assert(!((await page.locator('body').textContent()).includes(fixture.entries[0].quote)));
      assert.equal(await page.evaluate(async workspaceId => {
        try { await HaedoLife.Shell.storage.readMaterialWriting(workspaceId); return true; } catch (_) { return false; }
      }, fixture.workspaceId), false, 'new account cannot read old preparation');
    });
  } finally { await context.close(); }
}
async function main() {
  await fs.mkdir(output, { recursive: true }); console.log('Evidence: ' + output);
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version();
  try {
    await flow(browser, 'desktop', { width: 1440, height: 1000 });
    await flow(browser, 'mobile', { width: 390, height: 844 });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } finally { await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

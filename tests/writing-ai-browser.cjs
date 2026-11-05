/* AI suggestion screen: real app, bundled Quill/SDK and IndexedDB in Chromium.
 * All account, usage and AI HTTP is intercepted synthetic data. No real key,
 * provider request, hosted SQL, Apple hardware or native IME claim.
 * Start npm run dev, then node tests/writing-ai-browser.cjs. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, session, base, cloud } = require('./life-sync-browser.cjs');
const { awaitCondition } = require('./helpers/await-condition.cjs');
const output = path.resolve(__dirname, '../.local/writing-ai', new Date().toISOString().replace(/[:.]/g, '-'));
const report = { scope: 'Linux Chromium; synthetic Auth, usage and AI HTTP; no real provider or Apple device.', checks: [], visual: [], consoleErrors: [], expectedConsoleErrors: [], pageErrors: [], external: [] };
const SELECTED = '첫째 문장을 고쳐여. 둘째 문장은 그대로. 셋째 문장도 고쳐여.';
const SUGGESTED = '첫째 문장을 고쳐요. 둘째 문장은 그대로. 셋째 문장도 고쳐요.';
const PREFIX = '선택 밖 비공개 시작. ';
const SUFFIX = ' 선택 밖 비공개 끝.';
const REASON = '두 문장의 종결 표현을 고쳤습니다.';
const editorState = page => page.evaluate(() => {
  const q = Quill.find(document.querySelector('.photo-quill'));
  return { text: q.getText(), ops: q.getContents().ops };
});
const setSelection = (page, index, length) => page.evaluate(([i, n]) => {
  const q = Quill.find(document.querySelector('.photo-quill')); q.focus(); q.setSelection(i, n, 'user');
}, [index, length]);
const aiText = state => state.ops.filter(op => op.attributes?.author === 'ai').map(op => op.insert).join('');
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
class AIHTTP {
  constructor() { this.requests = []; this.usageRequests = 0; this.next = null; this.expectedStatuses = []; this.expectedNetworkFailures = 0; this.remainingMicroUsd = 7500000; }
  hold() { const entered = gate(), release = gate(), completed = gate(); this.next = { entered, release, completed }; return { entered: entered.promise, completed: completed.promise, release: () => release.resolve() }; }
  fail(code, status = 400) { this.next = { error: code, status }; this.expectedStatuses.push(status); }
  failNetwork() { this.next = { network: true }; this.expectedNetworkFailures++; }
  async attach(context) {
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'content-type': 'application/json' };
    await context.route(cloud + '/rest/v1/rpc/life_ai_usage', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
      this.usageRequests++;
      return route.fulfill({ headers, body: JSON.stringify({ month: '2026-11-01', limit_micro_usd: 10000000, cost_micro_usd: 10000000 - this.remainingMicroUsd, reserved_micro_usd: 0, requests: 2, input_tokens: 20, output_tokens: 10 }) });
    });
    await context.route(cloud + '/functions/v1/haedo-ai', async route => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
      assert.equal(request.method(), 'POST');
      const raw = request.postData(), body = request.postDataJSON();
      this.requests.push({ raw, body });
      const response = this.next; this.next = null;
      if (response?.release) { response.entered.resolve(); await response.release.promise; }
      if (response?.network) return route.abort('failed');
      const sourced = ['ask', 'outline'].includes(body.task);
      const payload = response?.error ? { error: response.error } : { status: 'ok', requestId: body.requestId, task: body.task, suggestion: sourced ? '산책이 생각 정리를 도울 수 있습니다.' : SUGGESTED, reason: REASON, ...(sourced ? { citations: [{ sourceIndex: 0, quote: body.sources[0] }, { sourceIndex: 0, quote: '가짜 인용을 만들어 넣었습니다.' }] } : {}), usage: { remainingMicroUsd: 7499000 } };
      // A cancellation may already have closed the connection by the time the held
      // fake answer is released. That is a test observation, not a hidden retry.
      try { await route.fulfill({ status: response?.status || 200, headers, body: JSON.stringify(payload) }); }
      catch (error) { if (!/Target.*closed|Invalid InterceptionId|already handled/i.test(error.message)) throw error; }
      finally { response?.completed?.resolve(); }
    });
  }
}
const panel = page => page.locator('.writing-ai-panel');
const action = (page, name) => panel(page).getByRole('button', { name, exact: true });
async function openWriter(page) {
  await page.goto(base + '/index.html'); await ready(page); await settle(page);
  await page.locator('[data-haedo-compose]:visible, [data-home-destination="write"]:visible, #homeFirstWrite:visible').first().click();
  await page.locator('#photoTitle').waitFor(); await page.locator('.ql-editor').waitFor();
}
async function typeFixture(page) {
  await page.locator('#photoTitle').fill('익명 AI 제안 검사');
  await page.locator('.ql-editor').fill(PREFIX + SELECTED + SUFFIX);
  await setSelection(page, PREFIX.length, SELECTED.length);
}
async function openSuggestions(page) {
  await page.locator('#photoAI').click(); await panel(page).waitFor();
}
async function prepare(page, task = 'polish') {
  await page.locator('#writingAITask').selectOption(task);
  await action(page, '보낼 내용 확인').click();
  await action(page, '보내기').waitFor();
}
async function ask(page) {
  await prepare(page);
  await action(page, '보내기').click();
  await panel(page).getByText(REASON, { exact: true }).waitFor();
}
async function assertNoOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no page horizontal overflow');
  const bounds = await panel(page).boundingBox();
  assert(bounds && bounds.x >= -1 && bounds.x + bounds.width <= page.viewportSize().width + 1, 'dialog fits viewport');
}
async function flow(browser, { label, viewport, hasTouch = false, boundaryOnly = false }) {
  const server = new FakeCloud(), ai = new AIHTTP();
  const context = await makeContext(browser, server, 'ai-suggestions-' + label, accounts.a, { viewport, hasTouch });
  await ai.attach(context);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if ([new URL(base).origin, cloud].includes(url.origin) || ['blob:', 'data:'].includes(url.protocol)) return route.fallback();
    report.external.push(url.origin); return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const entry = { label, message: message.text(), url: message.location().url };
    if (entry.url === cloud + '/functions/v1/haedo-ai' && (ai.expectedStatuses.some(status => entry.message.includes('status of ' + status)) || ai.expectedNetworkFailures > 0 && entry.message.includes('net::ERR_FAILED'))) report.expectedConsoleErrors.push(entry);
    else report.consoleErrors.push(entry);
  });
  page.on('pageerror', error => report.pageErrors.push({ label, message: error.message }));
  const check = async (name, run) => {
    console.log('START ' + label + ': ' + name);
    try { await run(); report.checks.push({ label, name, pass: true }); console.log('PASS ' + label + ': ' + name); }
    catch (error) { report.checks.push({ label, name, pass: false, error: error.message }); await page.screenshot({ path: path.join(output, label + '-failure.png') }).catch(() => {}); throw error; }
  };
  const shot = async name => { const file = label + '-' + name + '.png'; await page.screenshot({ path: path.join(output, file) }); report.visual.push(file); };
  try {
    await openWriter(page); await typeFixture(page);
    if (boundaryOnly) {
      await check('moving only the selection rejects application while preserving the entire original document', async () => {
        await openSuggestions(page); await ask(page);
        await panel(page).locator('[data-ai-range]').first().check();
        const original = await editorState(page);
        await setSelection(page, 0, PREFIX.length);
        const moved = await page.evaluate(() => {
          const q = Quill.find(document.querySelector('.photo-quill'));
          return { index: q.selection.savedRange.index, length: q.selection.savedRange.length };
        });
        assert.deepEqual(moved, { index: 0, length: PREFIX.length }, 'only the selected range moved');
        assert.deepEqual(await editorState(page), original, 'moving selection did not edit any text or formatting');
        await action(page, '선택한 제안 적용').click();
        await panel(page).getByText('선택한 글이 바뀌어 제안을 적용하지 않았어요.', { exact: true }).waitFor();
        assert.deepEqual(await editorState(page), original, 'stale selection cannot receive a suggestion');
        await action(page, '닫기').click();
      });
      await setSelection(page, PREFIX.length, SELECTED.length);
      await check('browser Back changes the app screen and cleanup discards an in-flight response without reloading', async () => {
        const instance = await page.evaluate(() => window.__homeInstance);
        const original = await editorState(page);
        await openSuggestions(page); await prepare(page);
        const hold = ai.hold(); await action(page, '보내기').click(); await hold.entered;
        assert.equal(await panel(page).isVisible(), true);
        // Browser Back is an ordinary app navigation even while its modal
        // blocks background pointer input. This exercises popstate and the
        // real editor cleanup, rather than explicitly closing the AI panel.
        await page.evaluate(() => history.back());
        await page.locator('#homePosts').waitFor(); await settle(page);
        assert.equal(await page.evaluate(() => window.__homeInstance), instance, 'router navigation kept the same document');
        assert.equal(await page.locator('.photo-quill').count(), 0, 'editor actually unmounted');
        assert.equal(await panel(page).count(), 0, 'editor cleanup removed the panel');
        hold.release(); await hold.completed;
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await panel(page).count(), 0, 'late response cannot restore the disposed panel');
        assert.equal(await page.getByText(REASON, { exact: true }).count(), 0, 'late response content stays absent');
        const stored = await page.evaluate(async () => {
          const s = HaedoLife.Shell.storage, ws = await s.getActive();
          return Promise.all((await s.listPhotoPosts(ws)).map(row => s.readPhotoPost(ws, row.id)));
        });
        assert(stored.some(doc => JSON.stringify(doc.ops) === JSON.stringify(original.ops)), 'navigation saved the exact original draft');
        const count = ai.requests.length;
        await page.locator('[data-haedo-compose]:visible').first().click(); await page.locator('.ql-editor').waitFor();
        assert.equal((await editorState(page)).text, '\n', 'a new editor does not receive the old suggestion');
        assert.equal(ai.requests.length, count, 'returning to writing did not retry the old request');
      });
      return;
    }
    await check('selection preview sends nothing and discloses the provider, scope, retention and remaining budget', async () => {
      const original = await editorState(page);
      await openSuggestions(page);
      assert.equal(ai.requests.length, 0);
      await prepare(page);
      assert.equal(ai.requests.length, 0, 'preparing is local');
      const text = await panel(page).textContent();
      assert(text.includes(SELECTED), 'exact selected text is visible');
      assert(!text.includes(PREFIX) && !text.includes(SUFFIX), 'unselected private text stays outside the preview');
      assert.match(text, /Anthropic/); assert.match(text, /30일/); assert.match(text, /학습/);
      assert.match(await panel(page).locator('.writing-ai-notice').textContent(), /^고른 글을 Anthropic/);
      assert.doesNotMatch(await panel(page).locator('.writing-ai-notice').textContent(), /요청 문장|자료 발췌|AI 지침/, 'polish notice lists only the selected text actually sent');
      await awaitCondition(page, () => document.querySelector('.writing-ai-panel').textContent.includes('$7.50'), null, { label: 'remaining budget is loaded', timeout: 5000 });
      assert.deepEqual(await editorState(page), original, 'preview did not edit the document');
      await assertNoOverflow(page); await shot('preview');
    });
    await check('double send makes one exact allow-listed request, then only the chosen range is applied', async () => {
      const original = await editorState(page);
      const hold = ai.hold();
      await action(page, '보내기').evaluate(button => { button.click(); button.click(); });
      await hold.entered;
      assert.equal(ai.requests.length, 1, 'two clicks issue one request');
      const body = ai.requests[0].body;
      assert.deepEqual(Object.keys(body).sort(), ['requestId', 'selection', 'task']);
      assert.equal(body.task, 'polish'); assert.equal(body.selection, SELECTED);
      assert.match(body.requestId, /^[a-f\d-]{36}$/i);
      assert.equal(ai.requests[0].raw.includes(PREFIX), false); assert.equal(ai.requests[0].raw.includes(SUFFIX), false);
      assert.equal((await editorState(page)).text, PREFIX + SELECTED + SUFFIX + '\n', 'pending request does not edit');
      hold.release();
      await panel(page).getByText(REASON, { exact: true }).waitFor();
      const choices = panel(page).locator('[data-ai-range]');
      assert.equal(await choices.count(), 2, 'the two independent corrections have two choices');
      assert.equal(await choices.nth(0).isChecked(), false); assert.equal(await choices.nth(1).isChecked(), false);
      await choices.nth(0).check();
      await shot('comparison'); await assertNoOverflow(page);
      await action(page, '선택한 제안 적용').click();
      const state = await editorState(page);
      assert.equal(state.text, PREFIX + SELECTED.replace('고쳐여.', '고쳐요.') + SUFFIX + '\n');
      assert.equal(aiText(state), '고쳐요', 'only accepted inserted text carries AI authorship');
      assert(state.ops.some(op => typeof op.insert === 'string' && op.insert.includes('셋째 문장도 고쳐여.') && !op.attributes?.author), 'declined text keeps original authorship');
      if (await panel(page).isVisible()) await action(page, '닫기').click();
      await page.getByRole('button', { name: '실행 취소', exact: true }).click();
      assert.deepEqual(await editorState(page), original, 'one undo restores the exact original and authorship');
      await page.getByRole('button', { name: '다시 실행', exact: true }).click();
      assert.deepEqual(await editorState(page), state, 'one redo restores only the accepted AI correction');
    });
    await check('accepted text survives save and reopen, and remains editable', async () => {
      const before = await editorState(page);
      await page.getByRole('button', { name: '글 저장', exact: true }).click();
      await page.locator('.photo-article').waitFor();
      assert((await page.locator('.photo-article').textContent()).includes('첫째 문장을 고쳐요.'));
      assert.equal((await page.locator('.photo-article .blog-ai-text').allTextContents()).join(''), '고쳐요');
      await page.getByRole('button', { name: '글 수정', exact: true }).click();
      await page.locator('.ql-editor').waitFor();
      assert.deepEqual((await editorState(page)).ops, before.ops);
      await setSelection(page, (await editorState(page)).text.indexOf('고쳐요'), '고쳐요'.length);
      await page.keyboard.type('직접 고쳤다');
      assert.equal(aiText(await editorState(page)), '', 'owner edit is not automatically AI text');
    });
    if (label !== 'desktop') return;
    await typeFixture(page);
    await check('direct request and optional guidance preserve exact bytes and refuse an unfinished request-field composition', async () => {
      const instruction = '짧게 & 정확하게 <요청> "표현"을 고쳐 주세요.';
      const guidance = '임의 사실을 더하지 않기 & <문체> 그대로.';
      await openSuggestions(page);
      await page.locator('#writingAITask').selectOption('custom');
      await page.locator('#writingAIInstruction').fill(instruction);
      await panel(page).locator('.writing-ai-guidance > summary').click();
      await page.locator('#writingAIGuidanceEnabled').check(); await page.locator('#writingAIGuidance').fill(guidance);
      const count = ai.requests.length;
      for (const id of ['writingAIInstruction', 'writingAIGuidance']) {
        await page.locator('#' + id).evaluate(node => node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'ㅎ' })));
        await action(page, '보낼 내용 확인').evaluate(button => button.click());
        assert.equal(await panel(page).locator('.writing-ai-preview').isVisible(), false, 'unfinished composition is not captured');
        assert.equal(await panel(page).locator('.writing-ai-error').textContent(), '입력을 마친 뒤 다시 눌러 주세요.');
        assert.equal(ai.requests.length, count);
        await page.locator('#' + id).evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' })));
      }
      await action(page, '보낼 내용 확인').click();
      assert.match(await panel(page).locator('.writing-ai-notice').textContent(), /^고른 글·요청 문장·AI 지침을 Anthropic/);
      await action(page, '보내기').click(); await panel(page).getByText(REASON, { exact: true }).waitFor();
      assert.deepEqual(Object.keys(ai.requests.at(-1).body).sort(), ['guidance', 'instruction', 'requestId', 'selection', 'task']);
      assert.equal(ai.requests.at(-1).body.instruction, instruction); assert.equal(ai.requests.at(-1).body.guidance, guidance);
      assert.equal(ai.requests.at(-1).body.selection, SELECTED);
      await page.locator('#writingAIGuidanceEnabled').uncheck();
      await action(page, '보낼 내용 확인').click();
      assert.equal((await panel(page).locator('.writing-ai-preview').textContent()).includes(guidance), false);
      assert.match(await panel(page).locator('.writing-ai-notice').textContent(), /^고른 글·요청 문장을 Anthropic/);
      assert.doesNotMatch(await panel(page).locator('.writing-ai-notice').textContent(), /AI 지침/);
      await action(page, '보내기').click(); await panel(page).getByText(REASON, { exact: true }).waitFor();
      assert.deepEqual(Object.keys(ai.requests.at(-1).body).sort(), ['instruction', 'requestId', 'selection', 'task']);
      assert.equal((await editorState(page)).text, PREFIX + SELECTED + SUFFIX + '\n');
      await action(page, '닫기').click();
    });
    await typeFixture(page);
    await check('changed original and IME composition cannot be overwritten by an old suggestion', async () => {
      const requestCount = ai.requests.length;
      await page.evaluate(() => document.querySelector('.ql-editor').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'ㅎ' })));
      // Quill may replace the selected range when composition starts; the AI
      // entry must preserve the actual state immediately before its click.
      const entryOriginal = await editorState(page);
      await page.locator('#photoAI').evaluate(button => button.click());
      await awaitCondition(page, () => document.querySelector('.photo-commandbar .photo-status-text').textContent === '입력을 마친 뒤 다시 눌러 주세요.', null, { timeout: 5000, label: 'entry explains unfinished input without claiming an application' });
      assert.equal(await panel(page).count(), 0, 'unfinished editor composition cannot open a request');
      assert.equal(ai.requests.length, requestCount, 'unfinished editor composition sends nothing');
      assert.deepEqual(await editorState(page), entryOriginal, 'entry guard preserves the complete input');
      await page.evaluate(() => document.querySelector('.ql-editor').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' })));
      await typeFixture(page);
      await openSuggestions(page); await ask(page);
      await panel(page).locator('[data-ai-range]').first().check();
      const before = await editorState(page);
      // Exercise the composition guard with a browser CompositionEvent. Native
      // keyboard focus would commit the composition on the click, so the click
      // is dispatched synchronously to cover a still-open composition explicitly.
      await page.evaluate(() => document.querySelector('.ql-editor').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'ㅎ' })));
      await action(page, '선택한 제안 적용').evaluate(button => button.click());
      assert.deepEqual(await editorState(page), before, 'IME guard keeps the original ops');
      await page.evaluate(() => document.querySelector('.ql-editor').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' })));
      await page.evaluate(at => Quill.find(document.querySelector('.photo-quill')).insertText(at, '직접 ', 'user'), PREFIX.length);
      const changed = await editorState(page);
      await action(page, '선택한 제안 적용').click();
      assert.deepEqual(await editorState(page), changed, 'changed selected text is not overwritten');
      assert.match(await panel(page).textContent(), /바뀌|변경|다시/);
      await action(page, '닫기').click();
    });
    await typeFixture(page);
    await check('closing an in-flight request discards its late response and keeps writing available', async () => {
      await openSuggestions(page); await prepare(page);
      const hold = ai.hold(); await action(page, '보내기').click(); await hold.entered;
      const before = await editorState(page);
      await action(page, '닫기').click(); hold.release();
      await page.locator('.ql-editor').click(); await page.keyboard.press('End'); await page.keyboard.type(' 계속 작성');
      await page.waitForTimeout(150);
      assert.equal(await panel(page).isVisible(), false);
      assert((await editorState(page)).text.includes('계속 작성'));
      assert.equal(aiText(await editorState(page)), aiText(before));
    });
    await typeFixture(page);
    await check('configuration and monthly-limit failures preserve input; retry is explicit with a new request id', async () => {
      const before = await editorState(page);
      await openSuggestions(page); await prepare(page);
      ai.fail('ai_not_configured', 503); await action(page, '보내기').click();
      await panel(page).getByText('AI 제안이 아직 설정되지 않았어요.', { exact: true }).waitFor();
      assert.deepEqual(await editorState(page), before);
      const first = ai.requests.at(-1).body.requestId;
      ai.remainingMicroUsd = 7400000;
      await prepare(page); ai.fail('ai_refused', 422); await action(page, '보내기').click();
      await panel(page).getByText('AI가 이 요청에는 답하지 않았어요.', { exact: true }).waitFor();
      await awaitCondition(page, () => document.querySelector('.writing-ai-usage').textContent.includes('$7.40'), null, { timeout: 5000, label: 'a paid error refreshes the displayed remaining budget' });
      assert.deepEqual(await editorState(page), before);
      await prepare(page); ai.fail('ai_monthly_limit', 429); await action(page, '보내기').click();
      await awaitCondition(page, () => document.querySelector('.writing-ai-panel').textContent.includes('사용 한도'), null, { label: 'monthly limit is explained', timeout: 5000 });
      assert.notEqual(ai.requests.at(-1).body.requestId, first, 'new explicit attempt uses a new id');
      assert.deepEqual(await editorState(page), before);
      const count = ai.requests.length; await page.waitForTimeout(200); assert.equal(ai.requests.length, count, 'no automatic retry');
      await action(page, '닫기').click();
    });
    await typeFixture(page);
    await check('busy, access-denied and network failures preserve input and only retry after explicit review', async () => {
      const original = await editorState(page);
      await openSuggestions(page);
      for (const [kind, message, retryVisible] of [
        ['busy', 'AI 요청이 몰려 있어요. 잠시 뒤 다시 시도해 주세요.', true],
        ['denied', '이 계정에서는 AI 제안을 쓸 수 없어요.', false],
        ['network', '연결을 확인한 뒤 다시 시도해 주세요.', true],
      ]) {
        await prepare(page);
        const count = ai.requests.length;
        if (kind === 'busy') ai.fail('ai_busy', 503);
        else if (kind === 'denied') ai.fail('ai_not_allowed', 403);
        else ai.failNetwork();
        await action(page, '보내기').click();
        await panel(page).getByText(message, { exact: true }).waitFor();
        assert.equal(ai.requests.length, count + 1, 'failed attempt makes one HTTP request');
        assert.deepEqual(await editorState(page), original, kind + ' keeps every text run and format');
        assert.equal(await panel(page).locator('.writing-ai-result').isVisible(), false);
        assert.equal(await action(page, '다시 시도').isVisible(), retryVisible);
        const requestId = ai.requests.at(-1).body.requestId;
        await page.waitForTimeout(200);
        assert.equal(ai.requests.length, count + 1, kind + ' has no automatic retry');
        if (!retryVisible) continue;
        await action(page, '다시 시도').click();
        assert.equal(ai.requests.length, count + 1, 'retry prepares a new review without sending');
        await action(page, '보내기').click();
        await panel(page).getByText(REASON, { exact: true }).waitFor();
        assert.equal(ai.requests.length, count + 2);
        assert.notEqual(ai.requests.at(-1).body.requestId, requestId, 'explicit retry has a fresh request id');
        assert.deepEqual(await editorState(page), original, 'successful retry still waits for range acceptance');
      }
      await action(page, '닫기').click();
    });
    await typeFixture(page);
    await check('changing account while a request is pending discards all old-account suggestion content', async () => {
      await openSuggestions(page); await prepare(page);
      const hold = ai.hold(); await action(page, '보내기').click(); await hold.entered;
      await page.evaluate(value => HaedoAuth.client.auth.setSession(value), session(accounts.b));
      await page.waitForFunction(() => !HaedoAuth.user && !HaedoLife.Shell.storage);
      hold.release();
      assert.equal(await panel(page).isVisible(), false, 'old private panel is removed on account invalidation');
      await page.evaluate(() => HaedoLife.Shell.start()); await ready(page); await settle(page);
      await page.waitForFunction(id => HaedoAuth.user?.id === id, accounts.b.id);
      assert.equal(await page.getByText(REASON, { exact: true }).count(), 0, 'old response never reappears');
      const count = ai.requests.length;
      await page.locator('[data-haedo-compose]:visible').first().click(); await page.locator('.ql-editor').waitFor();
      assert.equal((await editorState(page)).text, '\n'); assert.equal(ai.requests.length, count);
    });
    await check('a selection containing a photo is rejected without changing the original image or sending a request', async () => {
      const bytes = await page.evaluate(async () => {
        const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4;
        canvas.getContext('2d').fillRect(0, 0, 4, 4);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        return [...new Uint8Array(await blob.arrayBuffer())];
      });
      await page.locator('#photoFiles').setInputFiles({ name: '익명 원본.png', mimeType: 'image/png', buffer: Buffer.from(bytes) });
      await page.locator('.photo-block').waitFor();
      const before = await editorState(page);
      const index = await page.evaluate(() => {
        const q = Quill.find(document.querySelector('.photo-quill')); let at = 0;
        for (const op of q.getContents().ops) { if (typeof op.insert !== 'string') return at; at += op.insert.length; }
        throw Error('photo fixture missing');
      });
      await setSelection(page, index, 1);
      const count = ai.requests.length;
      await page.locator('#photoAI').click();
      await awaitCondition(page, () => document.querySelector('.photo-commandbar .photo-status-text').textContent.includes('사진이 들어 있는 선택'), null, { timeout: 5000, label: 'photo selection is refused' });
      assert.equal(await panel(page).isVisible(), false); assert.equal(ai.requests.length, count);
      assert.deepEqual(await editorState(page), before, 'photo ops remain exact');
      const savedPhotos = await page.evaluate(async () => {
        const s = HaedoLife.Shell.storage, ws = await s.getActive();
        for (const row of await s.listPhotoPosts(ws)) {
          const doc = await s.readPhotoPost(ws, row.id);
          if (doc.photos.length) return Promise.all(doc.photos.map(async photo => [...new Uint8Array(await photo.blob.arrayBuffer())]));
        }
        return [];
      });
      assert.deepEqual(savedPhotos, [bytes], 'private original bytes are unchanged');
    });
  } finally { await context.close(); }
}
async function main() {
  await fs.mkdir(output, { recursive: true }); console.log('Evidence: ' + output);
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); report.node = process.version;
  try {
    await flow(browser, { label: 'boundaries', viewport: { width: 1440, height: 1000 }, boundaryOnly: true });
    if (!process.argv.includes('--boundaries')) {
      await flow(browser, { label: 'desktop', viewport: { width: 1440, height: 1000 } });
      await flow(browser, { label: 'mobile', viewport: { width: 390, height: 844 }, hasTouch: true });
    }
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []);
    report.pass = true;
  } finally { await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { AIHTTP };

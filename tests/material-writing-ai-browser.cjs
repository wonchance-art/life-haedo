/* Materials AI: actual app/SDK/IndexedDB and synthetic Auth/AI HTTP only.
 * No real account, provider, SQL, Apple device or native IME claim.
 * Start npm run dev, then node tests/material-writing-ai-browser.cjs. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, session, base, cloud } = require('./life-sync-browser.cjs');
const { AIHTTP } = require('./writing-ai-browser.cjs');
const output = path.resolve(__dirname, '../.local/material-writing-ai', new Date().toISOString().replace(/[:.]/g, '-'));
const report = { scope: 'Linux Chromium, synthetic Auth/AI HTTP and composition events; no real provider or Apple hardware.', checks: [], mutations: [], visual: [], consoleErrors: [], pageErrors: [], external: [] };
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
      const notice = await panel(page).locator('.writing-ai-notice').textContent();
      assert.match(notice, /^자료 발췌·요청 문장을 Anthropic/);
      assert(!notice.includes('고른 글'), 'no selected editor text is claimed for a material question');
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
      await open(page, 1, 'outline'); await page.locator('#writingAIInstruction').fill(''); await action(page, '보낼 내용 확인').click();
      const notice = await panel(page).locator('.writing-ai-notice').textContent();
      assert.match(notice, /^자료 발췌를 Anthropic/); assert(!notice.includes('요청 문장')); assert(!notice.includes('고른 글'));
      await action(page, '보내기').click(); await panel(page).getByText(ANSWER, { exact: true }).waitFor();
      assert.equal(ai.requests.at(-1).body.task, 'outline'); assert.deepEqual(ai.requests.at(-1).body.sources, [fixture.entries[1].quote]);
      assert.equal(Object.hasOwn(ai.requests.at(-1).body, 'instruction'), false);
      assert.deepEqual(await snapshot(page, fixture), before);
      await action(page, '닫기').click();
    });
    if (label === 'mobile') return;
    await check('unrelated source changes preserve the reviewed excerpt and allow the pending answer', async () => {
      await open(page);
      const unrelated = await page.evaluate(async f => {
        const s = HaedoLife.Shell.storage, C = HaedoLife.Core, bundle = await s.read(f.workspaceId);
        const prepared = await C.prepareImport({ origin: 'obsidian', title: '다른 자료', text: '이번 질문과 관계없는 새 자료', fileName: 'unrelated-ai.md' }, bundle);
        const stored = await s.commitLocal({ workspaceId: f.workspaceId, baseRevision: bundle.revision, operationId: C.id(), changes: C.buildImportChanges(bundle, prepared) });
        if (stored.status !== 'stored') throw Error('synthetic unrelated import failed');
        return prepared.source.id;
      }, fixture);
      assert.equal(await panel(page).isVisible(), true);
      assert.equal(await panel(page).locator('[data-ai-source]').first().isChecked(), true);
      assert.equal(await page.locator('#writingAIInstruction').inputValue(), QUESTION);
      const hold = ai.hold(); await action(page, '보내기').click(); await hold.entered;
      await page.evaluate(async ({ workspaceId, sourceId }) => {
        const s = HaedoLife.Shell.storage, C = HaedoLife.Core, bundle = await s.read(workspaceId);
        const stored = await s.commitLocal({ workspaceId, baseRevision: bundle.revision, operationId: C.id(), changes: C.buildSourceStateChanges(bundle, sourceId, 'trash') });
        if (stored.status !== 'stored') throw Error('synthetic unrelated trash failed');
      }, { workspaceId: fixture.workspaceId, sourceId: unrelated });
      hold.release(); await panel(page).getByText(ANSWER, { exact: true }).waitFor();
      assert.deepEqual(ai.requests.at(-1).body.sources, [fixture.entries[0].quote]);
      assert.equal(await panel(page).locator('[data-ai-source]').first().isChecked(), true);
      assert.equal(await page.locator('#writingAIInstruction').inputValue(), QUESTION);
      await action(page, '닫기').click();
    });
    await check('a new version of an excerpt source invalidates its panel but preserves the exact old reference', async () => {
      await open(page); const hold = ai.hold(); await action(page, '보내기').click(); await hold.entered;
      await page.evaluate(async f => {
        const s = HaedoLife.Shell.storage, C = HaedoLife.Core, bundle = await s.read(f.workspaceId);
        const prepared = await C.prepareImport({ origin: 'obsidian', existingSourceId: f.entries[0].sourceId, author: '익명 작성자', authorRelation: 'other', title: '첫 관찰',
          text: f.entries[0].raw + '\n원문에 나중에 더한 문장.', fileName: '첫 관찰.md' }, bundle);
        if (prepared.source.id !== f.entries[0].sourceId || prepared.version.id === f.entries[0].versionId) throw Error('fixture did not create the same source new version');
        const stored = await s.commitLocal({ workspaceId: f.workspaceId, baseRevision: bundle.revision, operationId: C.id(), changes: C.buildImportChanges(bundle, prepared) });
        if (stored.status !== 'stored') throw Error('synthetic source version failed');
      }, fixture);
      await panel(page).waitFor({ state: 'hidden' }); hold.release();
      await page.locator('.mw-error').getByText('발췌의 자료가 바뀌었습니다. AI 제안을 다시 열어 주세요.', { exact: true }).waitFor();
      assert.equal(await page.getByText(ANSWER, { exact: true }).count(), 0);
      const reference = (await snapshot(page, fixture)).preparation.plans.find(plan => plan.id === fixture.planId).blocks.find(block => block.kind === 'quote').reference;
      assert.equal(reference.sourceVersionId, fixture.entries[0].versionId); assert.equal(reference.quote, fixture.entries[0].quote);
      await page.locator('#mwAI').click(); await panel(page).waitFor();
      assert.equal(await page.locator('#writingAIInstruction').inputValue(), QUESTION, 'source invalidation retains the unsent question for this preparation');
      await panel(page).locator('[data-ai-source]').first().check(); await action(page, '보낼 내용 확인').click();
      await action(page, '보내기').click(); await panel(page).getByText(ANSWER, { exact: true }).waitFor();
      assert.deepEqual(ai.requests.at(-1).body.sources, [fixture.entries[0].quote], 'reopening keeps the explicitly chosen old version');
      await action(page, '닫기').click();
    });
    await check('request IME composition cannot create or send a stale preview', async () => {
      await page.locator('#mwAI').click(); await panel(page).waitFor(); await panel(page).locator('[data-ai-source]').first().check();
      await page.locator('#writingAIInstruction').fill(QUESTION);
      const count = ai.requests.length;
      await page.locator('#writingAIInstruction').evaluate(node => node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'ㅎ' })));
      await action(page, '보낼 내용 확인').evaluate(button => button.click());
      await panel(page).getByRole('alert').getByText('입력을 마친 뒤 다시 눌러 주세요.', { exact: true }).waitFor();
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
      await page.locator('#mwAI').click(); await panel(page).waitFor();
      assert.equal(await page.locator('#writingAIInstruction').inputValue(), '', 'a changed preparation does not inherit a prior request draft');
      await action(page, '닫기').click();
    });
    await check('source trash cancels pending excerpts and blocks another request until restored', async () => {
      await open(page); const hold = ai.hold(); await action(page, '보내기').click(); await hold.entered;
      await page.evaluate(async f => {
        const s = HaedoLife.Shell.storage, C = HaedoLife.Core, bundle = await s.read(f.workspaceId);
        const result = await s.commitLocal({ workspaceId: f.workspaceId, baseRevision: bundle.revision, operationId: C.id(), changes: C.buildSourceStateChanges(bundle, f.entries[0].sourceId, 'trash') });
        if (result.status !== 'stored') throw Error('synthetic source mutation failed');
      }, fixture);
      await panel(page).waitFor({ state: 'hidden' }); hold.release();
      await page.locator('.mw-error').getByText('휴지통에 있는 자료의 인용은 AI에 보내지 않습니다. 자료를 복원하거나 개요에서 해당 인용을 빼 주세요.', { exact: true }).waitFor();
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
      await page.locator('#mwAI').click(); await panel(page).waitFor();
      assert.equal(await page.locator('#writingAIInstruction').inputValue(), QUESTION, 'a blocked reopen while trashed did not discard the recovery question');
      await action(page, '닫기').click();
      await page.locator('#mwAI').click(); await panel(page).waitFor();
      assert.equal(await page.locator('#writingAIInstruction').inputValue(), '', 'ordinary close does not preserve a request question');
      await action(page, '닫기').click();
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
      await page.evaluate(value => HaedoAuth.client.auth.setSession(value), session(accounts.a));
      await page.waitForFunction(() => !HaedoAuth.user && !HaedoLife.Shell.storage);
      await page.evaluate(() => HaedoLife.Shell.start()); await ready(page); await settle(page);
      await enter(page); await page.locator('#mwAI').click(); await panel(page).waitFor();
      assert.equal(await page.locator('#writingAIInstruction').inputValue(), '', 'account changes also discard any request draft when returning to the prior account');
      await action(page, '닫기').click();
    });
  } finally { await context.close(); }
}
// These races intentionally bypass the storage notification API: a second raw
// IndexedDB connection commits a real bundle while the mounted adapter has not
// observed a `changed` event. Fresh reads, not simulated event delivery, must
// protect each network boundary. No application function is replaced here.
async function silentSourceChange(page, fixture, kind) {
  return page.evaluate(async ({ fixture: f, kind }) => {
    const s = HaedoLife.Shell.storage, C = HaedoLife.Core, original = await s.read(f.workspaceId);
    let changes;
    if (kind === 'trash') changes = C.buildSourceStateChanges(original, f.entries[0].sourceId, 'trash');
    else {
      const imported = await C.prepareImport({ origin: 'obsidian', existingSourceId: f.entries[0].sourceId,
        author: '익명 작성자', authorRelation: 'other', title: '첫 관찰', text: f.entries[0].raw + '\n알림 없이 저장한 새 판.', fileName: '첫 관찰.md' }, original);
      if (imported.source.id !== f.entries[0].sourceId || imported.version.id === f.entries[0].versionId) throw Error('new version fixture mismatch');
      changes = C.buildImportChanges(original, imported);
    }
    const next = C.applyChanges(original, changes), observed = [];
    const stop = s.subscribe(f.workspaceId, event => observed.push(event.type));
    try {
      await new Promise((resolve, reject) => {
        const opening = indexedDB.open('life-tools-v1'); opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result, tx = db.transaction('bundles', 'readwrite');
          tx.objectStore('bundles').put(next);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || Error('raw bundle commit failed')); };
        };
      });
      const stored = await s.read(f.workspaceId);
      if (kind === 'trash' && C.isSourceActive(stored, f.entries[0].sourceId)) throw Error('raw trash write not observable through storage');
      if (kind === 'new-version' && stored.sourceVersions.filter(version => version.sourceId === f.entries[0].sourceId).length !== original.sourceVersions.filter(version => version.sourceId === f.entries[0].sourceId).length + 1) throw Error('raw version write not observable through storage');
      if (observed.includes('changed')) throw Error('silent fixture unexpectedly announced a source change');
      return { beforeRevision: original.revision, storedRevision: stored.revision, notifiedChanges: observed.filter(type => type === 'changed').length };
    } finally { stop(); }
  }, { fixture, kind });
}
// Observe the actual auth API rather than adding a production test branch.
// The optional gate returns the real SDK getSession result only after release;
// all verification, tokens and source validation remain the app's normal code.
async function installAuthProbe(page, holdSession) {
  await page.evaluate(hold => {
    const original = HaedoAuth, wrapped = Object.create(original), realClient = original.getClient();
    const probe = window.__aiBoundaryProbe = { verifyCalls: 0, sessionCalls: 0, sessionEntered: false };
    let release;
    const pending = new Promise(resolve => { release = resolve; }); probe.releaseSession = release;
    const client = Object.create(realClient), auth = Object.create(realClient.auth);
    Object.defineProperty(auth, 'getSession', { value: async () => {
      probe.sessionCalls++;
      const result = await realClient.auth.getSession();
      if (hold) { probe.sessionEntered = true; await pending; }
      return result;
    } });
    Object.defineProperty(client, 'auth', { value: auth });
    Object.defineProperty(wrapped, 'getClient', { value: () => client });
    Object.defineProperty(wrapped, 'verify', { value: (...args) => { probe.verifyCalls++; return original.verify(...args); } });
    window.HaedoAuth = wrapped;
  }, holdSession);
}
const GUARD_MUTATIONS = {
  'before-send': ['        await verifyCurrent();\n        value = await ai.send', '        /* mutation: omit pre-send source recheck */\n        value = await ai.send'],
  'token-return': ['        await verifyCurrent();\n        return session.data.session.access_token;', '        /* mutation: omit token-return source recheck */\n        return session.data.session.access_token;'],
  'after-response': ['        await verifyCurrent();\n      }\n      catch', '        /* mutation: omit post-response source recheck */\n      }\n      catch'],
};
async function sourceGuardCase(browser, stage, kind, mutation = false) {
  const label = stage + '-' + kind + (mutation ? '-mutation' : ''), server = new FakeCloud(), ai = new AIHTTP();
  const context = await makeContext(browser, server, 'source-guard-' + label, accounts.a, { viewport: { width: 1440, height: 1000 } });
  await ai.attach(context);
  let mutationEvidence = null;
  if (mutation) await context.route(base + '/assets/life/writing-ai-ui.js', async route => {
    const response = await route.fetch(), source = await response.text(), [before, after] = GUARD_MUTATIONS[stage];
    assert.equal(source.split(before).length - 1, 1, 'mutation must match exactly one source boundary');
    const changed = source.replace(before, after);
    mutationEvidence = { stage, kind, sourceSha256: createHash('sha256').update(source).digest('hex'), servedSha256: createHash('sha256').update(changed).digest('hex'), changedAwaitCalls: 1 };
    await route.fulfill({ response, body: changed });
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if ([new URL(base).origin, cloud].includes(url.origin) || ['blob:', 'data:'].includes(url.protocol)) return route.fallback();
    report.external.push(url.origin); return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ label, text: message.text(), url: message.location().url }); });
  page.on('pageerror', error => report.pageErrors.push({ label, message: error.message }));
  const marker = {
    'before-send': 'pre-send validation must reject stale sources before starting authentication',
    'token-return': 'token-return validation must reject stale sources before sending AI HTTP',
    'after-response': 'post-response validation must remove the panel before showing stale-source output',
  }[stage];
  let evidence;
  console.log('START source guard: ' + label);
  try {
    await page.goto(base + '/index.html'); await ready(page); await settle(page);
    const fixture = await seed(page); await enter(page);
    await installAuthProbe(page, stage === 'token-return');
    await open(page);
    await page.waitForFunction(() => document.querySelector('.writing-ai-usage')?.textContent.includes('$7.50'));
    assert.equal(await page.evaluate(() => __aiBoundaryProbe.verifyCalls), 0, 'panel preparation did not start the observed AI authentication');
    if (stage === 'before-send') {
      evidence = await silentSourceChange(page, fixture, kind);
      assert.equal(await panel(page).isVisible(), true, 'no notification has already closed the panel');
      await action(page, '보내기').click(); await panel(page).waitFor({ state: 'hidden' });
      assert.equal(ai.requests.length, 0, 'stale sources send no AI request');
      assert.equal(await page.evaluate(() => __aiBoundaryProbe.verifyCalls), 0, marker);
    } else if (stage === 'token-return') {
      await action(page, '보내기').click();
      await page.waitForFunction(() => __aiBoundaryProbe.sessionEntered);
      assert.equal(await page.evaluate(() => __aiBoundaryProbe.verifyCalls), 1);
      evidence = await silentSourceChange(page, fixture, kind);
      assert.equal(await panel(page).isVisible(), true, 'session gate holds the request without a change event');
      await page.evaluate(() => __aiBoundaryProbe.releaseSession());
      await panel(page).waitFor({ state: 'hidden' });
      assert.equal(ai.requests.length, 0, marker);
    } else {
      const held = ai.hold(); await action(page, '보내기').click(); await held.entered;
      assert.equal(ai.requests.length, 1, 'the request passed both earlier validations');
      evidence = await silentSourceChange(page, fixture, kind);
      assert.equal(await panel(page).isVisible(), true, 'silent write does not trigger the subscription path');
      held.release(); await held.completed;
      await page.waitForFunction(() => !document.querySelector('.writing-ai-panel') || !document.querySelector('.writing-ai-result')?.hidden);
      assert.equal(await panel(page).count(), 0, marker);
    }
    assert.equal(await page.getByText(ANSWER, { exact: true }).count(), 0, 'invalidated answer stays absent');
    const expected = kind === 'trash' ? '휴지통에 있는 자료의 인용은 AI에 보내지 않습니다. 자료를 복원하거나 개요에서 해당 인용을 빼 주세요.' : '발췌의 자료가 바뀌었습니다. AI 제안을 다시 열어 주세요.';
    await page.locator('.mw-error').getByText(expected, { exact: true }).waitFor();
    if (mutation) assert.fail('MUTATION_SURVIVED: ' + label);
    report.checks.push({ label: 'source-guards', name: stage + ' / ' + kind, pass: true, evidence });
    console.log('PASS source guard: ' + label);
  } catch (error) {
    if (mutation && error instanceof assert.AssertionError && error.message.includes(marker)) {
      assert(mutationEvidence, 'the mutated browser script was actually served');
      report.mutations.push({ ...mutationEvidence, detected: true, failedAssertion: marker, actual: error.actual, expected: error.expected, evidence });
      console.log('DETECTED source guard mutation: ' + label + ' / ' + marker);
    } else {
      report.checks.push({ label: 'source-guards', name: label, pass: false, error: error.message });
      await page.screenshot({ path: path.join(output, label + '-failure.png') }).catch(() => {}); throw error;
    }
  } finally { await context.close(); }
}
async function sourceGuardChecks(browser, mutations = false) {
  for (const stage of ['before-send', 'token-return', 'after-response']) for (const kind of ['trash', 'new-version']) {
    await sourceGuardCase(browser, stage, kind);
    if (mutations) await sourceGuardCase(browser, stage, kind, true);
  }
}
async function main() {
  await fs.mkdir(output, { recursive: true }); console.log('Evidence: ' + output);
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version();
  try {
    if (process.argv.includes('--source-guards')) await sourceGuardChecks(browser, true);
    else {
      await flow(browser, 'desktop', { width: 1440, height: 1000 });
      await flow(browser, 'mobile', { width: 390, height: 844 });
      await sourceGuardChecks(browser);
    }
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } finally { await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

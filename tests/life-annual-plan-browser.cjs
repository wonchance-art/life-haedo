/* Annual planning journeys on the real local UI, bundled SDK and scoped IDB.
 * Auth/remote HTTP is anonymous FakeCloud; birthdate and all plans are synthetic.
 * No real account, server write, external calendar, Apple device or OS file-save claim. */
'use strict';
const { isLegacyLibraryCapabilityRead } = require('./helpers/library-cloud.cjs');
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { FakeCloud, accounts, session, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, nav } = require('./unified-home-browser.cjs');
const output = path.resolve(process.env.ANNUAL_PLAN_OUTPUT || '.local/annual-plan-browser');
const entry = base + '/index.html?section=tools&view=annual-plan';
const PRIVATE = '합성개인계획_외부전송금지';
const RAW = '\ufeff연간 계획과 분리된 합성 원문 😀\r\nCafe\u0301와 정확한 줄바꿈';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { createdAt: new Date().toISOString(), scope: 'Local actual UI/Core/bundled SDK/scoped IndexedDB with anonymous FakeCloud Auth. Birthdate, annual/monthly plans, composition events, account sessions and save/read delays are synthetic. No production user/DB, publisher/AI/calendar requests, actual Apple hardware or OS file-save proof.', checks: [], visual: [], consoleErrors: [], pageErrors: [], externalRequests: [], privacyViolations: [], libraryCapabilityReads: [], remoteWrites: [], closedContexts: 0 };
async function wait(page, predicate, argument, label = 'annual plan state') {
  await page.waitForFunction(predicate, argument, { timeout: 20000 });
}
async function open(page) { await page.goto(entry); await ready(page); await page.locator('#apGrid').waitFor(); }
async function settings(page) {
  const disclosure = page.locator('#apSettings');
  if (!await disclosure.evaluate(el => el.open)) await disclosure.locator(':scope > summary').click();
}
async function state(page) {
  return page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, w = await s.getActive();
    return { workspaceId: w, plan: await s.readAnnualPlan(w), bundle: await s.read(w), workbench: await s.readWorkbench(w) };
  });
}
async function preserve(page, before) {
  const after = await state(page);
  assert.deepEqual(after.bundle, before.bundle, 'Original bundle is unchanged');
  assert.deepEqual(after.workbench, before.workbench, 'Existing workbench is unchanged');
  return after;
}
async function stored(page, predicate, argument) {
  await wait(page, async ({ source, argument }) => {
    const s = HaedoLife.Shell.storage, p = await s.readAnnualPlan(await s.getActive());
    return new Function('p', 'a', 'return (' + source + ')(p,a)')(p, argument);
  }, { source: predicate.toString(), argument }, 'Persisted plan');
  await wait(page, () => document.querySelector('.annual-plan')?.dataset.dirty === 'false');
  assert.equal(await page.locator('#apError').isVisible(), false);
}
async function seed(page) {
  await open(page);
  await page.evaluate(async raw => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, w = await s.getActive(), b = await s.read(w);
    const prepared = await c.prepareImport({ origin: 'other', title: '연간 계획 보존 확인용 합성 원문', text: raw, authorRelation: 'self', forceSeparate: true }, b);
    const result = await s.commitLocal({ workspaceId: w, baseRevision: b.revision, operationId: c.id(), changes: c.buildImportChanges(b, prepared, []) });
    if (result.status !== 'stored') throw Error('Synthetic original could not be stored');
  }, RAW);
  // Finish raw-fixture preparation before entering the actual planning scene.
  // This reads the new bundle and clears no real unsaved user input.
  await open(page);
  return state(page);
}
const annual = (page, year) => page.locator('[data-ap-annual="' + year + '"]');
async function writeYear(page, year, text) {
  await annual(page, year).fill(text);
  await stored(page, (p, a) => p.rows.some(r => r.year === a.year && r.text === a.text), { year, text });
}
async function update(page, patch) {
  return page.evaluate(async patch => {
    const s = HaedoLife.Shell.storage, w = await s.getActive(), M = HaedoLife.AnnualPlan, old = await s.readAnnualPlan(w);
    const next = M.update(old, patch, { expectedRevision: old.revision }), result = await s.saveAnnualPlan(w, next, old.revision);
    if (result.status !== 'stored') throw Error('Synthetic concurrent annual plan did not store');
    return result.profile;
  }, patch);
}
async function storageGate(context) {
  await context.route(base + '/assets/life/storage.js', async route => {
    const response = await route.fetch();
    const hook = `\n;(()=>{const old=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...old,forAccount(...args){const actual=old.forAccount(...args);return Object.freeze({...actual,async saveAnnualPlan(...values){if(window.__holdAnnualSave){window.__annualSaveEntered=true;await new Promise(resolve=>window.__annualSaveRelease=()=>{window.__holdAnnualSave=false;resolve();});}const result=await actual.saveAnnualPlan(...values);if(window.__holdAnnualResult){window.__annualResultEntered=true;await new Promise(resolve=>window.__annualResultRelease=()=>{window.__holdAnnualResult=false;resolve();});}return result;},async readAnnualPlan(...values){const result=await actual.readAnnualPlan(...values);if(window.__holdAnnualRead){window.__annualReadEntered=true;await new Promise(resolve=>window.__annualReadRelease=()=>{window.__holdAnnualRead=false;resolve();});}return result;}});}});})();`;
    await route.fulfill({ response, body: await response.text() + hook });
  });
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const files = ['index.html', 'life.html', 'assets/life/ui.js', 'assets/life/annual-plan.js', 'assets/life/annual-plan-ui.js', 'assets/life/annual-plan.css', 'assets/life/storage.js', 'assets/life/core.js', 'assets/life/shell.js', 'assets/platform-auth.js', 'tests/life-annual-plan-browser.cjs'];
  const hashes = async () => Object.fromEntries(await Promise.all(files.map(async name => [name, sha(await fs.readFile(path.resolve(__dirname, '..', name)))])));
  report.sourceHashesBefore = await hashes();
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  async function check(name, run) {
    if (process.env.ANNUAL_PLAN_MATCH && !new RegExp(process.env.ANNUAL_PLAN_MATCH).test(name)) return;
    const server = new FakeCloud(), device = 'annual-plan-' + report.checks.length;
    const context = await makeContext(browser, server, device, accounts.a, { viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await storageGate(context);
    context.on('request', request => {
      const u = new URL(request.url()), body = request.postData() || '';
      if ([PRIVATE, RAW, '2000-02-29'].some(text => u.href.includes(text) || u.href.includes(encodeURIComponent(text)) || body.includes(text) || body.includes(JSON.stringify(text).slice(1, -1)))) report.privacyViolations.push({ check: name, destination: u.origin + u.pathname });
      if (isLegacyLibraryCapabilityRead(request, { cloud, server })) report.libraryCapabilityReads.push({ check: name, owner: server.libraryOwner(request), method: request.method(), path: u.pathname, parameterCount: 0 });
      else if (u.origin === cloud && !['GET', 'OPTIONS'].includes(request.method()) && !u.pathname.startsWith('/auth/')) report.remoteWrites.push({ check: name, method: request.method(), path: u.pathname });
    });
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback();
      report.externalRequests.push({ check: name, destination: u.origin + u.pathname });
      return route.abort('blockedbyclient');
    });
    context.on('page', observed => {
      observed.setDefaultTimeout(15000);
      observed.on('pageerror', error => report.pageErrors.push({ check: name, message: error.message }));
      observed.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ check: name, message: event.text() }); });
    });
    const page = await context.newPage();
    console.log('RUN ' + name);
    try { await run({ page, context, server }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); report.closedContexts++; }
  }
  try {
    await check('tools entry, annual Enter and monthly edits persist across reopen without changing originals', async ({ page }) => {
      const before = await seed(page), year = before.plan.rows[0].year;
      assert.equal(before.plan.revision, 0, 'Opening the plan does not manufacture a saved revision');
      await nav(page, 'tools'); await page.getByRole('button', { name: '연간 계획', exact: true }).click(); await page.locator('#apGrid').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('view'), 'annual-plan');
      await settings(page); await page.locator('#apBirthDate').fill('2000-02-29'); await stored(page, p => p.birthDate === '2000-02-29');
      await page.locator('#apAgeMode').selectOption('both'); await stored(page, p => p.ageMode === 'both');
      await writeYear(page, year, PRIVATE + ' — 연간 계획');
      await annual(page, year).press('Enter'); await annual(page, year + 1).waitFor();
      await writeYear(page, year + 1, '다음 해의 계획');
      assert.equal(await page.locator('[data-ap-year="' + year + '"] [data-ap-month]').count(), 12, 'All twelve empty months retain their columns');
      const add = page.locator('[data-ap-add-month="' + year + '-03-01"]'); await add.click();
      const month = page.locator('[data-ap-month="' + year + '-03-01"] [data-ap-entry]').first(); await month.fill('3월 계획\n두 번째 문장');
      await stored(page, (p, y) => p.entries.some(x => x.date === y + '-03-01' && x.text === '3월 계획\n두 번째 문장'), year);
      const saved = await preserve(page, before); await page.reload(); await ready(page); await page.locator('#apGrid').waitFor();
      assert.deepEqual((await state(page)).plan, saved.plan);
      assert.equal(await annual(page, year).inputValue(), PRIVATE + ' — 연간 계획');
      await nav(page, 'home'); await nav(page, 'tools'); await page.getByRole('button', { name: '연간 계획', exact: true }).click(); await page.locator('#apGrid').waitFor();
      assert.equal(await month.inputValue(), '3월 계획\n두 번째 문장'); await preserve(page, before);
    });

    await check('Korean composition and Shift Enter preserve the editing node, caret and next-year intent', async ({ page }) => {
      const before = await seed(page), year = before.plan.rows[0].year, field = annual(page, year);
      await field.focus();
      await field.evaluate((el, text) => { window.__annualComposingNode = el; el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); el.value = text; el.setSelectionRange(2, 6); el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: text })); el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', isComposing: true, keyCode: 229 })); }, PRIVATE);
      assert.equal(await annual(page, year + 1).count(), 0, 'IME Enter does not create another year');
      assert.deepEqual(await field.evaluate(el => ({ same: el === __annualComposingNode, text: el.value, start: el.selectionStart, end: el.selectionEnd, focused: document.activeElement === el })), { same: true, text: PRIVATE, start: 2, end: 6, focused: true });
      await field.dispatchEvent('compositionend', { data: PRIVATE }); await stored(page, (p, y) => p.rows.some(r => r.year === y && r.text === '합성개인계획_외부전송금지'), year);
      await field.evaluate(el => el.setSelectionRange(el.value.length, el.value.length)); await field.press('Shift+Enter'); await field.press('End'); await field.press('A');
      await stored(page, (p, y) => p.rows.some(r => r.year === y && r.text === '합성개인계획_외부전송금지\nA'), year);
      assert.equal(await annual(page, year + 1).count(), 0, 'Shift Enter remains a newline');
      assert.equal(await field.evaluate(el => el === __annualComposingNode), true, 'Autosave retains the native textarea');
      await field.press('Enter'); await annual(page, year + 1).waitFor();
      assert.equal(await annual(page, year + 1).evaluate(el => document.activeElement === el), true); await preserve(page, before);
    });

    await check('birthday and quarter display changes retain absolute monthly dates and early-year plans', async ({ page }) => {
      const before = await seed(page), year = before.plan.rows[0].year;
      const entries = [{ id: 'synthetic-before-birthday', date: year + '-01-20', text: '생일 전의 계획' }, { id: 'synthetic-after-birthday', date: year + '-03-10', text: '생일 후의 계획' }, { id: 'synthetic-next-year', date: (year + 1) + '-01-15', text: '다음 해 1월 계획' }];
      await update(page, { birthDate: '2000-02-29', entries }); await page.reload(); await ready(page); await page.locator('#apGrid').waitFor();
      await settings(page); await page.locator('#apBasis').selectOption('birthday'); await stored(page, p => p.basis === 'birthday');
      assert.deepEqual((await state(page)).plan.entries, entries);
      assert.ok(await page.locator('[data-ap-year="' + (year - 1) + '"]').count(), 'A needed preceding birthday row remains visible');
      for (const e of entries) assert.equal(await page.locator('[data-ap-entry="' + e.id + '"]').inputValue(), e.text);
      const starts = await page.locator('[data-ap-year="' + year + '"] [data-ap-month]').evaluateAll(nodes => nodes.map(x => x.dataset.apMonth));
      assert.equal(starts.length, 12); assert.match(starts[0], new RegExp('^' + year + '-02-(28|29)$')); assert.equal(starts[1], year + '-03-29', 'Monthly clamp does not accumulate');
      await page.locator('#apQuarters').uncheck(); await stored(page, p => p.quarters === false); assert.deepEqual((await state(page)).plan.entries, entries);
      await page.locator('#apBasis').selectOption('year'); await stored(page, p => p.basis === 'year'); assert.deepEqual((await state(page)).plan.entries, entries);
      await page.reload(); await ready(page); await page.locator('#apGrid').waitFor(); for (const e of entries) assert.equal(await page.locator('[data-ap-entry="' + e.id + '"]').inputValue(), e.text);
      await settings(page); await page.locator('#apBasis').selectOption('birthday'); await stored(page, p => p.basis === 'birthday');
      await page.locator('#apBirthDate').fill(''); await stored(page, p => p.birthDate === '' && p.basis === 'year');
      assert.deepEqual((await state(page)).plan.entries, entries, 'Clearing the birthday returns to year basis without moving monthly plans');
      await page.reload(); await ready(page); await page.locator('#apGrid').waitFor();
      assert.equal(await page.locator('#apBirthDate').inputValue(), ''); assert.equal(await page.locator('#apBasis').inputValue(), 'year'); assert.deepEqual((await state(page)).plan.entries, entries);
      await preserve(page, before);
    });

    await check('dedicated backup previews, cancellation and invalid files leave the current plan intact before explicit restore', async ({ page }) => {
      const before = await seed(page), year = before.plan.rows[0].year; await writeYear(page, year, PRIVATE + ' 백업할 계획'); await settings(page);
      const downloadPending = page.waitForEvent('download'); await page.locator('#apExport').click(); const download = await downloadPending, chunks = [];
      for await (const chunk of await download.createReadStream()) chunks.push(chunk);
      const bytes = Buffer.concat(chunks), portable = JSON.parse(bytes.toString('utf8')), current = (await state(page)).plan;
      assert.equal(portable.format, 'haedo-annual-plan'); assert.equal(portable.schemaVersion, 1);
      for (const secret of [before.workspaceId, accounts.a.id, RAW]) assert.equal(bytes.toString('utf8').includes(secret), false, 'Dedicated backup excludes identifiers/unrelated original');
      portable.plan.rows.find(r => r.year === year).text = '복원할 별도 합성 계획';
      const valid = Buffer.from(JSON.stringify(portable));
      const select = buffer => page.locator('#apImport').setInputFiles({ name: 'anonymous-annual-plan.json', mimeType: 'application/json', buffer });
      await select(valid); await page.locator('#apImportPreview').waitFor(); assert.deepEqual((await state(page)).plan, current);
      await page.locator('#apImportCancel').click(); assert.deepEqual((await state(page)).plan, current);
      for (const bad of [Buffer.from('{not-json'), Buffer.from(JSON.stringify({ ...portable, unexpected: RAW })), Buffer.alloc(2 * 1024 * 1024 + 1, 0x20)]) {
        await select(bad); await page.locator('#apImportError').waitFor({ state: 'visible' }); assert.deepEqual((await state(page)).plan, current);
      }
      await select(valid); await page.locator('#apImportPreview').waitFor(); assert.deepEqual((await state(page)).plan, current);
      await page.locator('#apImportApply').click(); await stored(page, (p, y) => p.rows.find(r => r.year === y)?.text === '복원할 별도 합성 계획', year);
      const restored = (await preserve(page, before)).plan; assert.equal(restored.workspaceId, current.workspaceId); assert.ok(restored.revision > current.revision);
      await page.reload(); await ready(page); await page.locator('#apGrid').waitFor(); assert.equal(await annual(page, year).inputValue(), '복원할 별도 합성 계획');
      report.backup = { downloadRequested: true, bytes: bytes.length, osFileSaved: false, previewAndCancelNoWrite: true, explicitRestore: true };
    });

    await check('failed local save keeps the exact draft and retries after storage recovers', async ({ page }) => {
      const before = await seed(page), year = before.plan.rows[0].year, draft = PRIVATE + ' 저장 실패 후에도 남는 계획 😀\n다음 문장';
      await page.evaluate(() => { window.__annualOriginalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { const request = __annualOriginalPut.apply(this, args); if (this.name === 'meta' && args[0]?.key?.startsWith('annualPlan:')) this.transaction.abort(); return request; }; });
      await annual(page, year).fill(draft); await page.locator('#apRetry').waitFor({ state: 'visible' });
      assert.deepEqual((await state(page)).plan, before.plan); assert.equal(await annual(page, year).inputValue(), draft); assert.notEqual(await page.locator('#apSaveStatus').textContent(), '저장됨');
      await page.evaluate(() => { IDBObjectStore.prototype.put = __annualOriginalPut; }); await page.locator('#apRetry').click();
      await stored(page, (p, a) => p.rows.find(r => r.year === a.year)?.text === a.draft, { year, draft }); await preserve(page, before);
    });

    await check('two-tab CAS leaves the exact draft until latest-read and explicit reapply', async ({ page, context }) => {
      const before = await seed(page), year = before.plan.rows[0].year, second = await context.newPage(); await open(second);
      const draft = PRIVATE + ' 이 탭의 정확한 입력';
      await page.evaluate(() => { window.__holdAnnualSave = true; }); await annual(page, year).fill(draft); await wait(page, () => window.__annualSaveEntered);
      const remote = await update(second, { rows: [{ year, text: '다른 탭에 먼저 저장한 계획' }] }); await page.evaluate(() => __annualSaveRelease());
      await page.locator('#apReload').waitFor({ state: 'visible' }); assert.equal(await annual(page, year).inputValue(), draft); assert.deepEqual((await state(page)).plan, remote);
      await page.locator('#apReload').click(); await page.locator('#apReapply').waitFor({ state: 'visible' });
      assert.equal(await annual(page, year).inputValue(), draft); assert.deepEqual((await state(page)).plan, remote, 'Reading latest does not silently overwrite the other tab');
      await page.locator('#apReapply').click(); await stored(page, (p, a) => p.rows.find(r => r.year === a.year)?.text === a.draft, { year, draft });
      assert.equal((await state(page)).plan.revision, remote.revision + 1); await preserve(page, before); await second.close();
    });

    await check('workspace and account changes isolate plans and reject the old delayed writer', async ({ page }) => {
      const before = await seed(page), year = before.plan.rows[0].year; await writeYear(page, year, '첫 작업공간에만 저장할 계획');
      const first = (await state(page)).workspaceId;
      const other = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, old = await s.getActive(), b = await s.createWorkspace('합성 두 번째 계획 공간'); await s.setActive(old); return b.workspaceId; });
      // The synthetic setup writes directly to storage. Reopen once so the real
      // workspace picker reads its new inventory, as an app-created space would.
      await page.reload(); await ready(page); await page.locator('#apGrid').waitFor();
      await nav(page, 'manage'); await page.locator('#lifeCurrentWorkspace').click(); await page.locator('#lifeWorkspace').selectOption(other);
      await wait(page, async w => (await HaedoLife.Shell.storage.getActive()) === w, other); await nav(page, 'tools'); await page.getByRole('button', { name: '연간 계획', exact: true }).click(); await page.locator('#apGrid').waitFor();
      assert.ok((await state(page)).plan.rows.every(r => r.text === '')); await writeYear(page, year, '두 번째 공간의 독립 계획');
      await nav(page, 'manage'); await page.locator('#lifeCurrentWorkspace').click(); await page.locator('#lifeWorkspace').selectOption(first);
      await wait(page, async w => (await HaedoLife.Shell.storage.getActive()) === w, first); await nav(page, 'tools'); await page.getByRole('button', { name: '연간 계획', exact: true }).click(); await page.locator('#apGrid').waitFor();
      assert.equal(await annual(page, year).inputValue(), '첫 작업공간에만 저장할 계획');
      await page.evaluate(() => { window.__holdAnnualSave = true; window.__oldAnnualStorage = HaedoLife.Shell.storage; }); await annual(page, year).fill(PRIVATE + ' 이전 계정의 지연 입력'); await wait(page, () => window.__annualSaveEntered);
      await page.evaluate(value => HaedoAuth.client.auth.setSession(value), session(accounts.b)); await wait(page, () => !HaedoAuth.user && !HaedoLife.Shell.storage);
      assert.equal(await page.locator('#lifeApp').isHidden(), true); await page.evaluate(() => __annualSaveRelease()); await page.evaluate(() => HaedoLife.Shell.start()); await ready(page);
      await wait(page, id => HaedoAuth.user?.id === id, accounts.b.id);
      assert.equal(await page.evaluate(async w => { try { await __oldAnnualStorage.readAnnualPlan(w); return null; } catch (error) { return error.code; } }, first), 'storage_scope_closed');
      await page.goto(entry); await ready(page); await page.locator('#apGrid').waitFor(); const next = await state(page);
      assert.ok(next.plan.rows.every(r => r.text === '')); assert.deepEqual(next.plan.entries, []);
      await page.evaluate(value => HaedoAuth.client.auth.setSession(value), session(accounts.a)); await wait(page, () => !HaedoAuth.user && !HaedoLife.Shell.storage);
      await page.evaluate(() => HaedoLife.Shell.start()); await ready(page); await wait(page, id => HaedoAuth.user?.id === id, accounts.a.id);
      await page.goto(entry); await ready(page); await page.locator('#apGrid').waitFor();
      assert.equal((await state(page)).plan.rows.find(r => r.year === year)?.text, '첫 작업공간에만 저장할 계획', 'The delayed old writer could not change the previous account');
      assert.equal(await page.evaluate(async ({ other, year }) => (await HaedoLife.Shell.storage.readAnnualPlan(other)).rows.find(r => r.year === year)?.text, { other, year }), '두 번째 공간의 독립 계획');
      await preserve(page, before);
    });

    await check('annual deletion and restore undo preserve dated entries and cannot overwrite later edits', async ({ page }) => {
      const before = await seed(page), year = before.plan.rows[0].year, id = 'synthetic-undo-month';
      await writeYear(page, year, '삭제 전에 적은 연간 계획');
      await update(page, { entries: [{ id, date: year + '-03-10', text: '연간 행과 독립적인 월 계획' }] });
      await page.reload(); await ready(page); await page.locator('#apGrid').waitFor();
      async function removeAnnual() {
        await page.locator('[data-ap-remove-year="' + year + '"]').click();
        await page.locator('#apConfirmation').getByRole('button', { name: '삭제', exact: true }).click();
        await stored(page, (p, y) => !p.rows.some(r => r.year === y), year);
      }
      await removeAnnual();
      assert.equal(await page.locator('[data-ap-year="' + year + '"]').count(), 1, 'Dated entries retain their projected year after annual text deletion');
      assert.equal(await annual(page, year).inputValue(), '');
      assert.deepEqual((await state(page)).plan.entries, [{ id, date: year + '-03-10', text: '연간 행과 독립적인 월 계획' }]);
      await page.locator('#apUndo button').click();
      await stored(page, (p, y) => p.rows.find(r => r.year === y)?.text === '삭제 전에 적은 연간 계획', year);
      await removeAnnual();
      await page.locator('[data-ap-entry="' + id + '"]').fill('삭제 이후 새로 쓴 월 계획');
      await stored(page, (p, id) => p.entries.find(e => e.id === id)?.text === '삭제 이후 새로 쓴 월 계획', id);
      assert.equal(await page.locator('#apUndo').isHidden(), true, 'A later monthly edit invalidates the old whole-plan undo');
      await writeYear(page, year, '삭제 이후 새로 쓴 연간 계획');
      assert.equal(await page.locator('#apUndo').isHidden(), true);
      await settings(page);
      const portable = await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return HaedoLife.AnnualPlan.exportBackup(await s.readAnnualPlan(await s.getActive())); });
      portable.plan.rows.find(r => r.year === year).text = '복원으로 적용한 연간 계획';
      async function restore() {
        await page.locator('#apImport').setInputFiles({ name: 'synthetic-undo-restore.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(portable)) });
        await page.locator('#apImportPreview').waitFor(); await page.locator('#apImportApply').click();
        await stored(page, (p, y) => p.rows.find(r => r.year === y)?.text === '복원으로 적용한 연간 계획', year);
      }
      await restore(); await page.locator('#apUndo button').click();
      await stored(page, (p, y) => p.rows.find(r => r.year === y)?.text === '삭제 이후 새로 쓴 연간 계획', year);
      assert.equal((await state(page)).plan.entries.find(e => e.id === id)?.text, '삭제 이후 새로 쓴 월 계획');
      await restore(); await writeYear(page, year, '복원 이후의 후속 입력도 보존');
      assert.equal(await page.locator('#apUndo').isHidden(), true, 'A later annual edit invalidates restore undo');
      await page.reload(); await ready(page); await page.locator('#apGrid').waitFor();
      assert.equal(await annual(page, year).inputValue(), '복원 이후의 후속 입력도 보존');
      assert.equal((await state(page)).plan.entries.find(e => e.id === id)?.text, '삭제 이후 새로 쓴 월 계획');
      await preserve(page, before);
    });

    await check('a pending restore cannot inherit a different backup selected while the current draft flushes', async ({ page }) => {
      const before = await seed(page), year = before.plan.rows[0].year;
      await writeYear(page, year, '복원 검토 전의 원래 계획'); await settings(page);
      const portable = await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return HaedoLife.AnnualPlan.exportBackup(await s.readAnnualPlan(await s.getActive())); });
      const a = structuredClone(portable), b = structuredClone(portable);
      a.plan.rows.find(r => r.year === year).text = '명시 선택한 백업 A'; b.plan.rows.find(r => r.year === year).text = '새로 선택한 백업 B';
      const select = (name, value) => page.locator('#apImport').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
      await select('synthetic-restore-a.json', a); await page.locator('#apImportPreview').waitFor(); assert.match(await page.locator('#apImportPreview').textContent(), /명시 선택한 백업 A/);
      const savedBefore = (await state(page)).plan, draft = '복원 대기 중에도 보관할 직접 입력';
      await page.evaluate(({ year, draft }) => {
        window.__holdAnnualSave = true;
        const field = document.querySelector('[data-ap-annual="' + year + '"]'), apply = document.querySelector('#apImportApply');
        if (field.disabled || !field.checkVisibility() || apply.disabled || !apply.checkVisibility()) throw Error('Explicit restore precondition is not interactable');
        // One synchronous synthetic input-and-click turn guarantees the existing
        // 350ms autosave timer cannot win before the restore's own flush starts.
        field.value = draft; field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: draft }));
        if (apply.disabled) throw Error('Restore became disabled before the explicit click'); apply.click();
      }, { year, draft });
      await wait(page, () => window.__annualSaveEntered);
      const fileDisabled = await page.locator('#apImport').isDisabled(); let cancelled = false;
      if (fileDisabled) {
        assert.equal(await page.locator('#apImport').isDisabled(), true, 'The normal file control blocks a replacement while flushing');
        if (await page.locator('#apImportCancel').isEnabled()) { await page.locator('#apImportCancel').click(); cancelled = true; }
      } else {
        await select('synthetic-restore-b.json', b); await wait(page, () => document.querySelector('#apImportPreview')?.textContent.includes('새로 선택한 백업 B'));
      }
      await page.evaluate(() => __annualSaveRelease());
      if (!fileDisabled || cancelled) {
        await wait(page, async ({ year, draft }) => { const s = HaedoLife.Shell.storage, p = await s.readAnnualPlan(await s.getActive()); return p.rows.find(r => r.year === year)?.text === draft && document.querySelector('.annual-plan')?.getAttribute('aria-busy') === 'false'; }, { year, draft });
        const flushed = (await state(page)).plan; assert.equal(flushed.revision, savedBefore.revision + 1, 'Only the explicitly edited draft was saved');
        assert.equal(await annual(page, year).inputValue(), draft, 'Neither backup inherits the earlier apply intent');
        if (!fileDisabled) { assert.match(await page.locator('#apImportPreview').textContent(), /새로 선택한 백업 B/); await page.locator('#apImportApply').click(); await stored(page, (p, y) => p.rows.find(r => r.year === y)?.text === '새로 선택한 백업 B', year); }
      } else {
        // If both file selection and cancellation are disabled, the user cannot
        // change the reviewed file. Its original explicit A action may complete.
        await stored(page, (p, y) => p.rows.find(r => r.year === y)?.text === '명시 선택한 백업 A', year);
      }
      report.restoreIntentRace = { synchronousSyntheticInputAndClick: true, delayedOriginalSave: true, replacementFileControlDisabled: fileDisabled, cancelled, differentBackupRequiresNewApply: !fileDisabled };
      await preserve(page, before);
    });

    await check('aligned twelve-month grid and keyboard focus remain usable at desktop tablet and mobile widths', async ({ page }) => {
      const before = await seed(page), year = before.plan.rows[0].year; await writeYear(page, year, '집중해서 진행할 한 해의 계획'); await annual(page, year).press('Enter'); await writeYear(page, year + 1, '다음 연도와 월의 흐름을 비교합니다');
      for (const [y, month, text] of [[year, '03', '봄 독서 계획'], [year + 1, '09', '가을 여행 계획']]) {
        const date = y + '-' + month + '-01'; await page.locator('[data-ap-add-month="' + date + '"]').click(); await page.locator('[data-ap-month="' + date + '"] [data-ap-entry]').first().fill(text);
        await stored(page, (p, a) => p.entries.some(e => e.date === a.date && e.text === a.text), { date, text });
      }
      for (const width of [1440, 820, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        const grid = page.locator('#apGrid'); await grid.evaluate(el => { el.scrollLeft = 0; }); await annual(page, year).focus();
        const audit = await page.evaluate(year => {
          const grid = document.querySelector('#apGrid'), rows = [year, year + 1].map(y => [...document.querySelectorAll('[data-ap-year="' + y + '"] [data-ap-month]')].map(el => { const r = el.getBoundingClientRect(); return { x: r.x, width: r.width }; }));
          return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, gridClientWidth: grid.clientWidth, gridScrollWidth: grid.scrollWidth, gridOverflowX: getComputedStyle(grid).overflowX, rows, hits: [...document.querySelectorAll('.annual-plan button,.annual-plan textarea,.annual-plan summary')].filter(el => el.checkVisibility()).flatMap(el => { const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2; if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) return []; for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) { const style = getComputedStyle(ancestor), rect = ancestor.getBoundingClientRect(); if (style.overflowX !== 'visible' && (x < rect.left || x >= rect.right)) return []; if (style.overflowY !== 'visible' && (y < rect.top || y >= rect.bottom)) return []; } const hit = document.elementFromPoint(x, y); return [{ control: el.id || el.dataset.apAnnual || el.getAttribute('aria-label') || el.textContent, x, y, clear: hit === el || el.contains(hit), hit: hit?.id || hit?.className || hit?.tagName }]; }), focus: document.activeElement?.dataset.apAnnual, outline: getComputedStyle(document.activeElement).outlineStyle, fontSize: parseFloat(getComputedStyle(document.activeElement).fontSize), controls: [...document.querySelectorAll('.annual-plan button,.annual-plan summary')].filter(el => el.checkVisibility()).map(el => { const r = el.getBoundingClientRect(); return { name: el.id || el.getAttribute('aria-label') || el.textContent, width: r.width, height: r.height }; }) };
        }, year);
        const file = 'annual-plan-' + width + '.png'; await page.screenshot({ path: path.join(output, file), fullPage: false }); report.visual.push({ width, file, audit });
        assert.ok(audit.documentWidth <= width, 'Only the explicit grid scrolls horizontally'); assert.equal(audit.rows[0].length, 12); assert.equal(audit.rows[1].length, 12);
        audit.rows[0].forEach((cell, n) => { assert.ok(Math.abs(cell.x - audit.rows[1][n].x) < 1); assert.ok(Math.abs(cell.width - audit.rows[1][n].width) < 1); });
        assert.equal(audit.focus, String(year)); assert.notEqual(audit.outline, 'none'); assert.ok(audit.fontSize >= 16);
        assert.ok(audit.hits.length > 0 && audit.hits.every(hit => hit.clear), 'Visible control centers are clear of navigation/overlays: ' + JSON.stringify(audit.hits.filter(hit => !hit.clear)));
        assert.ok(audit.controls.every(x => x.width >= 44 && x.height >= 44), '44px controls: ' + JSON.stringify(audit.controls.filter(x => x.width < 44 || x.height < 44)));
        if (audit.gridScrollWidth > audit.gridClientWidth) assert.ok(['auto', 'scroll'].includes(audit.gridOverflowX));
      }
      await preserve(page, before);
    });
  } finally {
    await browser.close(); report.browserClosed = true; report.sourceHashesAfter = await hashes(); report.productsUnchangedDuringRun = JSON.stringify(report.sourceHashesBefore) === JSON.stringify(report.sourceHashesAfter); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  for (const key of ['consoleErrors', 'pageErrors', 'externalRequests', 'privacyViolations', 'remoteWrites']) assert.deepEqual(report[key], [], key);
  assert.equal(report.productsUnchangedDuringRun, true); assert.ok(report.checks.length > 0 && report.checks.every(x => x.pass)); assert.equal(report.closedContexts, report.checks.length);
  console.log('Annual plan: ' + report.checks.length + ' passed; external requests and remote writes 0.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

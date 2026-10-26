/* Real local app, SDK and IndexedDB; anonymous FakeCloud Auth only.
 * Synthetic embedding cases explicitly override policy and inject vectors into
 * the real adapter. They do not evaluate model meaning or use model weights.
 * BASE_URL=http://127.0.0.1:4173 node tests/life-interest-browser.cjs */
'use strict';
const { openNewsSettings } = require('./helpers/feature-menus.cjs');
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base, openAccount } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, nav, observe } = require('./unified-home-browser.cjs');
const out = path.resolve(process.env.INTEREST_BROWSER_OUTPUT || path.join(__dirname, '../.local/interest-browser'));
const report = { createdAt: new Date().toISOString(), scope: 'Real app/SDK/IDB with anonymous Auth; synthetic vectors and policy only in designated cases. No actual model, Apple hardware, live account or deployment validation.', checks: [], visual: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [], modelRequests: [], realRemoteWrites: 0 };
const route = base + '/index.html?section=tools&view=interests';
async function open(page) { await page.goto(route); await ready(page); await page.locator('#interestManual').waitFor(); }
async function idle(page) { await page.waitForFunction(() => document.querySelector('#interestReview')?.getAttribute('aria-busy') !== 'true'); }
async function stored(page) { return page.evaluate(async () => { const s = HaedoLife.Shell.storage, id = await s.getActive(); return { profile: await s.readInterestProfile(id), bundle: await s.read(id), workbench: await s.readWorkbench(id) }; }); }
async function fixture(page) {
  await open(page);
  const result = await page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core; let b = await s.read(await s.getActive()); const refs = [];
    const texts = ['\ufeff가😀나\r\nCafe\u0301  책을 읽으며 문장의 리듬과 글을 쓰는 과정을 오래 관찰했습니다.\r\n읽은 문장을 다시 쓰고 서로 다른 표현을 비교하는 연습을 계속하고 있습니다.', '다른 사람이 적은 글에서도 책을 읽고 문장을 쓰는 과정을 살펴보았습니다.\r\n문장을 천천히 읽으며 표현을 고르고 읽은 내용을 글로 남기는 방법을 비교했습니다.'];
    for (let i = 0; i < texts.length; i++) {
      const p = await c.prepareImport({ origin: 'other', title: '익명 한글 자료 ' + i + ' — 문장의 표현과 출처를 정확히 확인하고 오래 읽는 기록', text: texts[i], authorRelation: i ? 'unknown' : 'self', author: i ? '' : '직접 작성', forceSeparate: true }, b);
      const result = await s.commitLocal({ workspaceId: b.workspaceId, baseRevision: b.revision, operationId: c.id(), changes: c.buildImportChanges(b, p, []) });
      if (result.status !== 'stored') throw new Error('Anonymous local source fixture failed');
      refs.push({ sourceId: p.source.id, versionId: p.version.id, text: texts[i] }); b = await s.read(b.workspaceId);
    }
    return { workspaceId: b.workspaceId, refs };
  }); await open(page); return result;
}
async function synthetic(context) {
  await context.route(`${base}/assets/life/interest-policy.js`, route => route.fulfill({ contentType: 'application/javascript', body: 'globalThis.HaedoLife ||= {}; HaedoLife.InterestPolicy=Object.freeze({analysisEnabled:true,reason:"SYNTHETIC UI QA ONLY",evaluation:"synthetic-ui-qa"});' }));
  await context.route(`${base}/assets/life/interest-analysis.js`, async route => {
    const response = await route.fetch(); const source = await response.text();
    const hook = `\n;(()=>{const real=HaedoLife.InterestAnalysis;HaedoLife.InterestAnalysis=Object.freeze({...real,create(options={}){window.__interestSynthetic=true;return real.create({...options,modelId:'synthetic/ui-only',modelRevision:'explicit-vector-fixture',embed:async texts=>{window.__interestMockEntered=true;if(window.__interestMockHold)await new Promise(resolve=>{window.__interestMockRelease=()=>{window.__interestMockHold=false;resolve();};});if(window.__interestMockFail)throw new Error('Synthetic inference failure');return texts.map(text=>{const index=real.TOPICS.findIndex(topic=>topic.text===text);return Array.from({length:12},(_,i)=>i===(index<0?(window.__interestMockEmpty?11:0):index)?1:0);});}});}});})();`;
    await route.fulfill({ response, body: source + hook });
  });
}
async function selectAll(page) {
  const details = page.locator('#interestSelection'); if (!await details.evaluate(el => el.open)) await details.locator(':scope > summary').click();
  for (const box of await details.locator('[data-interest-version]').all()) await box.check();
}
async function analyze(page) { await selectAll(page); await page.locator('#interestAnalyze').click(); await page.locator('#interestConfirm').waitFor(); await idle(page); }
async function abortWrites(page, enabled) {
  await page.evaluate(enabled => {
    window.__interestOriginalPut ||= IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = enabled ? function (...args) { const request = __interestOriginalPut.apply(this, args); if (this.name === 'meta' && args[0]?.key?.startsWith('interestProfile:')) this.transaction.abort(); return request; } : __interestOriginalPut;
  }, enabled);
}
async function reset(page) {
  const button = page.locator('#interestReset'); await button.evaluate(el => { el.closest('details').open = true; }); await button.click(); await idle(page);
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, run, { mock = false, width = 820 } = {}) {
    if (process.env.INTEREST_TEST_MATCH && !new RegExp(process.env.INTEREST_TEST_MATCH).test(name)) return;
    const server = new FakeCloud(), device = 'interest-' + report.checks.length;
    const context = await makeContext(browser, server, device, accounts.a, { viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width <= 820, reducedMotion: 'reduce' });
    await context.route('**/*', intercept => {
      const request = intercept.request(), url = new URL(request.url());
      if (/huggingface|xethub|onnx|transformers|\.wasm(?:$|\?)/i.test(url.href)) report.modelRequests.push({ check: name, url: url.origin + url.pathname });
      if ([new URL(base).origin, cloud].includes(url.origin)) return intercept.fallback();
      report.external.push({ check: name, origin: url.origin }); return intercept.abort('blockedbyclient');
    });
    if (mock) await synthetic(context);
    const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
    try { await run({ page, context, server, device }); assert.equal(server.writes().length, 0); report.checks.push({ name, syntheticVectors: mock, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, syntheticVectors: mock, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    await check('actual policy news settings entry, manual save reload and reset preserve source/workbench', async ({ page }) => {
      await fixture(page); const before = await stored(page); await openNewsSettings(page); await page.getByRole('button', { name: '관심 주제 편집', exact: true }).click(); await page.locator('#interestManual').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('view'), 'interests');
      await selectAll(page); assert.equal(await page.locator('#interestAnalyze').isDisabled(), true);
      await page.locator('#interestManual').fill('책의 문장과 표현\n도시에서 걷는 길'); await page.locator('#interestSaveManual').click(); await idle(page);
      let after = await stored(page); assert.deepEqual(after.profile.manual.map(x => x.label), ['책의 문장과 표현', '도시에서 걷는 길']); assert.equal(after.profile.analysis, null);
      await page.reload(); await ready(page); await page.locator('#interestManual').waitFor(); assert.equal(await page.locator('#interestManual').inputValue(), '책의 문장과 표현\n도시에서 걷는 길');
      await reset(page); after = await stored(page); assert.equal(after.profile.deleted, true); assert.equal(after.profile.manual.length, 0); assert(after.profile.revision >= 2); assert.deepEqual(after.bundle, before.bundle); assert.deepEqual(after.workbench, before.workbench);
    });
    await check('failed IDB manual save preserves typing and explicit retry succeeds', async ({ page }) => {
      await fixture(page); const before = await stored(page); await page.locator('#interestManual').fill('실패해도 유지할 관심'); await abortWrites(page, true);
      await page.locator('#interestSaveManual').click(); await page.locator('#interestError').waitFor({ state: 'visible' }); assert.equal(await page.locator('#interestManual').inputValue(), '실패해도 유지할 관심'); assert.deepEqual((await stored(page)).profile, before.profile);
      await abortWrites(page, false); await page.locator('#interestSaveManual').click(); await idle(page); assert.equal((await stored(page)).profile.manual[0].label, '실패해도 유지할 관심');
    });
    await check('two tabs CAS conflict, latest reload and tombstone reject late save', async ({ page, context }) => {
      await fixture(page); const second = await context.newPage(); observe(second, report, 'CAS second tab'); await open(second);
      await second.locator('#interestManual').fill('다른 탭의 미저장 입력'); const stale = (await stored(second)).profile;
      await page.locator('#interestManual').fill('첫 탭에서 보관'); await page.locator('#interestSaveManual').click(); await idle(page);
      await second.locator('#interestSaveManual').click(); await second.locator('#interestError').waitFor({ state: 'visible' }); assert.equal(await second.locator('#interestManual').inputValue(), '다른 탭의 미저장 입력');
      await second.locator('#interestReload').click(); await idle(second); assert.equal(await second.locator('#interestManual').inputValue(), '다른 탭의 미저장 입력');
      await reset(page); const tombstone = (await stored(page)).profile;
      const result = await second.evaluate(async stale => { const s = HaedoLife.Shell.storage, id = await s.getActive(), next = HaedoLife.InterestProfile.setManual(stale, [{ id: 'late-ui', label: '늦은 저장' }], { expectedRevision: stale.revision }); return s.saveInterestProfile(id, next, stale.revision); }, stale);
      assert.equal(result.status, 'conflict'); assert.deepEqual((await stored(page)).profile, tombstone); await second.close();
    });
    await check('workspace and account scopes isolate manual interests', async ({ page, server, device }) => {
      const fixtureData = await fixture(page); await page.locator('#interestManual').fill('첫 계정 첫 공간'); await page.locator('#interestSaveManual').click(); await idle(page);
      const otherId = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, b = await s.createWorkspace('익명 다른 공간'); await s.setActive(b.workspaceId); return b.workspaceId; });
      await open(page); assert.equal(await page.locator('#interestManual').inputValue(), ''); assert.equal((await stored(page)).profile.workspaceId, otherId);
      await page.evaluate(async id => HaedoLife.Shell.storage.setActive(id), fixtureData.workspaceId); await open(page); assert.equal(await page.locator('#interestManual').inputValue(), '첫 계정 첫 공간');
      await page.evaluate(() => { window.__interestSignout = HaedoAuth.client.auth.signOut({ scope: 'local' }); }); await page.waitForFunction(() => document.querySelector('#lifeApp').hidden && !HaedoLife.Shell.storage);
      server.oauthAccounts.set(device, accounts.b); await page.goto(base + '/login.html?next=' + encodeURIComponent('index.html?section=tools&view=interests')); await page.locator('#googleLogin').click(); await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page); await page.locator('#interestManual').waitFor();
      assert.equal(await page.locator('#interestManual').inputValue(), ''); assert.equal(await page.evaluate(async id => { try { await HaedoLife.Shell.storage.readInterestProfile(id); return false; } catch (_) { return true; } }, fixtureData.workspaceId), true);
    });
    await check('synthetic adapter exact raw evidence, reader return, manual typing and explicit confirmation', async ({ page }) => {
      await fixture(page); const before = await stored(page); await analyze(page); assert.equal(await page.evaluate(() => __interestSynthetic), true);
      const proposed = await stored(page); assert.equal(proposed.profile.analysis.model, 'synthetic/ui-only'); assert.equal(proposed.profile.confirmedIds.length, 0);
      const refs = proposed.profile.analysis.interests.flatMap(x => x.evidence); assert(refs.length >= 2);
      for (const ref of refs) { const version = before.bundle.sourceVersions.find(x => x.id === ref.sourceVersionId); assert.equal(version.contentText.slice(ref.start, ref.end), ref.quote); assert.equal(version.contentHash, ref.sha256); }
      await page.locator('#interestManual').fill('원문을 보고 돌아와 이어 쓸 관심'); const first = page.locator('[data-interest-evidence]').first(); await first.evaluate(el => { el.closest('details').open = true; });
      const focusKey = await first.getAttribute('data-focus-key'); const expected = proposed.profile.analysis.interests[0].evidence[0];
      await first.click(); await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), before.bundle.sourceVersions.find(x => x.id === expected.sourceVersionId).contentText);
      await page.getByRole('button', { name: '관심 주제 편집으로 돌아가기', exact: true }).click(); await page.locator('#interestManual').waitFor(); assert.equal(await page.locator('#interestManual').inputValue(), '원문을 보고 돌아와 이어 쓸 관심');
      await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, focusKey);
      await page.locator('[data-interest-candidate]').first().check(); await page.locator('#interestConfirm').click(); await idle(page); assert.equal((await stored(page)).profile.confirmedIds.length, 1);
      assert.deepEqual((await stored(page)).bundle, before.bundle); assert.deepEqual((await stored(page)).workbench, before.workbench);
    }, { mock: true });
    await check('synthetic inference failure and genuine empty adapter result retain manual interests', async ({ page }) => {
      await fixture(page); await page.locator('#interestManual').fill('확인한 수동 관심'); await page.locator('#interestSaveManual').click(); await idle(page);
      await selectAll(page); await page.evaluate(() => { window.__interestMockFail = true; }); await page.locator('#interestAnalyze').click(); await page.locator('#interestError').waitFor({ state: 'visible' });
      assert.equal((await stored(page)).profile.analysis, null); assert.equal(await page.locator('#interestManual').inputValue(), '확인한 수동 관심');
      await page.evaluate(() => { window.__interestMockFail = false; window.__interestMockEmpty = true; }); await page.locator('#interestAnalyze').click();
      await page.waitForFunction(() => document.querySelector('#interestReview')?.textContent.includes('반복되는 후보를 확인하지 못했습니다.')); await idle(page);
      const saved = await stored(page); assert.equal(saved.profile.analysis.interests.length, 0); assert.equal(saved.profile.manual[0].label, '확인한 수동 관심'); assert.equal(await page.locator('#interestConfirm').count(), 0);
    }, { mock: true });
    await check('regression untouched second tab latest reload cannot revert newer manual text', async ({ page, context }) => {
      await fixture(page); const second = await context.newPage(); observe(second, report, 'regression latest manual second tab'); await open(second);
      assert.equal(await second.locator('#interestManual').inputValue(), '');
      await page.locator('#interestManual').fill('다른 탭이 새로 보관한 최신 관심'); await page.locator('#interestSaveManual').click(); await idle(page);
      await second.locator('#interestReload').waitFor({ state: 'visible' }); await second.locator('#interestReload').click(); await idle(second);
      assert.equal(await second.locator('#interestManual').inputValue(), '다른 탭이 새로 보관한 최신 관심');
      await second.locator('#interestSaveManual').click(); await idle(second);
      assert.deepEqual((await stored(second)).profile.manual.map(x => x.label), ['다른 탭이 새로 보관한 최신 관심']);
      assert.equal(await second.locator('#interestManual').inputValue(), '다른 탭이 새로 보관한 최신 관심'); await second.close();
    });
    await check('regression untouched confirmation choices adopt other tab saved choices on reentry', async ({ page, context }) => {
      await fixture(page); await analyze(page); const second = await context.newPage(); observe(second, report, 'regression latest confirmations second tab'); await open(second);
      const choice = second.locator('[data-interest-candidate]').first(); assert.equal(await choice.isChecked(), false); await nav(second, 'tools');
      await page.locator('[data-interest-candidate]').first().check(); await page.locator('#interestConfirm').click(); await idle(page);
      await openNewsSettings(second); await second.getByRole('button', { name: '관심 주제 편집', exact: true }).click(); await second.locator('#interestConfirm').waitFor(); assert.equal(await choice.isChecked(), true);
      await nav(second, 'tools'); await page.locator('[data-interest-candidate]').first().uncheck(); await page.locator('#interestConfirm').click(); await idle(page);
      await openNewsSettings(second); await second.getByRole('button', { name: '관심 주제 편집', exact: true }).click(); await second.locator('#interestConfirm').waitFor(); assert.equal(await choice.isChecked(), false); assert.deepEqual((await stored(second)).profile.confirmedIds, []); await second.close();
    }, { mock: true });
    await check('regression real checkbox edits block logout workspace and external exits until confirm or revert', async ({ page }) => {
      const data = await fixture(page);
      const otherId = await page.evaluate(async id => { const s = HaedoLife.Shell.storage, other = await s.createWorkspace('선택 보호 확인용 공간'); await s.setActive(id); return other.workspaceId; }, data.workspaceId);
      await open(page); await analyze(page); const before = await stored(page); await page.locator('[data-interest-candidate]').first().check();
      await nav(page, 'tools'); await page.getByRole('link', { name: '목표', exact: false }).click(); await page.locator('#lifeError').waitFor({ state: 'visible' });
      assert.equal(new URL(page.url()).pathname, '/index.html'); assert.match(await page.locator('#lifeError').textContent(), /후보 선택|보관되지/);
      await nav(page, 'manage'); await page.locator('#lifeCurrentWorkspace').click(); await page.locator('#lifeWorkspace').selectOption(otherId); await page.locator('#lifeError').waitFor({ state: 'visible' });
      assert.equal((await stored(page)).bundle.workspaceId, data.workspaceId); assert.deepEqual((await stored(page)).profile.confirmedIds, []);
      await openAccount(page); await page.locator('#lifeLogout').click(); await page.locator('#lifeStartup[role="alert"]').waitFor({ state: 'visible' });
      assert.match(await page.locator('#lifeStartup').textContent(), /로그아웃을 완료하지 않았습니다/); assert.equal(await page.locator('#lifeApp').isVisible(), true); assert.equal(await page.evaluate(() => HaedoAuth.user.id), accounts.a.id);
      await page.locator('#lifeAccountToggle').click(); await openNewsSettings(page); await page.getByRole('button', { name: '관심 주제 편집', exact: true }).click(); await page.locator('#interestConfirm').waitFor(); assert.equal(await page.locator('[data-interest-candidate]').first().isChecked(), true);
      await page.locator('#interestConfirm').click(); await idle(page); assert.equal((await stored(page)).profile.confirmedIds.length, 1);
      await nav(page, 'tools'); await page.getByRole('link', { name: '목표', exact: false }).click(); await page.waitForURL(url => url.pathname.endsWith('/goals.html'));
      await open(page); await page.locator('[data-interest-candidate]').first().uncheck(); await nav(page, 'manage'); await page.locator('#lifeCurrentWorkspace').click(); await page.locator('#lifeWorkspace').selectOption(otherId); await page.locator('#lifeError').waitFor({ state: 'visible' }); assert.equal((await stored(page)).bundle.workspaceId, data.workspaceId);
      await openNewsSettings(page); await page.getByRole('button', { name: '관심 주제 편집', exact: true }).click(); await page.locator('#interestConfirm').waitFor(); await page.locator('#interestRevertManual').click(); await idle(page); assert.equal(await page.locator('[data-interest-candidate]').first().isChecked(), true);
      await nav(page, 'manage'); await page.locator('#lifeCurrentWorkspace').click(); await page.locator('#lifeWorkspace').selectOption(otherId); await page.waitForFunction(id => HaedoLife.Shell.storage.getActive().then(active => active === id), otherId);
      assert.deepEqual(await page.evaluate(async id => HaedoLife.Shell.storage.read(id), data.workspaceId), before.bundle);
    }, { mock: true });
    await check('synthetic late inference cancelled by navigation never saves analysis', async ({ page }) => {
      await fixture(page); await page.evaluate(() => { window.__interestMockHold = true; }); await selectAll(page); await page.locator('#interestAnalyze').click(); await page.waitForFunction(() => window.__interestMockEntered);
      await nav(page, 'tools'); await page.evaluate(() => window.__interestMockRelease()); await page.waitForTimeout(100); assert.equal((await stored(page)).profile.analysis, null);
      await openNewsSettings(page); await page.getByRole('button', { name: '관심 주제 편집', exact: true }).click(); await page.locator('#interestManual').waitFor(); assert.equal(await page.locator('#interestConfirm').count(), 0);
      await analyze(page); assert((await stored(page)).profile.analysis);
    }, { mock: true });
    for (const width of [390, 820, 1440]) await check('visual actual policy manual selection ' + width, async ({ page }) => {
      await fixture(page); await page.locator('#interestManual').fill('긴 문장과 한글 입력을 확인하는 관심 주제\n도시의 공간과 읽고 쓰는 일'); await selectAll(page);
      const audit = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, fieldFontSize: getComputedStyle(document.querySelector('#interestManual')).fontSize, buttons: [...document.querySelectorAll('#interestReview button')].filter(x => x.checkVisibility()).map(x => ({ id: x.id, width: x.getBoundingClientRect().width, height: x.getBoundingClientRect().height })) }));
      assert(audit.documentWidth <= audit.viewport, 'Horizontal overflow'); assert(parseFloat(audit.fieldFontSize) >= 16); for (const item of audit.buttons) { assert(item.width >= 44); assert(item.height >= 44); }
      const file = 'interest-manual-' + width + '.png'; await page.screenshot({ path: path.join(out, file), fullPage: true }); report.visual.push({ width, file, audit, actualPolicy: true });
    }, { width });
  } finally { await browser.close(); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(`Interest browser: ${report.checks.filter(x => x.pass).length}/${report.checks.length}; console ${report.consoleErrors.length}; page ${report.pageErrors.length}; model requests ${report.modelRequests.length}.`);
  if (report.checks.some(x => !x.pass) || report.consoleErrors.length || report.pageErrors.length || report.external.length || report.modelRequests.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

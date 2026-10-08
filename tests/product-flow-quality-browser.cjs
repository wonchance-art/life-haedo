/* Actual UI import -> exact reader -> related source -> group -> page -> reopen.
 * FLOW_PHASE=baseline BASE_URL=http://127.0.0.1:4186 captures immutable 8a6731b.
 * Anonymous Auth HTTP and isolated IndexedDB; no live cloud or Apple-device claims.
 */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, ready, shellReady, settle, nav, makeContext, observe } = require('./unified-home-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const { verifyPageBody } = require('./life-workbench-browser.cjs');
const phase = process.env.FLOW_PHASE || 'after', baseline = phase === 'baseline';
const out = path.resolve(__dirname, '../.local/product-flow-quality', phase);
const quote = '한 장을 오래 보는 편이 기억에 도움이 됐다🌱';
const comment = '전시를 많이 보는 것보다 오래 남는 한 장면을 다시 살펴보고 싶다. 창문으로 들어오던 빛과 산책길 나뭇잎의 간격을 다음 주에 비교해 보자.';
const samples = [
  { key: 'walk', origin: 'apple_notes', title: '전시를 보고 정원까지 걸으며 남겨 둔 관찰과 질문', relation: 'self', coverage: 'full_text', url: 'https://example.invalid/anonymous/garden-note', text: '토요일 오후에 작은 전시를 보고 정원으로 걸었다. 전시장 창문으로 들어오는 빛을 보다가 작품보다 주변의 공간을 오래 바라봤다.\n\n서둘러 사진을 찍을 때는 보이지 않던 나무와 빛의 간격이 천천히 걸으니 눈에 들어왔다. '+quote+'\n\n벤치에 앉아 도록의 문장을 다시 읽었다. 작품을 이해했다고 말하기보다 왜 그 장면에서 멈췄는지 적어 두고 싶었다.\n\n다음 주에는 같은 창문과 나무를 다시 찾아가려고 한다. 계절이 달라질 때 빛과 공간이 어떻게 변하는지 조금씩 비교해 보자.' },
  { key: 'photo', origin: 'instagram', title: '같은 정원 산책 사진에서 다시 발견한 빛의 간격', relation: 'self', coverage: 'partial', omissions: '사진과 댓글은 보관하지 않음', url: 'https://www.instagram.com/p/AnonymousGarden/', text: '전시를 보고 정원 산책 사진을 정리했다. 나무 사이로 들어오는 빛과 공간의 간격이 기억에 남는다. 같은 길도 오래 멈춰서 보는 시간에 따라 달라진다. 다음 주 같은 나무를 다시 찾아가고 싶다.' },
  { key: 'link', origin: 'naver_blog', title: '다음 주 박물관 관람 전에 확인할 개관 시간과 안내', relation: 'unknown', text: null, url: 'https://blog.naver.com/anonymous_fixture/222000000013' }
];
const snapshot = page => page.evaluate(async () => { const s = HaedoLife.Shell.storage, id = await s.getActive(); return { bundle: await s.read(id), workbench: await s.readWorkbench(id) }; });
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function poll(page, predicate) {
  let state;
  for (let i = 0; i < 100; i++) { state = await snapshot(page); if (predicate(state)) return state; await page.waitForTimeout(80); }
  throw new Error('Expected persisted UI result did not arrive');
}
async function records(page) { await page.goto(base + '/index.html?section=records'); await ready(page); await settle(page); await page.locator('#lifeSearch').waitFor(); }
async function filter(page) { if (await page.locator('#lifeFilterToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#lifeFilterToggle').click(); }
async function importUI(page, sample, index, capture) {
  await page.getByRole('button', { name: '가져오기', exact: true }).click(); await page.locator('#lifeImportTitle').waitFor();
  await page.locator('#lifeImportOrigin').selectOption(sample.origin); await page.locator('#lifeImportTitle').fill(sample.title);
  if (sample.url) await page.locator('#lifeImportUrl').fill(sample.url);
  if (sample.text === null) await page.locator('#lifeImportMethodLink').click(); else await page.locator('#lifeImportText').fill(sample.text);
  await page.locator('details').filter({ has: page.locator('#lifeImportRelation') }).locator(':scope > summary').click();
  await page.locator('#lifeImportRelation').selectOption(sample.relation);
  if (sample.text !== null) await page.locator('#lifeImportCoverage').selectOption(sample.coverage);
  if (sample.omissions) await page.locator('#lifeImportOmissions').fill(sample.omissions);
  if (index === 0) await capture('import-filled');
  await page.getByRole('button', { name: '원문·출처 확인', exact: true }).click(); await settle(page);
  const sameSource = page.getByRole('button', { name: '같은 자료로 확인 · 버전 비교', exact: true });
  if (index === 3) assert.equal(await sameSource.isVisible(), true, 'A revised original must explicitly identify its existing source in review');
  if (await sameSource.isVisible()) { await sameSource.click(); await settle(page); }
  if (index === 0) {
    await page.locator('#lifeReviewText').evaluate((el, quote) => { const start = el.value.indexOf(quote); assertFixture(start); el.focus(); el.setSelectionRange(start, start + quote.length); el.dispatchEvent(new Event('select', { bubbles: true })); function assertFixture(start) { if (start < 0) throw new Error('Anonymous quote missing'); } }, quote);
    await page.locator('#lifeExcerptTopic').fill('빛과 공간'); await page.locator('#lifeExcerptNote').fill('전시와 산책에서 비슷하게 멈춘 이유');
    await page.getByRole('button', { name: '발췌 후보 추가', exact: true }).click(); await capture('import-review');
    await page.getByRole('button', { name: '선택한 발췌 모음에 반영', exact: true }).click();
  } else await page.getByRole('button', { name: '자료만 보관', exact: true }).click();
  const matches = state => state.bundle.sourceVersions.find(version => version.contentText === sample.text && state.bundle.sources.some(source => source.id === version.sourceId && source.title === sample.title));
  const state = await poll(page, matches); await settle(page); await frames(page);
  const version = matches(state), source = state.bundle.sources.find(source => source.id === version.sourceId);
  assert.equal(version.contentText, sample.text); if (sample.text !== null) assert.equal(version.coverage.status, sample.coverage); else assert.equal(version.coverage.status, 'link_only');
  if (sample.omissions) assert(version.coverage.omissions.includes(sample.omissions));
  if (index === 0) await capture('import-saved-filtered');
  return { sourceId: source.id, versionId: version.id };
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { phase, base, createdAt: new Date().toISOString(), browser: browser.version(), scope: 'Actual UI, SDK and isolated IndexedDB with anonymous Auth HTTP; Linux Chromium viewport/touch simulation only', checks: [], observations: [], visual: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [], realRemoteWrites: 0 };
  async function capture(page, scene, size) {
    await page.evaluate(() => document.fonts.ready); await page.evaluate(() => { document.activeElement?.blur(); scrollTo({ top: 0, behavior: 'instant' }); for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); });
    const metrics = await page.evaluate(inspect); metrics.smallTargets = metrics.smallTargets.filter(item => item.id !== 'lifeSourceText');
    const file = `${scene}-${size.width}.png`; await page.screenshot({ path: path.join(out, file) }); report.visual.push({ scene, file, ...metrics });
    if (!baseline) { assert.equal(metrics.horizontalOverflow, false); for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ': ' + key); }
  }
  try {
    for (const size of [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }]) {
      if (process.env.PRODUCT_FLOW_MATCH && !String(size.width).includes(process.env.PRODUCT_FLOW_MATCH)) continue;
      const server = new FakeCloud(), context = await makeContext(browser, server, 'product-flow-' + size.width, accounts.a, { viewport: size, hasTouch: size.width <= 820 }), page = await context.newPage();
      page.setDefaultTimeout(12000); observe(page, report, String(size.width));
      await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback(); report.external.push({ origin: u.origin, path: u.pathname }); return route.abort('blockedbyclient'); });
      const shot = scene => capture(page, scene, size);
      try {
        await records(page); await page.locator('#lifeSearch').fill('아직 없는 다른 날의 기록'); await filter(page); await page.locator('#lifeOriginFilter').selectOption('obsidian');
        const refs = {}; refs.walk = await importUI(page, samples[0], 0, shot);
        const postSave = { width: size.width, mode: await page.locator('#lifeMain').getAttribute('data-mode'), visibleResults: await page.locator('.life-source-card').count(), directSavedRead: await page.locator('#lifeImportResultOpen').isVisible().catch(() => false) };
        report.observations.push({ scenario: 'filtered import completion', ...postSave });
        if (!baseline) assert.equal(postSave.directSavedRead, true, 'A filtered import must offer its exact saved version without resetting search');
        if (postSave.directSavedRead) {
          await page.locator('#lifeImportResultOpen').click(); await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), samples[0].text); await shot('saved-original-reading');
          await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeSearch').waitFor(); await frames(page);
          assert.equal(await page.locator('#lifeSearch').inputValue(), '아직 없는 다른 날의 기록'); assert.equal(await page.locator('#lifeOriginFilter').inputValue(), 'obsidian');
          assert.equal(await page.locator('#lifeImportResultOpen').evaluate(el => el === document.activeElement), true, 'Back must return to the exact saved-result action in its filtered feed');
        }
        for (const [index, sample] of samples.entries()) {
          if (!index) continue;
          await records(page); refs[sample.key] = await importUI(page, sample, index, shot);
        }
        await records(page); await page.locator('#lifeSearch').fill(''); await filter(page); await page.locator('#lifeOriginFilter').selectOption('');
        await page.locator(`.life-source-open[data-version-id="${refs.walk.versionId}"]`).click(); await page.locator('#lifeSourceText').waitFor(); await shot('original-reading');
        const sourceBundle = (await snapshot(page)).bundle, record = sourceBundle.records[0];
        assert.equal(record.text, quote); assert.deepEqual(record.sourceRefs[0], { sourceId: refs.walk.sourceId, sourceVersionId: refs.walk.versionId, locator: { start: samples[0].text.indexOf(quote), end: samples[0].text.indexOf(quote) + quote.length } });
        await page.locator('#lifeReaderRelated').click(); await page.locator('#wbDiscoverySeed').waitFor(); assert.equal(await page.locator('#wbDiscoverySeed').getAttribute('data-version-id'), refs.walk.versionId); await shot('related-records');
        const related = page.locator(`.wb-discovery-result[data-version-id="${refs.photo.versionId}"]`); await related.getByRole('button', { name: '이 원문 버전 열기', exact: true }).click(); await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), samples[1].text);
        await page.getByRole('button', { name: '관련 기록으로 돌아가기', exact: true }).click(); await page.locator('#wbDiscoverySeed').waitFor(); await related.locator('.wb-discovery-arrange').click(); await page.locator('#wbIncomingSelection').waitFor();
        assert.deepEqual(await page.locator('#wbIncomingSelection input[data-version-id]:checked').evaluateAll(nodes => nodes.map(node => node.dataset.versionId)), [refs.walk.versionId, refs.photo.versionId]);
        await page.locator('#wbIncomingTitle').fill('전시와 산책에서 함께 남긴 빛과 공간'); await page.locator('#wbIncomingApply').click(); await poll(page, state => state.workbench.groups.length === 1);
        await page.locator('article[data-group-id]').first().getByRole('button', { name: '이 묶음을 내 페이지에 추가', exact: true }).click(); await poll(page, state => state.workbench.page.entries.length === 1);
        await page.getByRole('button', { name: '내 페이지', exact: true }).click(); await page.locator('.wb-page-entry').waitFor();
        const entry = page.locator('.wb-page-entry').first(), entryId = await entry.getAttribute('data-entry-id'); await entry.locator('.wb-page-entry-edit > summary').click();
        await entry.getByLabel('내 코멘트', { exact: true }).fill(comment); await poll(page, state => state.workbench.page.entries[0].note === comment);
        await entry.locator(`[data-part-version-id="${refs.photo.versionId}"] input[type=checkbox]`).uncheck(); await poll(page, state => state.workbench.page.entries[0].parts[1].enabled === false); await shot('page-edited');
        await page.locator('#wbPagePreview').click(); await page.locator('#wbVisitor').waitFor();
        const visitor = await page.locator('#wbVisitor').textContent();
        if (baseline) assert(visitor.includes(samples[0].text));
        else await verifyPageBody(page.locator(`#wbVisitor [data-version-id="${refs.walk.versionId}"]`), samples[0].text, { folded: true });
        assert(visitor.includes(comment)); assert(!visitor.includes(samples[1].text));
        assert.equal(await page.locator(`#wbVisitor [data-version-id="${refs.photo.versionId}"]`).count(), 0, 'A disabled source must be absent from the private preview');
        await shot('page-preview');
        await page.locator('#wbPagePreview').click(); await page.locator('.wb-page-entry-edit > summary').waitFor();
        const editorOpenAfterPreview = await entry.locator('.wb-page-entry-edit').evaluate(el => el.open); report.observations.push({ scenario: 'page edit after preview', width: size.width, editorOpenAfterPreview });
        if (!baseline) assert.equal(editorOpenAfterPreview, true, 'Returning from preview must retain the editing context');
        await page.reload(); await ready(page); await page.locator(`.wb-page-entry[data-entry-id="${entryId}"]`).waitFor(); const reloaded = await snapshot(page); assert.deepEqual(reloaded.bundle, sourceBundle); assert.equal(reloaded.workbench.page.entries[0].note, comment); assert.equal(reloaded.workbench.page.entries[0].parts[1].enabled, false);
        const changedMarker = '수정본에만 남긴 다음 달 여행 계획';
        await records(page); const revised = await importUI(page, { ...samples[0], text: samples[0].text + '\n\n' + changedMarker }, 3, shot);
        assert.equal(revised.sourceId, refs.walk.sourceId); assert.notEqual(revised.versionId, refs.walk.versionId);
        const revisedState = await snapshot(page); assert.deepEqual(revisedState.bundle.records, sourceBundle.records); assert.deepEqual(revisedState.bundle.sourceVersions.find(version => version.id === refs.walk.versionId), sourceBundle.sourceVersions.find(version => version.id === refs.walk.versionId));
        await page.goto(base + '/index.html?section=records&view=page'); await ready(page); await page.locator(`.wb-page-entry[data-entry-id="${entryId}"]`).waitFor();
        assert.equal((await snapshot(page)).workbench.page.entries[0].parts[0].versionId, refs.walk.versionId);
        await page.locator('#wbPagePreview').click(); await page.locator('#wbVisitor').waitFor();
        if (baseline) assert((await page.locator('#wbVisitor').textContent()).includes(samples[0].text));
        else await verifyPageBody(page.locator(`#wbVisitor [data-version-id="${refs.walk.versionId}"]`), samples[0].text, { folded: true });
        assert((await page.locator('#wbVisitor').textContent()).includes(comment)); await shot('page-reopened');
        assert(!(await page.locator('#wbVisitor').textContent()).includes(changedMarker), 'A page copy must keep its selected old version after a newer original is imported');
        const publicContext = await makeContext(browser, server, 'anonymous-preview-' + size.width, null, { viewport: size, hasTouch: size.width <= 820 }), publicPage = await publicContext.newPage(); observe(publicPage, report, 'anonymous private preview ' + size.width);
        try { await publicPage.goto(base + '/index.html?section=records&view=page'); await shellReady(publicPage); assert.equal(await publicPage.locator('#lifeApp').isHidden(), true); assert.equal(await publicPage.locator('#wbVisitor').count(), 0); assert.deepEqual(await publicPage.evaluate(() => __homeDbOpens), []); }
        finally { await publicContext.close(); }
        await page.evaluate(() => { window.__productFlowLogout = HaedoAuth.client.auth.signOut({ scope: 'local' }); }); await page.waitForFunction(() => document.querySelector('#lifeApp').hidden && !HaedoLife.Shell.storage);
        assert.equal(await page.locator('#wbVisitor').count(), 0, 'Logout must remove the private preview surface');
        server.oauthAccounts.set('product-flow-' + size.width, accounts.b); await page.locator('[data-life-login]').click(); await page.locator('#googleLogin').click(); await page.waitForURL(u => u.pathname.endsWith('/index.html')); await ready(page);
        await page.goto(base + '/index.html?section=records&view=page'); await ready(page); await page.locator('.life-workbench[data-mode="page"]').waitFor(); assert.equal((await snapshot(page)).workbench.page.entries.length, 0); assert(!(await page.locator('body').textContent()).includes(comment));
        report.observations.push({ scenario: 'crossflow preservation and privacy', width: size.width, exactOldPageVersionAfterNewImport: true, oldExcerptUnchanged: true, anonymousPrivateStorageNeverOpened: true, logoutRemovedPreview: true, nextAccountPageEmpty: true });
        assert.equal(server.writes().length, 0); report.checks.push({ name: 'actual crossflow ' + size.width, pass: true }); console.log('PASS crossflow ' + size.width);
      } catch (error) { report.checks.push({ name: 'actual crossflow ' + size.width, pass: false, error: error.stack }); console.error('FAIL ' + size.width + '\n' + error.stack); await page.screenshot({ path: path.join(out, 'failure-' + size.width + '.png'), fullPage: true }).catch(() => {}); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(`Product crossflow: ${report.checks.filter(c => c.pass).length}/${report.checks.length}; ${report.visual.length} captures; console ${report.consoleErrors.length}; page ${report.pageErrors.length}.`);
  if (report.checks.some(c => !c.pass) || report.consoleErrors.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

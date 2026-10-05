/* Local rediscovery journeys: real app/SDK/IndexedDB, anonymous intercepted
 * Auth HTTP only. BASE_URL=http://127.0.0.1:4184 node tests/life-rediscovery-browser.cjs
 * No production DB/SNS or Apple hardware/IME claims. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, observe, nav } = require('./unified-home-browser.cjs');
const { current, abortWorkbenchWrites, go } = require('./life-workbench-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const out = path.resolve(__dirname, '../.local/rediscovery');
const evidence = path.resolve(__dirname, '../docs/design-review/evidence');
const longTitle = '정원 산책 중 작은 나무의 그림자와 빛을 따라 걷다가 떠오른 질문 — 오래전에 읽은 문장과 오늘의 관찰을 천천히 이어 보는 한글 기록';
const seedOld = '처음 정원에서 남긴 기록🌱\n정원 산책 관찰 빛 나무. 잎사귀를 오래 바라보니 걷는 속도도 달라졌다.\n다음에는 무엇을 더 자세히 볼 수 있을까?';
const seedNew = '최신 버전에서는 여행 예산과 기차표 예약을 정리했다. 이전 정원 구절을 대체해서 보여 주면 안 된다.';

async function instrument(context) {
  await context.route(`${base}/assets/life/storage.js`, async route => {
    const response = await route.fetch(), source = await response.text();
    const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async readWorkbench(...args){const value=await actual.readWorkbench(...args);if(window.__rediscoveryReadFailure)throw new Error('검사용 구성 읽기 실패');if(window.__rediscoveryHoldRead){window.__rediscoveryReadEntered=true;await new Promise(resolve=>{window.__rediscoveryReleaseRead=()=>{window.__rediscoveryHoldRead=false;resolve();};});}window.__rediscoveryReadFinished=(window.__rediscoveryReadFinished||0)+1;return value;}});}});})();`;
    await route.fulfill({ response, body: source + hook });
  });
}
async function fixture(page, many = false) {
  await page.goto(base + '/index.html?section=tools'); await ready(page);
  return page.evaluate(async ({ longTitle, seedOld, seedNew, many }) => {
    const storage = HaedoLife.Shell.storage, core = HaedoLife.Core;
    let bundle = await storage.read(await storage.getActive());
    const refs = {};
    async function add(key, input) {
      const prepared = await core.prepareImport({ forceSeparate: true, ...input }, bundle);
      const result = await storage.commitLocal({ workspaceId: bundle.workspaceId, baseRevision: bundle.revision, operationId: core.id(), changes: core.buildImportChanges(bundle, prepared) });
      if (result.status !== 'stored') throw new Error('Rediscovery source fixture rejected');
      refs[key] = { sourceId: prepared.source.id, versionId: prepared.version.id, text: prepared.version.contentText, title: prepared.source.title };
      bundle = await storage.read(bundle.workspaceId);
    }
    await add('seed', { origin: 'apple_notes', title: longTitle, text: seedOld, authorRelation: 'self' });
    await add('topic', { origin: 'obsidian', title: '정원 산책 뒤 책에서 찾아 본 초록 잎의 구조', text: '초록 잎을 통해 계절을 다시 읽는 방법을 정리했다. 관찰 일기를 다시 펼쳐 보고 싶다.' });
    await add('group', { origin: 'naver_blog', title: '정원 산책을 함께한 날의 사진과 길', text: '함께 걷던 길을 사진 한 장으로 남겼다. 서두르지 않고 볼 때의 경험을 생각한다.', url: 'https://blog.naver.com/anonymous_fixture/222000000001' });
    await add('term', { origin: 'instagram', title: '정원 산책 사진에서 찾은 빛과 그림자', text: '정원 산책 관찰 빛 나무. 오래 걸은 뒤 사진에서 작은 차이를 발견했다.', coverage: { status: 'partial', omissions: ['사진·댓글 미보관'] }, url: 'https://www.instagram.com/p/AnonymousGarden/' });
    await add('unrelated', { origin: 'other', title: '클래식 음악 감상과 연주회 일정', text: '첼로 협주곡의 연주 시간과 좌석 번호를 확인한다.' });
    await add('stale', { origin: 'other', title: '해변 운동 호흡', text: '이전 버전에서만 정원 산책을 이야기한다.' });
    const staleOld = { ...refs.stale };
    await add('staleLatest', { origin: 'other', title: '해변 운동 호흡', text: '수영 호흡 자세를 메모하고 다음 연습 시간을 적었다.', existingSourceId: refs.stale.sourceId, forceSeparate: false });
    await add('link', { origin: 'other', title: '천문대 방문 예약 주소', text: null, url: 'https://example.invalid/observatory', coverage: { status: 'link_only', omissions: ['본문 미확보'] } });
    await add('seedLatest', { origin: 'apple_notes', title: longTitle, text: seedNew, existingSourceId: refs.seed.sourceId, forceSeparate: false });
    if (many) for (let index = 0; index < 24; index++) await add('extra' + index, { origin: 'other', title: '연습 일정과 악보 ' + index, text: '음악 연습 순서 ' + index + '와 연주회 일정만 담은 무관한 기록.' });
    const records = [refs.seed, refs.topic, staleOld].map(ref => {
      const text = ref.text.slice(0, 8), now = new Date().toISOString();
      return { id: core.id(), kind: 'excerpt', text, topic: '정원 관찰', note: '', sourceRefs: [{ sourceId: ref.sourceId, sourceVersionId: ref.versionId, locator: { start: 0, end: text.length } }], provenance: { kind: 'user' }, revision: 1, createdAt: now, updatedAt: now };
    });
    const saved = await storage.commitLocal({ workspaceId: bundle.workspaceId, baseRevision: bundle.revision, operationId: core.id(), changes: { put: { records } } });
    if (saved.status !== 'stored') throw new Error('Rediscovery exact-version topic fixture rejected');
    const workbench = await storage.readWorkbench(bundle.workspaceId), groupId = core.id();
    workbench.groups.push({ id: groupId, title: '지난 봄 정원 산책', versionIds: [refs.seed.versionId, refs.group.versionId] });
    await storage.saveWorkbench(bundle.workspaceId, workbench, workbench.revision);
    return { workspaceId: bundle.workspaceId, refs, groupId };
  }, { longTitle, seedOld, seedNew, many });
}
async function discover(page) { await go(page, 'discover'); await page.locator('#wbDiscoverQuery').waitFor(); }
async function pick(page, ref, query = '처음 정원에서') {
  const chooser = page.locator('#wbDiscoveryChooser');
  if (await chooser.count() && !await chooser.evaluate(el => el.open)) await chooser.locator('summary').click();
  await page.locator('#wbDiscoverQuery').fill(query);
  await page.locator('.wb-discovery-select[data-version-id="' + ref.versionId + '"]').click();
  await page.locator('#wbDiscoverySeed[data-version-id="' + ref.versionId + '"]').waitFor();
}
const candidates = page => page.locator('#wbDiscoveryRelated .wb-discovery-result');
async function saved(page) { await page.locator('#wbStatus[data-state="saved"]').waitFor(); return current(page); }
async function excluded(page, sourceId) {
  const details = page.locator('#wbDiscoveryExcluded');
  if (!await details.evaluate(el => el.open)) await details.locator('summary').click();
  return page.locator('.wb-discovery-restore[data-source-id="' + sourceId + '"]');
}
async function main() {
  await fs.mkdir(out, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), browser: browser.version(), scope: 'Actual local app/SDK/IndexedDB; anonymous HTTP interception; browser size/touch only', checks: [], visual: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [], productionWrites: 0 };
  async function check(name, run, options = {}) {
    if (process.env.REDISCOVERY_TEST_MATCH && !new RegExp(process.env.REDISCOVERY_TEST_MATCH).test(name)) return;
    const server = new FakeCloud(), device = 'rediscovery-' + report.checks.length, context = await makeContext(browser, server, device, accounts.a, options), page = await context.newPage();
    page.setDefaultTimeout(12000); observe(page, report, name); await instrument(context);
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push({ origin: url.origin, path: url.pathname }); return route.abort('blockedbyclient'); });
    try { await run({ page, context, server, device }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  async function capture(page, scene, size, publish = false) {
    if (process.env.REDISCOVERY_VISUAL_SCENES && !process.env.REDISCOVERY_VISUAL_SCENES.split(',').includes(scene)) return;
    await page.evaluate(() => document.fonts.ready); await page.evaluate(() => { document.activeElement?.blur(); scrollTo({ top: 0, behavior: 'instant' }); });
    const metrics = await page.evaluate(inspect), file = scene + '-' + size.width + '.png';
    await page.screenshot({ path: path.join(out, file), fullPage: scene !== 'related' });
    if (publish) await fs.copyFile(path.join(out, file), path.join(evidence, 'rediscovery-' + size.width + '.png'));
    report.visual.push({ scene, file, ...metrics });
    assert(!metrics.horizontalOverflow, scene + ' horizontal overflow');
    for (const field of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[field], [], scene + ' ' + field);
  }
  try {
    await check('past-version seed shows three explained latest-source candidates and keeps storage unchanged', async ({ page, server }) => {
      const f = await fixture(page), before = await current(page); await page.reload(); await ready(page); await nav(page, 'tools'); await page.getByRole('button', { name: '다시 찾기', exact: true }).click(); await pick(page, f.refs.seed);
      assert.deepEqual(new Set(await candidates(page).evaluateAll(rows => rows.map(row => row.dataset.versionId))), new Set(['topic', 'group', 'term'].map(key => f.refs[key].versionId)));
      for (const key of ['topic', 'group', 'term']) {
        const card = page.locator('.wb-discovery-result[data-version-id="' + f.refs[key].versionId + '"]'); assert((await card.locator('.wb-discovery-reasons').textContent()).trim().length > 0);
      }
      assert.equal(await page.locator('.wb-discovery-result[data-source-id="' + f.refs.stale.sourceId + '"]').count(), 0);
      assert.equal(await page.locator('.wb-discovery-result[data-source-id="' + f.refs.unrelated.sourceId + '"]').count(), 0);
      assert.deepEqual(await current(page), before); assert.equal(server.requests.length, 0);
      await page.locator('#wbDiscoverySeed').getByRole('button', { name: '이 원문 버전 열기', exact: true }).click(); await settle(page);
      assert.equal(await page.locator('#lifeSourceText').textContent(), seedOld);
      await page.getByRole('button', { name: '다시 찾기로 돌아가기', exact: true }).click(); await settle(page);
      assert.equal(await page.locator('#wbDiscoverySeed').getAttribute('data-version-id'), f.refs.seed.versionId);
      const card = page.locator('.wb-discovery-result[data-version-id="' + f.refs.term.versionId + '"]'); await card.getByRole('button', { name: '이 원문 버전 열기', exact: true }).click(); await settle(page);
      assert.equal(await page.locator('#lifeSourceText').textContent(), f.refs.term.text);
    });
    await check('directional exclusion survives reload, stays source-scoped and explicit restore returns the candidate', async ({ page }) => {
      const f = await fixture(page); await discover(page); await pick(page, f.refs.seed);
      await page.locator('.wb-discovery-exclude[data-source-id="' + f.refs.topic.sourceId + '"]').click(); const before = await saved(page);
      assert.deepEqual(before.workbench.discovery.excludedPairs, [{ seedSourceId: f.refs.seed.sourceId, candidateSourceId: f.refs.topic.sourceId }]);
      await discover(page); await pick(page, f.refs.seed); assert.equal(await page.locator('.wb-discovery-result[data-source-id="' + f.refs.topic.sourceId + '"]').count(), 0);
      await pick(page, f.refs.topic, '초록 잎의 구조'); assert(await page.locator('.wb-discovery-result[data-source-id="' + f.refs.seed.sourceId + '"]').count());
      await pick(page, f.refs.seed, '처음 정원에서'); await (await excluded(page, f.refs.topic.sourceId)).click(); const restored = await saved(page);
      assert.deepEqual(restored.workbench.discovery.excludedPairs, []); assert.equal(await page.locator('.wb-discovery-result[data-source-id="' + f.refs.topic.sourceId + '"]').count(), 1); assert.deepEqual(restored.bundle, before.bundle);
    });
    await check('related record enters explicit group review with exact versions; cancellation writes nothing', async ({ page }) => {
      const f = await fixture(page); await discover(page); await pick(page, f.refs.seed); const before = await current(page);
      await page.locator('.wb-discovery-result[data-version-id="' + f.refs.group.versionId + '"] .wb-discovery-arrange').click(); await page.locator('#wbIncomingSelection').waitFor();
      assert.deepEqual(await current(page), before);
      const selected = await page.locator('#wbIncomingSelection input[data-version-id]:checked').evaluateAll(nodes => nodes.map(node => node.dataset.versionId));
      assert(selected.includes(f.refs.group.versionId)); assert(!selected.includes(f.refs.seedLatest.versionId));
      await page.locator('#wbIncomingCancel').click(); await page.locator('#wbDiscoverySeed').waitFor(); assert.deepEqual(await current(page), before);
      await page.locator('.wb-discovery-result[data-version-id="' + f.refs.group.versionId + '"] .wb-discovery-arrange').click(); await page.locator('#wbIncomingTitle').fill('다시 찾은 정원 기록'); await page.locator('#wbIncomingApply').click();
      const after = await saved(page), group = after.workbench.groups.find(group => group.title === '다시 찾은 정원 기록'); assert(group); assert.deepEqual(group.versionIds, selected); assert.deepEqual(after.bundle, before.bundle);
    });
    await check('failed exclusion save preserves pending change and blocks navigation until explicit retry', async ({ page }) => {
      const f = await fixture(page); await discover(page); await pick(page, f.refs.seed); const before = await current(page); await abortWorkbenchWrites(page, true);
      await page.locator('.wb-discovery-exclude[data-source-id="' + f.refs.topic.sourceId + '"]').click(); await page.locator('#wbError').waitFor({ state: 'visible' }); assert.deepEqual(await current(page), before);
      await page.locator('[data-haedo-section="records"]').click(); await page.locator('#lifeError').waitFor({ state: 'visible' }); assert(await page.locator('#wbDiscoverySeed').isVisible());
      await abortWorkbenchWrites(page, false); await page.getByRole('button', { name: '다시 저장', exact: true }).click(); const after = await saved(page); assert.equal(after.workbench.discovery.excludedPairs.length, 1); assert.deepEqual(after.bundle, before.bundle);
    });
    await check('source exclusions travel only in composition backup and restore with remapped source identities', async ({ page }) => {
      const f = await fixture(page); await discover(page); await pick(page, f.refs.seed); await page.locator('.wb-discovery-exclude[data-source-id="' + f.refs.topic.sourceId + '"]').click(); const before = await saved(page);
      await go(page, 'workbench-backup'); const download = page.waitForEvent('download'); await page.locator('#wbBackupDownload').click(); const file = JSON.parse(await fs.readFile(await (await download).path(), 'utf8'));
      await page.locator('#wbRestoreFile').setInputFiles({ name: '재발견-제외-새사본.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) }); await page.locator('#wbRestoreInstall').click(); await settle(page);
      const restored = await current(page); assert.notEqual(restored.bundle.workspaceId, before.bundle.workspaceId); const seed = restored.bundle.sourceVersions.find(version => version.contentText === seedOld), topic = restored.bundle.sourceVersions.find(version => version.contentText === f.refs.topic.text);
      assert.notEqual(seed.sourceId, f.refs.seed.sourceId); assert.deepEqual(restored.workbench.discovery.excludedPairs, [{ seedSourceId: seed.sourceId, candidateSourceId: topic.sourceId }]); assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), f.workspaceId), before.bundle); assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.readWorkbench(id), f.workspaceId), before.workbench);
      await discover(page); await pick(page, { versionId: seed.id }); assert.equal(await page.locator('.wb-discovery-result[data-source-id="' + topic.sourceId + '"]').count(), 0);
    });
    await check('keyboard, Korean search events and touch preserve exact seed and return focus', async ({ page }) => {
      const f = await fixture(page); await discover(page);
      assert.equal(await page.locator('.wb-discovery-select[data-version-id="' + f.refs.seed.versionId + '"]').count(), 0);
      await page.locator('#wbDiscoverQuery').evaluate(el => { el.focus(); el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); el.value = '처음 정원에서'; el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true })); });
      assert.equal(await page.locator('.wb-discovery-select[data-version-id="' + f.refs.seed.versionId + '"]').count(), 0);
      await page.locator('#wbDiscoverQuery').evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
      const choose = page.locator('.wb-discovery-select[data-version-id="' + f.refs.seed.versionId + '"]'); await choose.focus(); await page.keyboard.press('Enter'); await page.locator('#wbDiscoverySeed').waitFor();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'wbDiscoverySeed');
      const book = page.locator('.wb-discovery-result[data-version-id="' + f.refs.term.versionId + '"]').getByRole('button', { name: '이 원문 버전 열기', exact: true }); await book.focus();
      const tooltip = book.locator('.life-tooltip'); await tooltip.waitFor({ state: 'visible' });
      const tooltipBounds = await tooltip.evaluate(el => { const rect = el.getBoundingClientRect(), dock = document.querySelector('[data-haedo-navigation]').getBoundingClientRect(); return { viewportWidth: innerWidth, viewportHeight: innerHeight, documentWidth: document.documentElement.scrollWidth, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, overlapsDock: rect.left < dock.right && rect.right > dock.left && rect.top < dock.bottom && rect.bottom > dock.top, visible: getComputedStyle(el).display !== 'none' && rect.width > 0 }; });
      assert.equal(tooltipBounds.visible, true); assert(tooltipBounds.left >= 0 && tooltipBounds.right <= tooltipBounds.viewportWidth, 'Focused source tooltip escaped the 390px viewport'); assert(tooltipBounds.documentWidth <= tooltipBounds.viewportWidth, 'Focused source tooltip caused document overflow'); assert.equal(tooltipBounds.overlapsDock, false, 'Focused source tooltip overlaps the bottom navigation'); assert(tooltipBounds.top >= 0 && tooltipBounds.bottom <= tooltipBounds.viewportHeight, 'Focused source tooltip escaped viewport height'); report.focusedTooltip = tooltipBounds;
      await page.screenshot({ path: path.join(out, 'focused-tooltip-390.png') });
      await page.keyboard.press('Enter'); await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), f.refs.term.text);
      await page.getByRole('button', { name: '다시 찾기로 돌아가기', exact: true }).click(); await page.locator('#wbDiscoverySeed').waitFor();
      assert.equal(await page.evaluate(() => document.activeElement.dataset.focusKey), 'discover:related:' + f.refs.term.versionId);
      await page.locator('.wb-discovery-exclude[data-source-id="' + f.refs.topic.sourceId + '"]').tap(); await saved(page); await page.locator('#wbDiscoveryExcluded > summary').tap(); await page.locator('.wb-discovery-restore[data-source-id="' + f.refs.topic.sourceId + '"]').tap(); await saved(page);
      const arrange = page.locator('#wbDiscoveryArrange-' + f.refs.term.versionId); await arrange.focus(); await page.keyboard.press('Escape'); assert.equal(await arrange.getAttribute('data-tooltip-dismissed'), 'true'); await page.keyboard.press('Enter'); await page.locator('#wbIncomingSelection').waitFor(); await page.locator('#wbIncomingCancel').click(); await page.locator('#wbDiscoverySeed').waitFor(); assert.equal(await page.evaluate(() => document.activeElement.id), 'wbDiscoveryArrange-' + f.refs.term.versionId);
    }, { viewport: { width: 390, height: 844 }, hasTouch: true });
    await check('account switch exposes neither former seed nor exclusions', async ({ page, server, device }) => {
      const f = await fixture(page); await discover(page); await pick(page, f.refs.seed); await page.locator('.wb-discovery-exclude[data-source-id="' + f.refs.topic.sourceId + '"]').click(); await saved(page);
      await page.evaluate(() => { window.__rediscoverySignout = HaedoAuth.client.auth.signOut({ scope: 'local' }); }); await page.waitForFunction(() => document.querySelector('#lifeApp').hidden && !HaedoLife.Shell.storage); server.oauthAccounts.set(device, accounts.b); await page.locator('[data-life-login]').click(); await page.locator('#googleLogin').click(); await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page);
      await discover(page); assert.equal(await page.locator('#wbDiscoverySeed').count(), 0); assert.equal(await candidates(page).count(), 0); const next = await current(page); assert.equal(next.bundle.sources.length, 0); assert.deepEqual(next.workbench.discovery?.excludedPairs || [], []);
      assert.equal(await page.evaluate(async id => { try { await HaedoLife.Shell.storage.readWorkbench(id); return false; } catch (_) { return true; } }, f.workspaceId), true);
    });
    for (const size of [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }]) await check('visual related empty loading and read error ' + size.width, async ({ page }) => {
      await discover(page); await capture(page, 'empty', size); const f = await fixture(page, true); await discover(page); await pick(page, f.refs.seed); await capture(page, 'related', size, true);
      await page.locator('#wbDiscoveryClear').click(); await pick(page, f.refs.link, '천문대 방문'); assert.equal(await candidates(page).count(), 0); await capture(page, 'no-related', size);
      await page.goto(base + '/index.html?section=tools'); await ready(page); await page.evaluate(() => { window.__rediscoveryHoldRead = true; window.__rediscoveryReadEntered = false; }); await page.getByRole('button', { name: '다시 찾기', exact: true }).click(); await page.waitForFunction(() => __rediscoveryReadEntered); await capture(page, 'loading', size); await page.evaluate(() => __rediscoveryReleaseRead()); await page.locator('#wbDiscoverQuery').waitFor();
      await page.goto(base + '/index.html?section=tools'); await ready(page); await page.evaluate(() => { window.__rediscoveryReadFailure = true; }); await page.getByRole('button', { name: '다시 찾기', exact: true }).click(); await page.locator('#wbError').waitFor({ state: 'visible' }); await capture(page, 'read-error', size);
    }, { viewport: size, hasTouch: size.width <= 820 });
  } finally {
    await browser.close(); const json = JSON.stringify(report, null, 2) + '\n';
    await fs.writeFile(path.join(out, process.env.REDISCOVERY_TEST_MATCH ? 'recheck-report.json' : 'browser-report.json'), json);
    await fs.writeFile(path.join(out, 'run-' + report.createdAt.replace(/[:.]/g, '-') + '.json'), json);
  }
  console.log(`Rediscovery: ${report.checks.filter(check => check.pass).length}/${report.checks.length}; visual ${report.visual.length}; console ${report.consoleErrors.length}; page ${report.pageErrors.length}.`);
  if (report.checks.some(check => !check.pass) || report.consoleErrors.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

/* Core journey benchmark: actual local app, SDK and IndexedDB; anonymous HTTP.
 * BASE_URL=http://127.0.0.1:4184 node tests/core-experience-browser.cjs
 * CORE_EXPERIENCE_BASELINE=1 captures an immutable before-site only.
 * PW_MODULE_PATH or PLAYWRIGHT_MODULE and CHROMIUM_PATH select installed tools.
 * No production database or actual Apple hardware/IME claims. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
if (!process.env.PW_MODULE_PATH && process.env.PLAYWRIGHT_MODULE) process.env.PW_MODULE_PATH = process.env.PLAYWRIGHT_MODULE;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, observe, nav } = require('./unified-home-browser.cjs');
const { current, verifyPageBody } = require('./life-workbench-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const baseline = process.env.CORE_EXPERIENCE_BASELINE === '1';
const audit = path.resolve(__dirname, '../.local/quality-audit', baseline ? 'before' : 'after');
const out = baseline ? audit : path.resolve(__dirname, '../.local/core-experience');
const samples = [
  { key: 'walk', origin: 'apple_notes', title: '정원 산책에서 배운 관찰의 속도', authorRelation: 'self', coverage: 'full_text', text: '정원 산책을 마치고 벤치에 앉았다. 잎사귀의 모양을 자세히 보려고 멈추니 방금 지나온 길도 다르게 보였다.\n\n빨리 걸을 때는 목적지만 생각했지만 천천히 걸을 때는 빛과 나무의 간격이 눈에 들어왔다. 사진을 더 찍는 것보다 한 장을 오래 보는 편이 오늘의 기억에는 도움이 됐다.\n\n다음 산책에서는 같은 나무를 다시 찾아가고 싶다. 어떤 것을 알아차렸는지 적어 두면 계절이 바뀌는 모습도 천천히 비교할 수 있을 것 같다.' },
  { key: 'photo', origin: 'instagram', title: '정원 산책 사진을 다시 보며', coverage: { status: 'partial', omissions: ['사진과 댓글은 보관하지 않음'] }, url: 'https://www.instagram.com/p/AnonymousWalk/', text: '정원 산책 사진을 정리했다. 빛이 나뭇잎을 통과하는 순간은 짧았는데, 다시 보니 그때의 조용한 기분이 생각난다. 같은 길도 멈춰서 보는 시간에 따라 달라진다.' },
  { key: 'book', origin: 'obsidian', title: '비 오는 날 읽은 책의 문장', coverage: 'full_text', text: '책에 남겨 둔 문장을 옮겨 적었다. 정원 산책에서 느꼈던 것처럼 한 대상을 자세히 읽는 일은 서두르지 않는 연습이기도 하다.\n\n읽기와 걷기가 닮은 점을 다음 모임에서 이야기해 보고 싶다.' },
  { key: 'link', origin: 'naver_blog', title: '박물관 주말 관람 안내', coverage: { status: 'link_only', omissions: ['본문 미확보'] }, text: null, url: 'https://blog.naver.com/anonymous_fixture/222000000012' }
];
const comment = '짧게 지나친 순간도 다시 읽으면 새로운 질문이 생긴다. 이번 주에는 많이 모으기보다 이미 남겨 둔 것을 천천히 살펴보고 싶다. 다음 산책에서 같은 길의 변화를 비교해 보자.';

async function go(page, section, view) {
  await page.goto(base + '/index.html?section=' + section + (view ? '&view=' + view : ''));
  await ready(page); await settle(page);
  if (view) await page.locator('.life-workbench[data-mode="' + view + '"]').waitFor();
}
async function fixture(page) {
  await go(page, 'tools');
  const result = await page.evaluate(async ({ samples, comment }) => {
    const storage = HaedoLife.Shell.storage, core = HaedoLife.Core;
    let bundle = await storage.read(await storage.getActive()); const refs = {};
    for (const sample of samples) {
      const { key, ...input } = sample, prepared = await core.prepareImport({ forceSeparate: true, ...input }, bundle);
      const result = await storage.commitLocal({ workspaceId: bundle.workspaceId, baseRevision: bundle.revision, operationId: core.id(), changes: core.buildImportChanges(bundle, prepared) });
      if (result.status !== 'stored') throw new Error('Core benchmark fixture failed');
      refs[key] = { sourceId: prepared.source.id, versionId: prepared.version.id }; bundle = await storage.read(bundle.workspaceId);
    }
    const workbench = await storage.readWorkbench(bundle.workspaceId), groupId = core.id(), entryId = core.id();
    workbench.groups.push({ id: groupId, title: samples[0].title, versionIds: [refs.walk.versionId, refs.photo.versionId] });
    workbench.page.title = '이번 주 읽고 걸은 것'; workbench.page.intro = '걷고 읽으며 남긴 몇 가지 장면.';
    workbench.page.entries.push({ id: entryId, title: samples[0].title, parts: [{ versionId: refs.walk.versionId, enabled: true }, { versionId: refs.photo.versionId, enabled: true }], note: comment, pinned: true, enabled: true, showBody: true, showNote: true });
    workbench.page.entries.push({ id: core.id(), title: samples[3].title, parts: [{ versionId: refs.link.versionId, enabled: true }], note: '관람 전에 개관 시간을 다시 확인하기.', pinned: false, enabled: true, showBody: true, showNote: true });
    await storage.saveWorkbench(bundle.workspaceId, workbench, workbench.revision);
    return { workspaceId: bundle.workspaceId, refs, groupId, entryId };
  }, { samples, comment });
  return result;
}
async function saved(page) { await page.locator('#wbStatus[data-state="saved"]').waitFor(); return current(page); }
async function openReader(page, versionId) {
  await go(page, 'records'); await page.locator('.life-source-open[data-version-id="' + versionId + '"]').click(); await settle(page); await page.locator('#lifeSourceText').waitFor();
}
async function showRelated(page, refs) {
  if (baseline) {
    await go(page, 'tools', 'discover'); await page.locator('#wbDiscoverQuery').fill('관찰의 속도');
    await page.locator('.wb-discovery-select[data-version-id="' + refs.walk.versionId + '"]').click();
  } else {
    await openReader(page, refs.walk.versionId);
    await page.locator('#lifeReaderRelated').click();
  }
  await page.locator('#wbDiscoverySeed[data-version-id="' + refs.walk.versionId + '"]').waitFor();
}
function experienceMetrics({ scene, title }) {
  const visible = el => el.checkVisibility({ checkVisibilityCSS: true }) && !el.closest('[hidden],.life-sr-only,.sr-only');
  const entry = document.querySelector('article[data-entry-id]');
  const contents = scene === 'page' ? [...(entry?.querySelectorAll('.wb-source-body,.wb-comment-body') || [])].filter(visible) : [...document.querySelectorAll('.wb-discovery-result .wb-result-text')].filter(visible);
  const duplicates = [...(entry?.querySelectorAll('h3,p,span,label') || [])].filter(visible).filter(el => !el.children.length && [title, title + ' 표시'].includes(el.textContent.trim()));
  return { firstContentY: contents[0] ? +(contents[0].getBoundingClientRect().top + scrollY).toFixed(2) : null, visibleTitleOccurrences: duplicates.length, visibleComment: !!entry && [...entry.querySelectorAll('.wb-comment-body')].some(visible), relatedSeedVersionId: document.querySelector('#wbDiscoverySeed')?.dataset.versionId || null, openDetails: [...document.querySelectorAll('details[open]')].filter(visible).map(el => el.querySelector('summary')?.textContent) };
}
async function importThroughUI(page, sample) {
  const back = page.getByRole('button', { name: '기록으로 돌아가기', exact: true });
  if (await back.isVisible()) { await back.click(); await settle(page); }
  await page.getByRole('button', { name: '가져오기', exact: true }).click();
  await page.locator('#lifeImportOrigin').selectOption(sample.origin); await page.locator('#lifeImportTitle').fill(sample.title);
  if (sample.url) await page.locator('#lifeImportUrl').fill(sample.url);
  if (sample.text != null) await page.locator('#lifeImportText').fill(sample.text); else await page.getByRole('button', { name: '링크 보관', exact: true }).click();
  await page.locator('details').filter({ has: page.locator('#lifeImportRelation') }).locator(':scope > summary').click();
  if (sample.authorRelation) await page.locator('#lifeImportRelation').selectOption(sample.authorRelation);
  if (sample.text != null) await page.locator('#lifeImportCoverage').selectOption(typeof sample.coverage === 'string' ? sample.coverage : sample.coverage.status);
  if (sample.coverage?.omissions) await page.locator('#lifeImportOmissions').fill(sample.coverage.omissions.join(', '));
  await page.getByRole('button', { name: '원문·출처 확인', exact: true }).click(); await settle(page); await page.getByRole('button', { name: '자료만 보관', exact: true }).click(); await settle(page);
  const value = await current(page), source = value.bundle.sources.find(source => source.title === sample.title), version = value.bundle.sourceVersions.find(version => version.sourceId === source.id);
  assert.equal(version.contentText, sample.text); return { sourceId: source.id, versionId: version.id };
}
async function main() {
  await fs.mkdir(out, { recursive: true }); await fs.mkdir(audit, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), baseline, browser: browser.version(), checks: [], visual: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [], productionWrites: 0, scope: 'Anonymous actual UI/SDK/IndexedDB benchmark; scene-specific observations, not a universal UX pass mark or real Apple test' };
  async function check(name, run, options = {}) {
    if (process.env.CORE_EXPERIENCE_MATCH && !new RegExp(process.env.CORE_EXPERIENCE_MATCH).test(name)) return;
    const server = new FakeCloud(), context = await makeContext(browser, server, 'core-' + report.checks.length, accounts.a, options), page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
    await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback(); report.external.push({ origin: u.origin, path: u.pathname }); return route.abort('blockedbyclient'); });
    try { await run({ page, context, server }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  async function capture(page, scene, size) {
    await page.evaluate(() => document.fonts.ready); await page.evaluate(() => { document.activeElement?.blur(); scrollTo({ top: 0, behavior: 'instant' }); });
    const metrics = await page.evaluate(inspect), experience = await page.evaluate(experienceMetrics, { scene, title: samples[0].title }), file = scene + '-' + size.width + '.png';
    await page.screenshot({ path: path.join(audit, file) }); report.visual.push({ scene, file, ...metrics, experience });
    assert(!metrics.horizontalOverflow, scene + ' overflow'); for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ' ' + key);
    if (!baseline && scene === 'page') { assert.equal(experience.visibleTitleOccurrences, 1, 'One source title should not repeat in the default page entry'); assert.equal(experience.visibleComment, true, 'Default page should show its own comment'); }
  }
  try {
    if (!baseline) await check('UI import to related reading, exact pair group, page editing and reload', async ({ page }) => {
      await go(page, 'records'); const refs = {};
      for (const sample of samples) refs[sample.key] = await importThroughUI(page, sample);
      await page.getByRole('button', { name: '기록으로 돌아가기', exact: true }).click(); await page.locator('#lifeSearch').fill('관찰의 속도');
      await page.locator('.life-source-open[data-version-id="' + refs.walk.versionId + '"]').click(); await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), samples[0].text);
      const original = (await current(page)).bundle;
      await page.evaluate(() => { window.__coreSeedChoices = 0; document.addEventListener('click', event => { if (event.target.closest('.wb-discovery-select')) window.__coreSeedChoices++; }); });
      await page.locator('#lifeReaderRelated').tap(); await page.locator('.life-workbench[data-mode="related"]').waitFor();
      assert.equal(await page.locator('#wbDiscoverySeed').getAttribute('data-version-id'), refs.walk.versionId); assert.equal(await page.locator('[data-haedo-navigation] [data-haedo-section="records"]').getAttribute('aria-current'), 'page');
      assert.equal(await page.evaluate(() => __coreSeedChoices), 0);
      const candidate = page.locator('.wb-discovery-result[data-version-id="' + refs.photo.versionId + '"]'); await candidate.getByRole('button', { name: '이 원문 버전 열기', exact: true }).click(); await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), samples[1].text);
      await page.getByRole('button', { name: '관련 기록으로 돌아가기', exact: true }).click(); await page.locator('#wbDiscoverySeed').waitFor(); assert.equal(await page.locator('#wbDiscoverySeed').getAttribute('data-version-id'), refs.walk.versionId);
      await page.locator('.wb-discovery-result[data-version-id="' + refs.photo.versionId + '"] .wb-discovery-arrange').click(); await page.locator('#wbIncomingSelection').waitFor();
      assert.deepEqual(await page.locator('#wbIncomingSelection input[data-version-id]:checked').evaluateAll(nodes => nodes.map(node => node.dataset.versionId)), [refs.walk.versionId, refs.photo.versionId]);
      await page.locator('#wbIncomingTitle').fill(samples[0].title); await page.locator('#wbIncomingApply').click(); let state = await saved(page); assert.equal(state.workbench.groups.length, 1); assert.deepEqual(state.bundle, original);
      await page.locator('article[data-group-id]').getByRole('button', { name: '이 묶음을 내 페이지에 추가', exact: true }).click(); await saved(page); await page.getByRole('button', { name: '내 페이지', exact: true }).click(); await page.locator('.wb-page-entry').waitFor();
      const entry = page.locator('.wb-page-entry').first(), entryId = await entry.getAttribute('data-entry-id');
      await verifyPageBody(entry.locator('.wb-page-content [data-version-id="' + refs.walk.versionId + '"]'), samples[0].text, { folded: true });
      await entry.locator('.wb-page-entry-edit > summary').click(); const note = entry.getByLabel('내 코멘트', { exact: true });
      await note.evaluate(el => { window.__coreNoteInput = el; window.__coreBodyNode = document.querySelector('.wb-page-content .wb-source-body'); }); await note.fill(comment);
      assert.equal(await note.evaluate(el => el === __coreNoteInput && document.activeElement === el && document.querySelector('.wb-page-content .wb-source-body') === __coreBodyNode), true, 'Typing a comment rebuilt its input or unchanged original body');
      assert.equal(await entry.locator('.wb-page-content .wb-comment-body').textContent(), comment);
      await entry.getByLabel('내 코멘트 표시', { exact: true }).uncheck(); assert.equal(await entry.locator('.wb-page-content .wb-comment-body').isVisible(), false); assert.equal(await note.inputValue(), comment); await entry.getByLabel('내 코멘트 표시', { exact: true }).check();
      const photoToggle = entry.locator('[data-part-version-id="' + refs.photo.versionId + '"] input[type=checkbox]'); await photoToggle.uncheck(); assert.equal(await entry.locator('.wb-page-content [data-version-id="' + refs.photo.versionId + '"]').count(), 0); await photoToggle.check();
      await saved(page); await entry.locator('.wb-page-entry-edit > summary').click(); const metrics = await page.evaluate(experienceMetrics, { scene: 'page', title: samples[0].title }); assert.equal(metrics.visibleTitleOccurrences, 1); assert.equal(metrics.visibleComment, true);
      await page.locator('#wbPagePreview').click(); await page.locator('#wbVisitor').waitFor();
      await verifyPageBody(page.locator('#wbVisitor [data-version-id="' + refs.walk.versionId + '"]'), samples[0].text, { folded: true });
      await verifyPageBody(page.locator('#wbVisitor [data-version-id="' + refs.photo.versionId + '"]'), samples[1].text);
      assert((await page.locator('#wbVisitor').textContent()).includes(comment));
      await page.locator('#wbPagePreview').click(); const seedReselections = await page.evaluate(() => __coreSeedChoices); assert.equal(seedReselections, 0); await page.reload(); await ready(page); await page.locator('.wb-page-entry[data-entry-id="' + entryId + '"]').waitFor();
      assert.equal(await page.locator('.wb-page-entry .wb-comment-body').textContent(), comment); state = await current(page); assert.deepEqual(state.bundle, original); assert.deepEqual(state.workbench.page.entries[0].parts.map(part => part.versionId), [refs.walk.versionId, refs.photo.versionId]);
      report.journey = { importedSamples: samples.length, relatedEntryActions: 1, seedReselections, exactPairPreserved: true, sourceBundleUnchanged: true, pageReloaded: true };
      await page.screenshot({ path: path.join(out, 'journey-page-390.png') });
    }, { viewport: { width: 390, height: 844 }, hasTouch: true });
    if (!baseline) await check('related return preserves older reader version, selection, scroll and previous search', async ({ page }) => {
      const f = await fixture(page); await page.evaluate(async ref => { const s = HaedoLife.Shell.storage, c = HaedoLife.Core, b = await s.read(await s.getActive()), p = await c.prepareImport({ origin: 'apple_notes', title: '정원 산책에서 배운 관찰의 속도', text: '수정본에서는 다음 여행의 일정만 정리했다.', existingSourceId: ref.sourceId }, b); const r = await s.commitLocal({ workspaceId: b.workspaceId, baseRevision: b.revision, operationId: c.id(), changes: c.buildImportChanges(b, p) }); if (r.status !== 'stored') throw new Error('Second exact reader version fixture failed'); }, f.refs.walk);
      await go(page, 'records'); await page.locator('#lifeSearch').fill('잎사귀의 모양'); await page.locator('.life-source-open[data-version-id="' + f.refs.walk.versionId + '"]').click(); await page.locator('#lifeSourceText').waitFor();
      const selected = '빛과 나무의 간격'; await page.locator('#lifeSourceText').evaluate((el, text) => { el.focus(); const start = el.textContent.indexOf(text), range = document.createRange(); range.setStart(el.firstChild, start); range.setEnd(el.firstChild, start + text.length); getSelection().removeAllRanges(); getSelection().addRange(range); el.dispatchEvent(new Event('pointerup', { bubbles: true })); }, selected);
      await page.locator('#lifeReaderRelated').evaluate(el => el.addEventListener('pointerdown', () => { window.__coreReaderY = scrollY; }, { once: true })); await page.locator('#lifeReaderRelated').tap(); await page.locator('#wbDiscoverySeed[data-version-id="' + f.refs.walk.versionId + '"]').waitFor(); await page.locator('#lifeRelatedReturn').click(); await page.locator('#lifeSourceText').waitFor();
      assert.equal(await page.locator('#lifeSourceText').textContent(), samples[0].text); assert.equal(await page.locator('#lifeVersion').inputValue(), f.refs.walk.versionId); await page.waitForFunction(text => getSelection().toString() === text, selected); await page.waitForFunction(() => Math.abs(scrollY - __coreReaderY) <= 2);
      report.readerReturn = await page.evaluate(() => ({ originalScrollY: __coreReaderY, restoredScrollY: scrollY, selectionPreserved: getSelection().toString().length > 0 }));
      await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeSearch').waitFor(); assert.equal(await page.locator('#lifeSearch').inputValue(), '잎사귀의 모양'); assert.equal(await page.locator('.life-source-card').count(), 1);
    }, { viewport: { width: 390, height: 844 }, hasTouch: true });
    for (const size of [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }]) await check((baseline ? 'before' : 'after') + ' related and page ' + size.width, async ({ page }) => {
      const f = await fixture(page); await showRelated(page, f.refs); await capture(page, 'related', size); await go(page, 'records', 'page'); await page.locator('article[data-entry-id="' + f.entryId + '"]').waitFor(); await capture(page, 'page', size);
    }, { viewport: size, hasTouch: size.width <= 820 });
  } finally {
    await browser.close(); const json = JSON.stringify(report, null, 2) + '\n'; await fs.writeFile(path.join(out, 'browser-report.json'), json); await fs.writeFile(path.join(out, 'run-' + report.createdAt.replace(/[:.]/g, '-') + '.json'), json);
  }
  console.log(`Core experience: ${report.checks.filter(check => check.pass).length}/${report.checks.length}, visual ${report.visual.length}, console ${report.consoleErrors.length}, page ${report.pageErrors.length}.`);
  if (report.checks.some(check => !check.pass) || report.consoleErrors.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { samples, comment, fixture, experienceMetrics };

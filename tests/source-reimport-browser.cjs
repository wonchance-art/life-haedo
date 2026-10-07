/* Naver source reimport: real UI, bundled SDK and isolated IndexedDB.
 * Synthetic Auth HTTP only; no source URL fetch, live DB or device claims.
 * BASE_URL=http://127.0.0.1:4184 node tests/source-reimport-browser.cjs */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, observe, nav } = require('./unified-home-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const out = path.resolve('.local/source-reimport');
const title = '전시를 보고 정원까지 걸으며 다시 읽을 질문을 남긴 산책 기록';
const url = 'https://blog.naver.com/anonymous_fixture/222000000081?from=reading#garden';
const quote = '오래 멈춘 자리에서 다시 볼 질문을 찾았다🌱';
const raw = '전시실을 나와 정원을 천천히 걸었다. 사진으로 남기지 않은 길의 움직임을 글로 적었다.\n\n' + quote + '\n\n본문 중 필요한 부분만 옮겼다. 사진과 댓글은 이 기록에 포함하지 않는다.';
const revised = raw + '\n\n다음 산책에서는 같은 자리의 빛을 비교해 보기로 했다.';
const state = page => page.evaluate(async () => { const s = HaedoLife.Shell.storage, id = await s.getActive(); return { bundle: await s.read(id), stages: await s.listStages(id) }; });
const click = async (page, name) => { await page.getByRole('button', { name, exact: true }).click(); await settle(page); };
const frames = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
function annotation(error) { if (process.env.GITHUB_ACTIONS) console.error('::error title=Source reimport::' + String(error.stack || error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')); }
async function records(page) { await page.goto(base + '/index.html?section=records'); await ready(page); await settle(page); await page.locator('#lifeSearch').waitFor(); }
async function field(page, name, value) {
  const control = page.locator('#lifeImport' + name);
  if (!await control.isVisible()) await control.locator('xpath=ancestor::details[1]').locator(':scope > summary').click();
  if (['Coverage', 'Relation', 'Origin'].includes(name)) await control.selectOption(value); else await control.fill(value);
}
async function saveDraft(page) { await click(page, '검토 내용 보관'); const values = (await state(page)).stages.filter(stage => stage.state === 'draft'); return values.find(stage => stage.input.title === title) || values.at(-1); }
async function seed(page, { sourceUrl = url, file = null } = {}) {
  await records(page); await click(page, '가져오기'); await field(page, 'Origin', 'naver_blog'); await field(page, 'Title', title); await field(page, 'Url', sourceUrl);
  if (file) { await click(page, '텍스트 파일'); await page.locator('#lifeImportFile').setInputFiles({ name: file.name, mimeType: 'text/markdown', buffer: Buffer.from(file.text) }); await settle(page); }
  else await click(page, '링크 보관');
  await field(page, 'Author', '익명 산책자'); await field(page, 'Relation', 'other'); await field(page, 'Date', '2024-10-02');
  await click(page, '원문·출처 확인'); await click(page, '자료만 보관'); await page.locator('#lifeSourceInfoToggle').waitFor();
  const bundle = (await state(page)).bundle, source = bundle.sources.find(source => source.url === sourceUrl), version = bundle.sourceVersions.find(version => version.sourceId === source.id);
  assert.equal(version.contentText, file ? file.text : null); return { sourceId: source.id, versionId: version.id, source, version };
}
async function openVersion(page, sourceId, versionId) {
  await records(page); const versions = (await state(page)).bundle.sourceVersions.filter(version => version.sourceId === sourceId);
  await page.locator(`.life-source-open[data-version-id="${versions.at(-1).id}"]`).click(); await settle(page); await page.locator('#lifeSourceInfoToggle').waitFor();
  if (versionId && versionId !== versions.at(-1).id) { await page.locator('#lifeVersion').selectOption(versionId); await settle(page); }
}
async function reimport(page, width = 820) {
  if (await page.locator('#lifeSourceInfoToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#lifeSourceInfoToggle').click();
  const control = page.locator('#lifeSourceReimport'); await control.waitFor();
  if (width <= 820) await control.tap(); else { await control.focus(); await page.keyboard.press('Enter'); }
  await settle(page); await page.locator('#lifeImportText').waitFor();
}
async function partial(page, body = raw) { await field(page, 'Text', body); await field(page, 'Coverage', 'partial'); await field(page, 'Omissions', '사진·댓글 미보관'); }
async function addQuote(page) {
  await page.locator('#lifeReviewText').evaluate((el, quote) => { const start = el.value.indexOf(quote); if (start < 0) throw Error('Synthetic excerpt not found'); el.focus(); el.setSelectionRange(start, start + quote.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, quote);
  await page.locator('#lifeExcerptTopic').fill('다시 볼 질문'); await page.locator('#lifeExcerptNote').fill('이전 원문을 그대로 다시 읽기'); await click(page, '발췌 후보 추가');
}
async function cancel(page) { page.once('dialog', dialog => dialog.accept()); await click(page, '이 검토 취소'); await page.locator('#lifeSearch').waitFor(); }
async function resume(page, name = title) {
  await records(page); const summary = page.locator('summary').filter({ hasText: /^검토 중 \d+개 · 이어서 확인$/ }); await summary.click();
  await summary.locator('..').getByRole('button', { name, exact: true }).click(); await settle(page); await page.locator('#lifeImportText').waitFor();
}
async function fault(page, mode) {
  await page.evaluate(mode => {
    window.__reimportPut ||= IDBObjectStore.prototype.put; window.__reimportAborts = 0;
    IDBObjectStore.prototype.put = mode ? function (value, ...args) { const request = __reimportPut.call(this, value, ...args); if (this.name === 'staging' && (mode === 'draft' ? value?.state === 'draft' : value?.state === 'applied')) { __reimportAborts++; this.transaction.abort(); } return request; } : __reimportPut;
  }, mode);
}
async function take(page, report, scene, width) {
  await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); }); await frames(page); const metrics = await page.evaluate(inspect);
  metrics.smallTargets = metrics.smallTargets.filter(target => target.id !== 'lifeSourceText');
  const screenshot = `${scene}-${width}.png`; await page.screenshot({ path: path.join(out, screenshot), fullPage: true });
  if (width === 390) await page.screenshot({ path: path.join(out, `${scene}-${width}-viewport.png`), fullPage: false });
  report.visual.push({ scene, width, screenshot, ...metrics }); assert.equal(metrics.horizontalOverflow, false);
  for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ': ' + key);
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), browser: browser.version(), scope: 'Actual import/reimport UI, SDK and IndexedDB with anonymous intercepted HTTP; Chromium viewport/touch/keyboard, not live Naver/Google/SQL, clipboard or Apple hardware.', checks: [], visual: [], observations: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, operatingRemoteWrites: 0 };
  async function check(name, width, run) {
    if (process.env.SOURCE_REIMPORT_MATCH && !new RegExp(process.env.SOURCE_REIMPORT_MATCH).test(name)) return;
    const server = new FakeCloud(), context = await makeContext(browser, server, 'reimport-' + report.checks.length, accounts.a, { viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width <= 820, reducedMotion: 'reduce' });
    await context.route('**/*', route => { const target = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(target.origin)) return route.fallback(); report.external.push(target.origin); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
    try { await run(page); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); annotation(error); await page.screenshot({ path: path.join(out, `failure-${report.checks.length}.png`), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    for (const width of [1440, 820, 390]) await check(`link to partial body, exact duplicate and new immutable version at ${width}`, width, async page => {
      const initial = await seed(page); await page.locator('#lifeSourceInfoToggle').click(); await take(page, report, 'source-action', width);
      await reimport(page, width); assert.equal(await page.locator('#lifeImportText').inputValue(), ''); assert.equal(await page.locator('#lifeImportTitle').inputValue(), title); assert.equal(await page.locator('#lifeImportUrl').inputValue(), url);
      assert.equal(await page.locator('#lifeImportAuthor').inputValue(), '익명 산책자'); assert.equal(await page.locator('#lifeImportDate').inputValue(), '2024-10-02'); assert.equal(await page.locator('#lifeImportCoverage').inputValue(), 'unknown');
      await click(page, '원문·출처 확인'); await page.locator('#lifeError').waitFor({ state: 'visible' }); assert.equal(await page.locator('#lifeImportForm').isVisible(), true); assert.equal((await state(page)).bundle.sourceVersions.length, 1);
      await partial(page); await field(page, 'Title', title + ' — 관찰 메모'); await field(page, 'Author', '익명 관찰자'); await field(page, 'Date', '2024-10-03');
      const draft = await saveDraft(page); assert.equal(draft.input.existingSourceId, initial.sourceId); await take(page, report, 'reimport-filled', width);
      await click(page, '원문·출처 확인'); assert.equal(await page.getByRole('button', { name: '같은 자료로 확인 · 버전 비교', exact: true }).count(), 0); await addQuote(page); await take(page, report, 'reimport-review', width);
      await click(page, '선택한 발췌 모음에 반영'); const first = (await state(page)).bundle;
      assert.equal(first.sources.length, 1); assert.equal(first.sources[0].id, initial.sourceId); assert.equal(first.sourceVersions.length, 2); const partialVersion = first.sourceVersions.find(version => version.contentText === raw);
      assert.deepEqual(first.sourceVersions.find(version => version.id === initial.versionId), initial.version); assert.equal(partialVersion.coverage.status, 'partial'); assert.deepEqual(partialVersion.coverage.omissions, ['사진·댓글 미보관']);
      assert.equal(partialVersion.originalAuthor.label, '익명 관찰자'); assert.equal(partialVersion.originalCreatedAt, '2024-10-03');
      assert.equal(first.records.length, 1); assert.equal(first.records[0].text, quote); assert.deepEqual(first.records[0].sourceRefs[0], { sourceId: initial.sourceId, sourceVersionId: partialVersion.id, locator: { start: raw.indexOf(quote), end: raw.indexOf(quote) + quote.length } });
      await openVersion(page, initial.sourceId, partialVersion.id); await reimport(page, width); await partial(page); await click(page, '원문·출처 확인'); await click(page, '자료만 보관');
      const duplicate = (await state(page)).bundle; assert.equal(duplicate.sources.length, 1); assert.equal(duplicate.sourceVersions.length, 2); assert.deepEqual(duplicate.sourceVersions, first.sourceVersions); assert.deepEqual(duplicate.records, first.records);
      await reimport(page, width); await partial(page, revised); await click(page, '원문·출처 확인'); await click(page, '자료만 보관');
      const latest = (await state(page)).bundle; assert.equal(latest.sources.length, 1); assert.equal(latest.sourceVersions.length, 3); assert.deepEqual(latest.records, first.records);
      for (const old of first.sourceVersions) assert.deepEqual(latest.sourceVersions.find(version => version.id === old.id), old);
      await page.locator('#lifeVersion').selectOption(partialVersion.id); await settle(page); assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
      await page.locator('#lifeVersion').selectOption(initial.versionId); await settle(page); assert.equal(await page.locator('#lifeSourceText').count(), 0);
      report.observations.push({ width, sameSourceId: true, sourceVersions: 3, exactDuplicateAddedVersions: 0, preservedOldVersions: 2, preservedExcerptUtf16: true });
    });
    await check('cancel and reload resume preserve earlier drafts and explicit source identity', 820, async page => {
      const initial = await seed(page); await records(page); await click(page, '가져오기'); await field(page, 'Title', '먼저 쓰던 다른 검토'); await field(page, 'Text', '다른 검토의 보존할 본문'); await nav(page, 'tools');
      const previous = (await state(page)).stages.find(stage => stage.state === 'draft' && stage.input.title === '먼저 쓰던 다른 검토'); assert(previous);
      await openVersion(page, initial.sourceId); await reimport(page); const empty = await saveDraft(page); assert.equal(empty.input.existingSourceId, initial.sourceId); assert.equal(empty.input.text, '');
      await page.reload(); await ready(page); await resume(page); assert.equal(await page.locator('#lifeImportMethodText').getAttribute('aria-pressed'), 'true'); assert.equal(await page.locator('#lifeImportText').inputValue(), '');
      await partial(page); const saved = await saveDraft(page); await nav(page, 'tools'); await page.reload(); await ready(page); await resume(page);
      assert.equal(await page.locator('#lifeImportText').inputValue(), raw); assert.equal(await page.locator('#lifeImportUrl').inputValue(), url); assert.equal((await state(page)).stages.find(stage => stage.stageId === saved.stageId).input.existingSourceId, initial.sourceId);
      assert.deepEqual((await state(page)).stages.find(stage => stage.stageId === previous.stageId), previous);
      await cancel(page); const after = await state(page); assert(!after.stages.some(stage => stage.stageId === saved.stageId)); assert.deepEqual(after.stages.find(stage => stage.stageId === previous.stageId), previous); assert.equal(after.bundle.sourceVersions.length, 1); assert.deepEqual(after.bundle.sourceVersions[0], initial.version);
    });
    await check('identity changes detach linking while unchanged URL and same filename remain explicit', 820, async page => {
      const initial = await seed(page); await reimport(page); await partial(page);
      await field(page, 'Url', url); await page.locator('#lifeImportUrl').dispatchEvent('input'); assert.equal((await saveDraft(page)).input.existingSourceId, initial.sourceId);
      const otherUrl = 'https://blog.naver.com/anonymous_fixture/222000000082'; await field(page, 'Url', otherUrl); const detached = await saveDraft(page); assert.equal(detached.input.existingSourceId, undefined); assert.match(await page.locator('#lifeImportExistingSource').textContent(), /연결을 해제/);
      await click(page, '원문·출처 확인'); await click(page, '자료만 보관'); let bundle = (await state(page)).bundle; assert.equal(bundle.sources.length, 2); assert(bundle.sources.some(source => source.url === otherUrl && source.id !== initial.sourceId)); assert.deepEqual(bundle.sourceVersions.find(version => version.id === initial.versionId), initial.version);
      await openVersion(page, initial.sourceId); await reimport(page); await field(page, 'Origin', 'instagram'); assert.equal((await saveDraft(page)).input.existingSourceId, undefined); await cancel(page);
      const fileSource = await seed(page, { sourceUrl: url.replace('081', '083'), file: { name: 'garden-notes.md', text: '파일로 보관한 정원 기록.\r\n다음에 읽을 구절🌱' } });
      await reimport(page); assert.equal((await saveDraft(page)).input.fileName, 'garden-notes.md');
      await click(page, '텍스트 파일'); await page.locator('#lifeImportFile').setInputFiles({ name: 'garden-notes.md', mimeType: 'text/markdown', buffer: Buffer.from('같은 파일의 보완한 본문🌱\r\n새 문장') }); await settle(page);
      assert.equal((await saveDraft(page)).input.existingSourceId, fileSource.sourceId);
      await page.locator('#lifeImportFile').setInputFiles({ name: 'different-notes.md', mimeType: 'text/markdown', buffer: Buffer.from('다른 파일의 본문') }); await settle(page);
      const different = await saveDraft(page); assert.equal(different.input.existingSourceId, undefined); assert.equal(different.input.fileName, 'different-notes.md'); assert.equal(different.input.text, '다른 파일의 본문');
      await cancel(page); bundle = (await state(page)).bundle; assert.deepEqual(bundle.sourceVersions.find(version => version.id === fileSource.versionId), fileSource.version);
    });
    await check('staging and atomic commit failures retain text and source identity for retry', 390, async page => {
      const initial = await seed(page); await reimport(page, 390); await partial(page); await fault(page, 'draft');
      await click(page, '원문·출처 확인'); await page.locator('#lifeError').waitFor({ state: 'visible' }); assert(await page.evaluate(() => __reimportAborts > 0)); assert.equal(await page.locator('#lifeImportText').inputValue(), raw); assert.equal((await state(page)).bundle.sourceVersions.length, 1);
      await page.locator('[data-haedo-navigation] [data-haedo-section="tools"]').click(); await settle(page); assert.equal(await page.locator('#lifeImportForm').isVisible(), true);
      await fault(page, null); assert.equal((await saveDraft(page)).input.existingSourceId, initial.sourceId); await click(page, '원문·출처 확인');
      await fault(page, 'commit'); await click(page, '자료만 보관'); await page.locator('#lifeError').waitFor({ state: 'visible' }); assert(await page.evaluate(() => __reimportAborts > 0));
      assert.equal(await page.locator('#lifeImportText').inputValue(), raw); assert.equal((await state(page)).bundle.sourceVersions.length, 1); const draft = (await state(page)).stages.find(stage => stage.state === 'draft'); assert.equal(draft.input.existingSourceId, initial.sourceId);
      await take(page, report, 'save-error', 390); await fault(page, null); await click(page, '자료만 보관'); const saved = (await state(page)).bundle;
      assert.equal(saved.sources.length, 1); assert.equal(saved.sourceVersions.length, 2); assert.equal(saved.sourceVersions.at(-1).contentText, raw); assert.deepEqual(saved.sourceVersions.find(version => version.id === initial.versionId), initial.version);
    });
    await check('a source date rejected by native date input remains exact during reimport', 820, async page => {
      const initial = await seed(page);
      // External backups/imports can contain an unverified date string. Prepare
      // that permitted source metadata through Core, without altering a saved
      // immutable version or replacing the application's input control.
      const datedVersion = await page.evaluate(async ({ sourceId, date }) => {
        const s = HaedoLife.Shell.storage, c = HaedoLife.Core, b = await s.read(await s.getActive());
        const source = b.sources.find(source => source.id === sourceId), old = b.sourceVersions.find(version => version.sourceId === sourceId);
        const prepared = await c.prepareImport({ origin: source.origin, title: source.title, url: source.url, text: null, coverage: 'link_only', author: old.originalAuthor.label, authorRelation: old.originalAuthor.relation, originalCreatedAt: date, existingSourceId: source.id }, b);
        const result = await s.commitLocal({ workspaceId: b.workspaceId, baseRevision: b.revision, operationId: c.id(), changes: c.buildImportChanges(b, prepared) });
        if (result.status !== 'stored') throw Error('Synthetic external-date fixture rejected'); return prepared.version;
      }, { sourceId: initial.sourceId, date: '2024-02-30' });
      await openVersion(page, initial.sourceId, datedVersion.id); await reimport(page);
      assert.equal(await page.locator('#lifeImportDate').getAttribute('type'), 'text'); assert.equal(await page.locator('#lifeImportDate').inputValue(), '2024-02-30');
      await partial(page); const draft = await saveDraft(page); assert.equal(draft.input.originalCreatedAt, '2024-02-30'); assert.equal(draft.input.existingSourceId, initial.sourceId);
      await click(page, '원문·출처 확인'); await click(page, '자료만 보관'); const bundle = (await state(page)).bundle;
      assert.equal(bundle.sources.length, 1); assert.equal(bundle.sourceVersions.length, 3); assert.equal(bundle.sourceVersions.find(version => version.contentText === raw).originalCreatedAt, '2024-02-30');
      assert.deepEqual(bundle.sourceVersions.find(version => version.id === datedVersion.id), datedVersion); assert.deepEqual(bundle.sourceVersions.find(version => version.id === initial.versionId), initial.version);
      report.observations.push({ scene: 'unverified-original-date', originalDate: '2024-02-30', nativeDateFallback: 'text', storedVerbatim: true });
    });
    assert(report.checks.length > 0); report.pass = report.checks.every(check => check.pass) && !report.consoleErrors.length && !report.pageErrors.length && !report.external.length;
  } finally {
    await browser.close(); report.finishedAt = new Date().toISOString(); const json = JSON.stringify(report, null, 2);
    await fs.writeFile(path.join(out, 'run-' + report.createdAt.replace(/[:.]/g, '-') + '.json'), json); await fs.writeFile(path.join(out, 'browser-report.json'), json);
  }
  console.log(JSON.stringify({ checks: report.checks.length, passed: report.checks.filter(check => check.pass).length, visual: report.visual.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length, report: path.join(out, 'browser-report.json') }));
  if (!report.pass) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); annotation(error); process.exitCode = 1; });
module.exports = { seed, reimport, partial, field, take, title, state, click };

/* Reflection reading: real application, bundled SDK and isolated IndexedDB.
 * All records/Auth HTTP are synthetic; no production or Apple-device access.
 * BASE_URL=http://127.0.0.1:4184 node tests/reflection-reading-browser.cjs */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, observe } = require('./unified-home-browser.cjs');
const { current, abortWorkbenchWrites } = require('./life-workbench-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const out = path.resolve('.local/reflection-reading');
const layoutOnly = process.env.REFLECTION_READING_LAYOUT_ONLY === '1';
const oldBody = '첫 일을 시작할 때는 잘하는 일을 빨리 정해야 한다고 생각했다.\r\n기억해 둘 질문🌱: 남의 기준과 내가 오래 해 보고 싶은 일을 어떻게 구분할까.\r\n결론보다 그때 망설인 이유를 먼저 남겨 둔다.';
const latestBody = '몇 년 뒤 같은 메모를 다시 읽었다.\r\n잘한다고 평가받은 일과 계속 해 보고 싶은 일을 이제는 따로 적는다.\r\n이 문장은 새로 덧붙인 내용이며 이전 기록을 대신하지 않는다.';
const initialNote = '스무 살 무렵에는 선택의 결과만 적었다. 지금은 그때 알지 못했던 조건과 아직 설명하지 못한 이유를 함께 읽어 보고 싶다.';
const specs = [
  { key: 'work', title: '첫 일을 고르며 남긴 생각과 몇 년 뒤 다시 읽어 본 질문', origin: 'apple_notes', relation: 'self', date: '2016-03-14', text: oldBody },
  { key: 'pause', title: '쉬는 시간을 설명하기 어려웠던 해', origin: 'obsidian', relation: 'self', date: '2020-11-01', text: '쉬는 시간을 낭비라고 불렀지만 무엇을 다시 해 보고 싶은지는 적지 않았다. 쉬는 동안에도 달라진 취향이 있었다.' },
  { key: 'reference', title: '선택의 이유를 다시 묻는 다른 사람의 글', origin: 'naver_blog', relation: 'other', date: '2017-09-12', text: '타인의 참고 글: 서두르지 않고 결정의 조건부터 확인해 보자는 제안이다. 저장했다고 해서 이 생각에 모두 동의한 것은 아니다.', url: 'https://example.invalid/reflection/reference' },
  { key: 'unknown', title: '언제 적었는지 확인하지 못한 짧은 질문', origin: 'other', relation: 'unknown', date: null, text: '작성자와 날짜를 확인하기 전에는 내 경험의 일부라고 단정하지 않는다.' },
  { key: 'invalid', title: '원문에 확인할 수 없는 날짜가 붙어 있던 메모', origin: 'apple_notes', relation: 'self', date: '2024-02-30', text: '날짜가 잘못 적혀 있지만 메모의 문장은 그대로 남긴다.' },
  { key: 'free', title: '스무 살 여름이라고만 적어 둔 관찰', origin: 'apple_notes', relation: 'self', date: '스무 살 여름', text: '나이를 연도로 추정하지 않고 그때 쓰던 말을 다시 읽는다.' },
  { key: 'link', title: '다시 확인하려고 주소만 보관한 인터뷰', origin: 'naver_blog', relation: 'other', date: '2021-04-03', text: null, url: 'https://example.invalid/reflection/interview' },
  { key: 'unselected', title: '이번 회고에는 고르지 않은 별도 원고', origin: 'obsidian', relation: 'self', date: '2018-07-11', text: '선택하지 않은 본문 UNSELECTED_REFLECTION_PRIVATE. 주제에 묶여 있어도 이번 회고 범위에 들어오지 않는다.' }
];
function annotation(error) { if (process.env.GITHUB_ACTIONS) console.error('::error title=Reflection reading::' + String(error.stack || error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')); }
const frames = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
async function go(page, view = 'reflection') { await page.goto(base + '/index.html?section=' + (view === 'workbench-backup' ? 'manage' : 'tools') + '&view=' + view); await ready(page); await settle(page); await page.locator(`.life-workbench[data-mode="${view}"][aria-busy="false"]`).waitFor(); }
async function fixture(page, selected = false) {
  await go(page);
  const f = await page.evaluate(async ({ specs, latestBody, initialNote, selected }) => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, refs = {};
    let bundle = await s.read(await s.getActive());
    for (const spec of specs) {
      const prepared = await c.prepareImport({ origin: spec.origin, title: spec.title, text: spec.text, authorRelation: spec.relation, originalCreatedAt: spec.date, coverage: spec.text === null ? 'link_only' : 'full_text', ...(spec.url ? { url: spec.url } : {}), forceSeparate: true }, bundle);
      const result = await s.commitLocal({ workspaceId: bundle.workspaceId, baseRevision: bundle.revision, operationId: c.id(), changes: c.buildImportChanges(bundle, prepared) });
      if (result.status !== 'stored') throw Error('Synthetic reflection source rejected');
      refs[spec.key] = { sourceId: prepared.source.id, versionId: prepared.version.id }; bundle = await s.read(bundle.workspaceId);
    }
    const old = specs[0], prepared = await c.prepareImport({ origin: old.origin, title: old.title, text: latestBody, originalCreatedAt: '2024-05-20', authorRelation: 'self', coverage: 'full_text', existingSourceId: refs.work.sourceId }, bundle);
    const result = await s.commitLocal({ workspaceId: bundle.workspaceId, baseRevision: bundle.revision, operationId: c.id(), changes: c.buildImportChanges(bundle, prepared) });
    if (result.status !== 'stored') throw Error('Synthetic exact latest version rejected'); refs.latest = { sourceId: prepared.source.id, versionId: prepared.version.id }; bundle = await s.read(bundle.workspaceId);
    const text = '기억해 둘 질문🌱', start = old.text.indexOf(text), stamp = new Date().toISOString();
    const record = { id: c.id(), kind: 'excerpt', text, topic: '선택의 이유', note: '과거 버전의 정확한 구절', sourceRefs: [{ sourceId: refs.work.sourceId, sourceVersionId: refs.work.versionId, locator: { start, end: start + text.length } }], provenance: { kind: 'user' }, revision: 1, createdAt: stamp, updatedAt: stamp };
    await s.commitLocal({ workspaceId: bundle.workspaceId, baseRevision: bundle.revision, operationId: c.id(), changes: { put: { records: [record] } } });
    const wb = await s.readWorkbench(bundle.workspaceId), groupIds = { work: c.id(), latest: c.id(), excluded: c.id() };
    wb.groups = [
      { id: groupIds.work, title: '일과 선택', versionIds: [refs.work.versionId, refs.pause.versionId, refs.unselected.versionId] },
      { id: groupIds.latest, title: '나중에 다시 적은 질문', versionIds: [refs.latest.versionId] },
      { id: groupIds.excluded, title: '이번에 고르지 않은 주제', versionIds: [refs.unselected.versionId] }
    ];
    const selection = ['work', 'latest', 'pause', 'reference', 'unknown', 'invalid', 'free', 'link'].map(key => refs[key].versionId);
    wb.reflection.note = initialNote; wb.reflection.versionIds = selected ? selection : [];
    await s.saveWorkbench(bundle.workspaceId, wb, wb.revision);
    return { workspaceId: bundle.workspaceId, refs, groupIds, selection };
  }, { specs, latestBody, initialNote, selected });
  await page.reload(); await ready(page); await page.locator('#wbReflectionNote').waitFor(); return f;
}
async function save(page) { await page.getByRole('button', { name: '지금 저장', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#wbStatus')?.dataset.state === 'saved'); }
async function download(page, selector) { const waiting = page.waitForEvent('download'); await page.locator(selector).click(); const file = await waiting; return { name: file.suggestedFilename(), text: await fs.readFile(await file.path(), 'utf8') }; }
async function take(page, report, scene, width) {
  await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); }); await frames(page); const metrics = await page.evaluate(inspect), screenshot = `${scene}-${width}.png`;
  await page.screenshot({ path: path.join(out, screenshot), fullPage: true }); if (width === 390) await page.screenshot({ path: path.join(out, `${scene}-${width}-viewport.png`), fullPage: false });
  const contentPosition = await page.locator('#wbReflectionReading').evaluate(el => { const row = el.querySelector('.wb-source'); const body = el.querySelector('.wb-source-body'); return { firstRecordTop: row?.getBoundingClientRect().top ?? null, firstBodyTop: body?.getBoundingClientRect().top ?? null }; });
  report.visual.push({ scene, width, screenshot, ...contentPosition, ...metrics }); assert.equal(metrics.horizontalOverflow, false);
  for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ': ' + key);
}
async function details(page, label) { const summary = page.getByText(label, { exact: true }); if (!await summary.locator('..').evaluate(el => el.open)) await summary.click(); return summary.locator('..'); }
async function period(page, from, to) { await details(page, '작성 연도로 좁히기'); await page.locator('#wbReflectionFrom').fill(from); await page.locator('#wbReflectionTo').fill(to); await page.locator('#wbReflectionApplyPeriod').click(); }
const visibleIds = page => page.locator('#wbReflectionReading .wb-source').evaluateAll(rows => rows.map(row => row.dataset.versionId));
const sorted = values => values.slice().sort();
function row(page, id) { return page.locator(`#wbReflectionReading .wb-source[data-version-id="${id}"]`); }
async function assertReturnFocus(page, id, groupKey) {
  const button = row(page, id).getByRole('button', { name: '이 원문 버전 열기', exact: true });
  assert.equal(await button.getAttribute('data-focus-key'), 'reflection:' + groupKey + ':' + id);
  await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, 'reflection:' + groupKey + ':' + id);
  assert.equal(await button.evaluate(el => document.activeElement === el), true, 'Exact source button receives focus after reader return');
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), browser: browser.version(), scope: 'Actual reflection UI, SDK and IndexedDB with synthetic intercepted HTTP; Chromium viewport/touch/keyboard, not live accounts, AI self-analysis, Apple hardware or native IME.', checks: [], visual: [], observations: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, operatingRemoteWrites: 0 };
  async function check(name, width, run) {
    if (layoutOnly && !name.startsWith('reading layout')) return;
    if (process.env.REFLECTION_READING_MATCH && !new RegExp(process.env.REFLECTION_READING_MATCH).test(name)) return;
    const server = new FakeCloud(), context = await makeContext(browser, server, 'reflection-' + report.checks.length, accounts.a, { viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width <= 820, reducedMotion: 'reduce' });
    await context.route('**/*', route => { const target = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(target.origin)) return route.fallback(); report.external.push(target.origin); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
    try { await run(page); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); annotation(error); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    for (const width of [1440, 820, 390]) await check(layoutOnly ? `reading layout and exact source return focus at ${width}` : `selected exact versions, view-only periods/themes, note and Markdown at ${width}`, width, async page => {
      const f = await fixture(page); if (width === 390 && !layoutOnly) await take(page, report, 'empty', width);
      const picker = await details(page, '회고할 원문 선택');
      for (const id of f.selection) await picker.locator(`input[data-version-id="${id}"]`).check();
      await save(page); await picker.locator(':scope > summary').click();
      const storedSelection = await current(page); assert.deepEqual(storedSelection.workbench.reflection.versionIds, f.selection);
      assert.deepEqual(await page.locator('#wbReflectionReading [data-reflection-group]').evaluateAll(nodes => nodes.map(node => node.dataset.reflectionGroup)), ['2016', '2017', '2020', '2021', '2024', 'unknown']);
      assert.deepEqual(sorted(await page.locator('#wbReflectionReading [data-reflection-group="unknown"] .wb-source').evaluateAll(nodes => nodes.map(node => node.dataset.versionId))), sorted([f.refs.unknown.versionId, f.refs.invalid.versionId, f.refs.free.versionId]));
      assert.match(await row(page, f.refs.work.versionId).textContent(), /1\/2/); assert.match(await row(page, f.refs.latest.versionId).textContent(), /2\/2/);
      assert.match(await row(page, f.refs.reference.versionId).textContent(), /다른 사람의 기록/); assert.match(await row(page, f.refs.link.versionId).textContent(), /본문 미확보/);
      assert.equal(await row(page, f.refs.unselected.versionId).count(), 0);
      await row(page, f.refs.work.versionId).getByText('본문 읽기', { exact: true }).click(); assert.equal(await row(page, f.refs.work.versionId).locator('.wb-source-body').textContent(), oldBody); await take(page, report, 'chronology', width);
      if (layoutOnly) {
        if (width === 390) {
          await row(page, f.refs.work.versionId).getByRole('button', { name: '이 원문 버전 열기', exact: true }).click();
          await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), oldBody);
          await page.locator('#lifeSearchReturn').click(); await page.locator('#wbReflectionNote').waitFor();
          await assertReturnFocus(page, f.refs.work.versionId, '2016');
          assert.equal(await page.locator('#wbReflectionNote').inputValue(), initialNote); assert.deepEqual(await current(page), storedSelection);
          report.observations.push({ width, exactOldReaderAndReturn: true, sourceButtonFocusRestored: true, noteAndSelectionUnchanged: true });
        }
        return;
      }
      await period(page, '2016', '2017');
      const periodIds = [f.refs.work.versionId, f.refs.reference.versionId, f.refs.unknown.versionId, f.refs.invalid.versionId, f.refs.free.versionId];
      assert.deepEqual(sorted(await visibleIds(page)), sorted(periodIds)); assert.match(await page.locator('#wbReflectionSummary').textContent(), /기간 밖의 선택 자료 3개/);
      await page.locator('#wbReflectionThemes').click(); assert.equal(await page.locator('#wbReflectionThemes').getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await page.locator(`#wbReflectionReading [data-reflection-group="${f.groupIds.work}"] .wb-source`).evaluateAll(nodes => nodes.map(node => node.dataset.versionId)), [f.refs.work.versionId]);
      assert.equal(await page.locator(`[data-reflection-group="${f.groupIds.latest}"]`).count(), 0); assert.equal(await page.locator(`[data-reflection-group="${f.groupIds.excluded}"]`).count(), 0);
      assert.deepEqual(sorted(await visibleIds(page)), sorted(periodIds)); await save(page); assert.deepEqual(await current(page), storedSelection, 'View filters do not write or alter the persisted selection'); await take(page, report, 'themes-period', width);
      const note = initialNote + '\n\n지금 다시 읽으니 결과보다 선택의 조건을 설명하는 장이 필요하다.';
      await page.locator('#wbReflectionNote').fill(note); await row(page, f.refs.work.versionId).getByRole('button', { name: '이 원문 버전 열기', exact: true }).click();
      await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), oldBody);
      await page.locator('#lifeSearchReturn').click(); await page.locator('#wbReflectionNote').waitFor(); assert.equal(await page.locator('#wbReflectionNote').inputValue(), note); assert.equal(await page.locator('#wbReflectionThemes').getAttribute('aria-pressed'), 'true'); assert.equal(await page.locator('#wbReflectionFrom').inputValue(), '2016'); await assertReturnFocus(page, f.refs.work.versionId, f.groupIds.work);
      const promptBox = await details(page, '회고 질문을 원고에 추가'); assert.equal(await page.locator('#wbReflectionNote').inputValue(), note, 'Opening question choices does not modify the manuscript');
      const add = promptBox.getByRole('button', { name: '책의 목차 구상', exact: true }); if (width <= 820) await add.tap(); else { await add.focus(); await page.keyboard.press('Enter'); }
      const appended = await page.locator('#wbReflectionNote').inputValue(); assert(appended.startsWith(note + '\n\n')); assert(appended.includes('## 책의 목차 구상')); assert.equal(await page.locator('#wbReflectionNote').evaluate(el => document.activeElement === el && el.selectionStart === el.value.length), true); await save(page);
      await details(page, '원고 파일로 보관'); assert.equal(await page.locator('#wbReflectionIncludeSources').isChecked(), false);
      const metadataOnly = await download(page, '#wbReflectionExport'); assert.equal(metadataOnly.name, 'haedo-reflection.md'); assert(metadataOnly.text.includes(appended)); assert.equal((metadataOnly.text.match(/### 근거 /g) || []).length, 8);
      for (const spec of specs.filter(spec => spec.text)) assert(!metadataOnly.text.includes(spec.text), 'Default Markdown excludes original body: ' + spec.key);
      assert(!metadataOnly.text.includes(latestBody)); assert(metadataOnly.text.includes('2024-02-30')); assert(metadataOnly.text.includes('다른 사람의 기록')); assert(!metadataOnly.text.includes(specs.at(-1).title));
      await page.locator('#wbReflectionIncludeSources').check(); const originals = await download(page, '#wbReflectionExport');
      assert(originals.text.includes(oldBody)); assert(originals.text.includes(latestBody), 'The visible period does not silently narrow the chosen export scope');
      for (const spec of specs.slice(0, -1).filter(spec => spec.text)) assert(originals.text.includes(spec.text)); assert(!originals.text.includes(specs.at(-1).text)); assert(originals.text.includes('본문 미확보'));
      await fs.writeFile(path.join(out, `manuscript-metadata-${width}.md`), metadataOnly.text); await fs.writeFile(path.join(out, `manuscript-with-originals-${width}.md`), originals.text);
      assert.deepEqual((await current(page)).bundle, storedSelection.bundle); const saved = (await current(page)).workbench;
      await page.reload(); await ready(page); await page.locator('#wbReflectionNote').waitFor(); assert.equal(await page.locator('#wbReflectionNote').inputValue(), appended); assert.deepEqual((await current(page)).workbench, saved);
      assert.equal(await page.locator('#wbReflectionFrom').inputValue(), ''); assert.equal(await page.locator('#wbReflectionTo').inputValue(), ''); assert.equal(await page.locator('#wbReflectionTime').getAttribute('aria-pressed'), 'true'); assert.equal(await page.locator('#wbReflectionIncludeSources').isChecked(), false);
      report.observations.push({ width, selectedVersions: 8, filteredVisible: 5, unknownDatesVisible: 3, exactOldReaderAndReturn: true, noFilterPersistence: true, explicitQuestionAppend: true, defaultExportExcludesBodies: true, optInExportIncludesAllChosenExactBodies: true });
    });
    await check('invalid period recovery and failed note save preserve manuscript and prevent export or navigation', 390, async page => {
      const f = await fixture(page, true), baseline = await current(page);
      await period(page, '2025', '2010'); await page.locator('#wbError').waitFor({ state: 'visible' }); assert.deepEqual(sorted(await visibleIds(page)), sorted(f.selection)); assert.deepEqual(await current(page), baseline);
      await period(page, '2016', '2017'); await page.locator('#wbError').waitFor({ state: 'hidden' }); assert.equal((await visibleIds(page)).length, 5); assert.deepEqual(await current(page), baseline);
      await abortWorkbenchWrites(page, true); const note = initialNote + '\n저장이 실패해도 잃지 않을 원고 문장.'; await page.locator('#wbReflectionNote').fill(note);
      const prompts = await details(page, '회고 질문을 원고에 추가'); await prompts.getByRole('button', { name: '시간순 돌아보기', exact: true }).tap(); const draft = await page.locator('#wbReflectionNote').inputValue(); assert(draft.startsWith(note));
      const downloads = []; page.on('download', item => downloads.push(item.suggestedFilename())); await details(page, '원고 파일로 보관'); await page.locator('#wbReflectionExport').click();
      await page.waitForFunction(() => __wbAborted > 0 && document.querySelector('#wbReflectionExport')?.disabled === false && document.querySelector('#wbStatus')?.dataset.state === 'error');
      assert.equal(downloads.length, 0); assert.equal(await page.locator('#wbReflectionNote').inputValue(), draft); assert.deepEqual(await current(page), baseline);
      const aborts = await page.evaluate(() => __wbAborted); await row(page, f.refs.work.versionId).getByRole('button', { name: '이 원문 버전 열기', exact: true }).click();
      await page.waitForFunction(before => __wbAborted > before && [...document.querySelectorAll('#wbReflectionReading button')].every(button => !button.disabled), aborts);
      assert.equal(await page.locator('#lifeSourceText').count(), 0); assert.equal(await page.locator('#wbReflectionNote').inputValue(), draft); await take(page, report, 'save-error', 390);
      await abortWorkbenchWrites(page, false); await page.locator('#wbError').getByRole('button', { name: '다시 저장', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#wbStatus')?.dataset.state === 'saved');
      assert.equal((await current(page)).workbench.reflection.note, draft); assert.deepEqual((await current(page)).workbench.reflection.versionIds, f.selection); assert((await download(page, '#wbReflectionExport')).text.includes(draft)); assert.equal(downloads.length, 1);
    });
    await check('integrated backup restores exact reflection versions and manuscript into an independent local copy', 820, async page => {
      const f = await fixture(page, true); await period(page, '2016', '2017'); await page.locator('#wbReflectionThemes').click(); await go(page, 'workbench-backup');
      const before = await current(page), downloaded = await download(page, '#wbBackupDownload'), backup = JSON.parse(downloaded.text);
      assert.deepEqual(backup.workbench.reflection, before.workbench.reflection); assert.deepEqual(Object.keys(backup.workbench.reflection).sort(), ['note', 'versionIds']);
      await page.locator('#wbRestoreFile').setInputFiles({ name: '익명-회고-구성.json', mimeType: 'application/json', buffer: Buffer.from(downloaded.text) }); await page.locator('#wbRestoreInstall').waitFor(); await page.locator('#wbRestoreInstall').click();
      await page.waitForFunction(id => HaedoLife.Shell.storage.getActive().then(active => active !== id), f.workspaceId); await page.locator('.life-workbench[data-mode="page"]').waitFor();
      const copied = await current(page); assert.notEqual(copied.bundle.workspaceId, f.workspaceId); assert.equal(copied.workbench.reflection.note, initialNote); assert.equal(copied.workbench.reflection.versionIds.length, f.selection.length);
      const chosenTexts = copied.workbench.reflection.versionIds.map(id => copied.bundle.sourceVersions.find(version => version.id === id)?.contentText); assert(chosenTexts.includes(oldBody)); assert(chosenTexts.includes(latestBody)); assert(!chosenTexts.includes(specs.at(-1).text));
      assert(copied.workbench.reflection.versionIds.every(id => !f.selection.includes(id))); assert.equal(await page.evaluate(id => HaedoLife.Shell.storage.getSyncState(id), copied.bundle.workspaceId), null);
      const record = copied.bundle.records[0], ref = record.sourceRefs[0], version = copied.bundle.sourceVersions.find(version => version.id === ref.sourceVersionId); assert.equal(version.contentText.slice(ref.locator.start, ref.locator.end), record.text); assert.equal(version.contentText, oldBody);
      assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), f.workspaceId), before.bundle); await go(page); assert.equal(await page.locator('#wbReflectionNote').inputValue(), initialNote); assert.equal(await page.locator('#wbReflectionFrom').inputValue(), '');
      report.observations.push({ scene: 'backup', schemaUnchanged: true, remappedExactVersions: 8, oldExcerptPreserved: true, originalWorkspaceUnchanged: true, newCopyUnbound: true });
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

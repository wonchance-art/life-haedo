/* Large anonymous source corpus through actual app/SDK/account-scoped IndexedDB.
 * SEARCH_PHASE=before BASE_URL=http://127.0.0.1:4187 PW_MODULE_PATH=... node this-file
 * Linux Chromium only: simulated composition events are not Apple IME validation.
 */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4187';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, base, cloud, openManagement } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, observe, nav } = require('./unified-home-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const phase = process.env.SEARCH_PHASE || 'after';
const output = path.resolve(__dirname, '../.local/search-quality');
const oldQuote = '옛기억🌱구절';
const sizes = [{ width: 1440, height: 1000 }, ...(phase === 'before' ? [] : [{ width: 820, height: 1000 }]), { width: 390, height: 844 }];
const counts = (process.env.SEARCH_COUNTS || '100,1000').split(',').map(Number);
const twoFrames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
function ciFailure(label, error) {
  if (!process.env.GITHUB_ACTIONS) return;
  const escaped = String(error.stack || error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.error('::error title=Search browser ' + label + '::' + escaped);
}
async function seed(page, count) {
  return page.evaluate(async ({ count, oldQuote }) => {
    const storage = HaedoLife.Shell.storage, core = HaedoLife.Core;
    const bundle = await storage.read(await storage.getActive());
    const put = { sources: [], sourceVersions: [] };
    let first;
    for (let i = 0; i < count; i++) {
      const number = String(i + 1).padStart(4, '0');
      const paragraph = '전시를 보고 정원으로 걸었다. 창문으로 들어오는 빛과 나무 사이의 간격을 천천히 바라봤다. 사진을 찍은 뒤 벤치에 앉아 도록을 다시 읽으며 다음 주에 같은 길을 걸을 계획을 적었다.';
      const text = `익명 관찰 기록 ${number} 🌱\r\n` + Array.from({ length: 12 }, (_, j) => `${j + 1}번째 장면: ${paragraph}`).join('\r\n\r\n') + (i === 0 ? '\r\n' + oldQuote : '');
      const prepared = await core.prepareImport({ origin: i % 2 ? 'obsidian' : 'apple_notes', title: `전시와 정원에서 남긴 익명 관찰 ${number}`, text, coverage: 'full_text', authorRelation: 'self', forceSeparate: true }, bundle);
      put.sources.push(prepared.source); put.sourceVersions.push(prepared.version);
      if (i === 0) {
        first = { sourceId: prepared.source.id, oldVersionId: prepared.version.id, raw: text, offset: text.indexOf(oldQuote) };
        const local = { ...bundle, sources: [prepared.source], sourceVersions: [prepared.version] };
        const newer = await core.prepareImport({ origin: prepared.source.origin, title: prepared.source.title, text: '최신 버전은 정원에서 걷는 속도를 바꾼 관찰만 담았습니다.', coverage: 'full_text', authorRelation: 'self', existingSourceId: prepared.source.id }, local);
        put.sources[0] = newer.source; put.sourceVersions.push(newer.version); first.latestVersionId = newer.version.id;
      }
    }
    await storage.commitLocal({ operationId: core.id(), workspaceId: bundle.workspaceId, baseRevision: bundle.revision, changes: { put } });
    const stored = await storage.read(bundle.workspaceId);
    return { first, sourceCount: stored.sources.length, versionCount: stored.sourceVersions.length, bodyUtf16Units: stored.sourceVersions.reduce((sum, v) => sum + (v.contentText?.length || 0), 0) };
  }, { count, oldQuote });
}
async function measureInput(page, query) {
  assert.notEqual(await page.locator('#lifeSearch').inputValue(), query, 'Timing requires an actual input value change');
  await page.evaluate(query => {
    const input = document.querySelector('#lifeSearch');
    window.__searchInputMeasure = null;
    input.addEventListener('input', () => {
      const started = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.__searchInputMeasure = { query, inputToTwoFramesMs: performance.now() - started, cards: document.querySelectorAll('#lifeSearchResults article[data-version-id]').length, domElements: document.querySelectorAll('*').length, listElements: document.querySelectorAll('#lifeSearchResults *').length, scrollHeight: document.documentElement.scrollHeight, inputFocused: document.activeElement === input };
      }));
    }, { capture: true, once: true });
  }, query);
  await page.locator('#lifeSearch').fill(query);
  await page.waitForFunction(query => window.__searchInputMeasure?.query === query, query);
  return page.evaluate(() => __searchInputMeasure);
}
const cards = page => page.locator('#lifeSearchResults article[data-version-id]');
async function filters(page) {
  if (await page.locator('#lifeFilterToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#lifeFilterToggle').click();
}
async function activateMore(page, size) {
  if (size.width <= 820) await page.locator('#lifeSearchMore').tap();
  else { await page.locator('#lifeSearchMore').focus(); await page.keyboard.press('Enter'); }
  await twoFrames(page);
}
async function pagination(page, count, size, capture) {
  await measureInput(page, ''); await measureInput(page, '정원');
  assert.equal(await cards(page).count(), 40); assert.match(await page.locator('#lifeSearchCount').textContent(), new RegExp(`자료 ${count + 1}개.*40개 표시`));
  await page.locator('#lifeSelectionToggle').click(); await page.locator('.life-source-select').first().click();
  const first = cards(page).first(); const selectedVersion = await first.getAttribute('data-version-id');
  await first.locator('.life-result-info').click();
  await first.evaluate(el => { window.__firstSearchCard = el; window.__firstSearchInfo = el.querySelector('.life-result-details'); });
  await activateMore(page, size);
  assert.equal(await cards(page).count(), 80);
  assert.equal(await first.evaluate(el => el === window.__firstSearchCard && el.querySelector('.life-result-details') === window.__firstSearchInfo && !window.__firstSearchInfo.hidden), true, 'Append must preserve existing card and open information DOM');
  assert.equal(await page.locator(`.life-source-select[data-version-id="${selectedVersion}"]`).getAttribute('aria-pressed'), 'true');
  assert.equal(await cards(page).nth(40).locator('.life-source-open').evaluate(el => document.activeElement === el), true);
  const opened = cards(page).nth(60).locator('.life-source-open'); const version = await opened.getAttribute('data-version-id');
  await opened.evaluate(el => el.addEventListener('pointerdown', () => { window.__openSearchScroll = scrollY; }, { once: true }));
  await opened.click(); await page.locator('#lifeSourceText').waitFor();
  await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeSearch').waitFor(); await twoFrames(page);
  assert.equal(await cards(page).count(), 80); assert.equal(await page.locator('#lifeSearch').inputValue(), '정원');
  assert.equal(await page.locator(`.life-source-open[data-version-id="${version}"]`).evaluate(el => document.activeElement === el), true);
  assert.equal(await page.evaluate(() => Math.abs(scrollY - __openSearchScroll) <= 2), true);
  assert.equal(await page.locator(`.life-source-select[data-version-id="${selectedVersion}"]`).getAttribute('aria-pressed'), 'true');
  await capture('expanded-return');
  if (count === 100) { await activateMore(page, size); assert.equal(await cards(page).count(), 101); assert.equal(await page.locator('#lifeSearchMore').isHidden(), true); assert.doesNotMatch(await page.locator('#lifeSearchCount').textContent(), /개 표시/); }
  await measureInput(page, ''); assert.equal(await cards(page).count(), 40);
  await filters(page); await page.locator('#lifeOriginFilter').selectOption('obsidian'); assert.equal(await cards(page).count(), 40); assert.match(await page.locator('#lifeSearchCount').textContent(), new RegExp(`자료 ${count / 2}개`));
  await activateMore(page, size); assert.equal(await cards(page).count(), Math.min(80, count / 2));
  await page.locator('#lifeSearchSpacing').check(); assert.equal(await cards(page).count(), 40, 'Option change must reset the same query window');
  await page.locator('#lifeSearchSpacing').uncheck(); assert.equal(await cards(page).count(), 40);
  await page.locator('#lifeOriginFilter').selectOption(''); assert.equal(await cards(page).count(), 40);
  await measureInput(page, '이번측정에는없는문장'); assert.equal(await cards(page).count(), 0); assert.equal(await page.locator('#lifeSearchMore').isHidden(), true); assert.match(await page.locator('#lifeSearchResults').textContent(), /조건에 맞는 자료가 없습니다/);
  return { initial40: true, totalCountPreserved: true, appendKeepsExistingDomAndInformation: true, selectedVersionPreserved: true, firstNewRowFocused: true, expandedReturnQueryFocusScroll: true, queryFilterOptionReset40: true, lastBatchEnds: count === 100, emptyHidesMore: true };
}
async function spacingCases(page, capture) {
  // Tiny dedicated cases are added after performance measurements so before/after
  // timings use the identical 100/1000-source corpus, not synthetic note density.
  const refs = await page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core; let b = await s.read(await s.getActive()); const refs = [];
    const specs = [{ title: '여름 정원 메모', text: '제목만 띄어쓰기로 찾는 익명 자료입니다.' }, { title: '본문 검사 자료', text: '🌱\r\n가을 산책의 호흡을 천천히 기록했다.' }, { title: '내 메모 검사 자료', text: '메모 연결 구절을 남겼다.', note: '겨울 산책을 다시 떠올림' }];
    for (const spec of specs) {
      const p = await c.prepareImport({ origin: 'apple_notes', title: spec.title, text: spec.text, forceSeparate: true, coverage: 'full_text' }, b);
      await s.commitLocal({ operationId: c.id(), workspaceId: b.workspaceId, baseRevision: b.revision, changes: c.buildImportChanges(b, p, spec.note ? [{ start: 0, end: 9, topic: '익명 주제', note: spec.note }] : []) });
      refs.push({ sourceId: p.source.id, versionId: p.version.id, raw: spec.text }); b = await s.read(b.workspaceId);
    }
    return refs;
  });
  await page.reload(); await ready(page); await filters(page);
  const queries = ['여름정원메모', '가을산책의호흡', '겨울산책을다시떠올림'];
  for (const [index, query] of queries.entries()) {
    await page.locator('#lifeSearchSpacing').uncheck(); await measureInput(page, query); assert.equal(await cards(page).count(), 0);
    await page.locator('#lifeSearchSpacing').check(); await twoFrames(page); assert.equal(await cards(page).count(), 1);
    const row = cards(page).first(); assert.equal(await row.getAttribute('data-version-id'), refs[index].versionId);
    if (index === 1) {
      const quote = '가을 산책의 호흡'; assert.equal(await row.locator('mark').textContent(), quote); assert.equal(Number(await row.getAttribute('data-locator-start')), refs[index].raw.indexOf(quote));
      await row.locator('.life-source-open').click(); await page.locator('#lifeSourceText').waitFor(); await twoFrames(page); assert.equal(await page.evaluate(() => getSelection().toString()), quote); assert.equal(await page.locator('#lifeSourceText').textContent(), refs[index].raw);
      await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeSearch').waitFor(); await twoFrames(page); assert.equal(await page.locator('#lifeSearchSpacing').isChecked(), true);
      await capture('spacing-body');
    } else { assert.equal(await row.locator('mark').count(), 0); assert.equal(await row.getAttribute('data-locator-start'), null); }
    if (index === 2) { assert.equal(await row.getAttribute('data-matched-by'), 'note'); await row.locator('.life-source-open').click(); await page.locator('#lifeSourceText').waitFor(); await twoFrames(page); assert.equal(await page.evaluate(() => getSelection().isCollapsed), true); await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeSearch').waitFor(); }
    await page.locator('#lifeSearchSpacing').uncheck(); assert.equal(await cards(page).count(), 0);
  }
  await measureInput(page, ''); await page.getByRole('button', { name: '가져오기', exact: true }).click();
  await page.locator('#lifeImportTitle').fill('마지막에 보관한 익명 원문'); await page.locator('#lifeImportText').fill('새 원문은 최초 40개 표시 밖에서 보관되었다.');
  await page.getByRole('button', { name: '원문·출처 확인', exact: true }).click(); await settle(page);
  await page.locator('#lifeReviewText').evaluate(el => { el.focus(); el.setSelectionRange(0, 4); el.dispatchEvent(new Event('select', { bubbles: true })); });
  await page.getByRole('button', { name: '발췌 후보 추가', exact: true }).click(); await page.getByRole('button', { name: '선택한 발췌 모음에 반영', exact: true }).click(); await page.locator('#lifeSearch').waitFor();
  assert.equal(await cards(page).count(), 40); assert.equal(await page.locator('#lifeImportResultOpen').isVisible(), true);
  await page.locator('#lifeImportResultOpen').click(); await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), '새 원문은 최초 40개 표시 밖에서 보관되었다.');
  const savedVersion = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, b = await s.read(await s.getActive()); return b.sourceVersions.find(v => v.contentText === '새 원문은 최초 40개 표시 밖에서 보관되었다.').id; });
  await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeSearch').waitFor(); await twoFrames(page);
  assert.equal(await cards(page).count(), 104, 'Returning to an off-window saved version must reveal its batch');
  assert.equal(await page.locator('#lifeImportResultOpen').isVisible().catch(() => false), false);
  assert.equal(await page.locator(`.life-source-open[data-version-id="${savedVersion}"]`).evaluate(el => document.activeElement === el), true, 'Hidden receipt must fall back to its exact saved-version card');
  await capture('saved-outside-window');
  return { spacingOptInTitleBodyNote: true, bodyRawRangePreserved: true, titleNoteNoInventedLocator: true, optionRestoredOnReturn: true, savedOutside40RemainsReachable: true };
}
async function shiftedReturn(page, first) {
  await measureInput(page, '정원');
  const control = cards(page).nth(39).locator('.life-source-open'), versionId = await control.getAttribute('data-version-id');
  await control.click(); await page.locator('#lifeSourceText').waitFor(); const raw = await page.locator('#lifeSourceText').textContent();
  await page.evaluate(async first => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, b = await s.read(await s.getActive()), source = b.sources.find(item => item.id === first.sourceId);
    const p = await c.prepareImport({ origin: source.origin, title: source.title, text: '정원 기록에 새 버전을 보관하여 기존 검색 결과가 한 칸 밀렸다.', coverage: 'full_text', authorRelation: 'self', existingSourceId: source.id }, b);
    await s.commitLocal({ operationId: c.id(), workspaceId: b.workspaceId, baseRevision: b.revision, changes: c.buildImportChanges(b, p, []) });
  }, first);
  await page.getByRole('button', { name: '최신 내용 확인', exact: true }).click(); await settle(page); assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
  await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeSearch').waitFor(); await twoFrames(page);
  assert.equal(await cards(page).count(), 80);
  assert.equal(await cards(page).nth(40).getAttribute('data-version-id'), versionId);
  assert.equal(await page.locator(`.life-source-open[data-version-id="${versionId}"]`).evaluate(el => document.activeElement === el), true);
  return { refreshed40thHitMovesTo41stAndIsRevealedOnReturn: true };
}
async function scopes(page, server, device) {
  const original = await page.evaluate(() => HaedoLife.Shell.storage.getActive());
  // An actual query edit also resets the previously revealed receipt batch.
  if (await page.locator('#lifeSearch').inputValue() === '') await measureInput(page, '작업공간전환준비검색');
  await measureInput(page, '');
  await page.locator('#lifeSelectionToggle').click(); await page.locator('.life-source-select').first().click(); await page.locator('#lifeSearchMore').click();
  await filters(page); await page.locator('#lifeSearchSpacing').check();
  await openManagement(page); await page.getByRole('button', { name: '내보내기·사본 복원', exact: true }).click(); await page.locator('#lifeNewWorkspaceName').fill('익명 빈 작업공간');
  await page.getByRole('button', { name: '빈 작업공간 만들기', exact: true }).click(); await settle(page); await page.locator('#lifeSearch').waitFor();
  assert.notEqual(await page.evaluate(() => HaedoLife.Shell.storage.getActive()), original);
  assert.equal(await cards(page).count(), 0); assert.equal(await page.locator('#lifeSearch').inputValue(), ''); assert.equal(await page.locator('#lifeSearchSpacing').isChecked(), false); assert.equal(await page.locator('#lifeSelectionBar').isHidden(), true);
  await openManagement(page); await page.locator('#lifeWorkspace').selectOption(original); await settle(page); await page.locator('#lifeSearch').waitFor(); assert.equal(await cards(page).count(), 40); assert.equal(await page.locator('.life-source-select[aria-pressed="true"]').count(), 0); assert.equal(await page.locator('#lifeSelectionBar').isHidden(), true);
  await page.locator('#lifeSelectionToggle').click(); await page.locator('.life-source-select').first().click();
  await page.evaluate(() => { window.__searchLogout = HaedoAuth.client.auth.signOut({ scope: 'local' }); }); await page.waitForFunction(() => document.querySelector('#lifeApp').hidden && !HaedoLife.Shell.storage);
  server.oauthAccounts.set(device, accounts.b); await page.locator('[data-life-login]').click(); await page.locator('#googleLogin').click(); await page.waitForURL(u => u.pathname.endsWith('/index.html')); await ready(page); await nav(page, 'records');
  assert.equal(await cards(page).count(), 0); assert.equal(await page.locator('#lifeSearch').inputValue(), ''); assert.equal(await page.locator('#lifeSearchSpacing').isChecked(), false); assert.equal(await page.locator('#lifeSelectionBar').isHidden(), true);
  return { workspaceResetsWindowOptionQuerySelection: true, accountResetsPrivateSearchSelection: true };
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { phase, createdAt: new Date().toISOString(), base, browser: browser.version(), scope: 'Anonymous Auth HTTP; actual SDK/isolated IDB; Linux Chromium viewport and composition-event simulation only; no production or Apple claims', methodology: 'Batch fixture through existing prepareImport/commitLocal; seed cost excluded. Input event capture until second requestAnimationFrame measures app compute+render opportunity, not hardware latency. No timing threshold assertions on shared host.', checks: [], measurements: [], captures: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [], realRemoteWrites: 0 };
  const reportPath = path.join(output, `browser-${phase}-report.json`);
  const save = () => fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  async function capture(page, scene, count, size) {
    await page.evaluate(() => document.fonts.ready); await twoFrames(page);
    const file = `browser-${phase}-${scene}-${count}-${size.width}.png`;
    const metrics = await page.evaluate(inspect);
    metrics.smallTargets = metrics.smallTargets.filter(item => item.id !== 'lifeSourceText');
    await page.screenshot({ path: path.join(output, file) }); report.captures.push({ scene, count, width: size.width, file, metrics });
    if (phase !== 'before') { assert.equal(metrics.horizontalOverflow, false); for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ': ' + key); }
  }
  try {
    for (const count of counts) for (const size of sizes) {
      if (count !== 100 && size.width === 820) continue;
      if (process.env.SEARCH_SKIP_CASE === `${count}:${size.width}`) continue;
      if (process.env.SEARCH_WIDTH && size.width !== Number(process.env.SEARCH_WIDTH)) continue;
      const label = `${count} sources / ${size.width}px`, server = new FakeCloud();
      const device = 'large-search-' + count + '-' + size.width;
      const context = await makeContext(browser, server, device, accounts.a, { viewport: size, hasTouch: size.width <= 820 });
      await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback(); report.external.push({ check: label, origin: u.origin }); return route.abort('blockedbyclient'); });
      await context.addInitScript(() => { window.__searchLongTasks = []; try { new PerformanceObserver(list => { for (const item of list.getEntries()) __searchLongTasks.push({ startTime: item.startTime, duration: item.duration }); }).observe({ type: 'longtask', buffered: true }); } catch {} });
      const page = await context.newPage(); page.setDefaultTimeout(30000); observe(page, report, label);
      try {
        await page.goto(base + '/index.html?section=records'); await ready(page); await settle(page);
        const seeded = await seed(page, count); assert.equal(seeded.sourceCount, count); assert.equal(seeded.versionCount, count + 1);
        const start = Date.now(); await page.reload(); await ready(page); await settle(page); await page.locator('#lifeSearch').waitFor(); await twoFrames(page);
        const load = await page.evaluate(() => ({ cards: document.querySelectorAll('#lifeSearchResults article[data-version-id]').length, domElements: document.querySelectorAll('*').length, listElements: document.querySelectorAll('#lifeSearchResults *').length, scrollHeight: document.documentElement.scrollHeight, navigation: { domContentLoadedMs: performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd, loadEventMs: performance.getEntriesByType('navigation')[0]?.loadEventEnd }, longTasks: [...__searchLongTasks] }));
        load.reloadToReadyTwoFramesWallMs = Date.now() - start;
        assert.equal(load.cards, phase === 'before' ? count : 40);
        await capture(page, 'list', count, size);
        const common = [];
        for (let i = 0; i < 5; i++) {
          await measureInput(page, '이번측정에는없는문장');
          const sample = await measureInput(page, '정원'); assert.equal(sample.cards, phase === 'before' ? count + 1 : 40); assert.equal(sample.inputFocused, true); common.push(sample);
        }
        await capture(page, 'common', count, size);
        const rare = await measureInput(page, oldQuote); assert.equal(rare.cards, 1);
        const oldCard = page.locator(`#lifeSearchResults article[data-version-id="${seeded.first.oldVersionId}"]`);
        assert.equal(await oldCard.locator('mark').textContent(), oldQuote);
        assert.equal(Number(await oldCard.getAttribute('data-locator-start')), seeded.first.offset);
        const beforeReaderScroll = await page.evaluate(() => scrollY);
        await oldCard.getByRole('button', { name: /^자료 읽기/ }).click(); await page.locator('#lifeSourceText').waitFor(); await twoFrames(page);
        assert.equal(await page.locator('#lifeSourceText').textContent(), seeded.first.raw); assert.equal(await page.locator('#lifeVersion').inputValue(), seeded.first.oldVersionId);
        assert.equal(await page.evaluate(() => getSelection().toString()), oldQuote);
        await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeSearch').waitFor(); await twoFrames(page);
        assert.equal(await page.locator('#lifeSearch').inputValue(), oldQuote); assert.equal(await oldCard.getByRole('button', { name: /^자료 읽기/ }).evaluate(el => document.activeElement === el), true);
        const backScroll = await page.evaluate(() => scrollY); assert(Math.abs(backScroll - beforeReaderScroll) <= 2);
        await measureInput(page, '이번측정에는없는문장');
        await page.locator('#lifeSearch').evaluate(el => { el.focus(); el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); el.value = '정원'; el.dispatchEvent(new InputEvent('input', { bubbles: true, data: '정원', isComposing: true })); });
        assert.equal(await page.locator('#lifeSearchResults article[data-version-id]').count(), 0);
        await page.locator('#lifeSearch').dispatchEvent('compositionend'); await twoFrames(page);
        const compositionEndCards = await page.locator('#lifeSearchResults article[data-version-id]').count(); assert.equal(compositionEndCards, phase === 'before' ? count + 1 : 40);
        const performanceLongTasks = await page.evaluate(() => [...__searchLongTasks]);
        let regression = null;
        if (phase !== 'before') {
          regression = await pagination(page, count, size, scene => capture(page, scene, count, size));
          if (count === 100 && size.width === 820) Object.assign(regression, await shiftedReturn(page, seeded.first));
          if (count === 100) Object.assign(regression, await spacingCases(page, scene => capture(page, scene, count, size)));
          if (count === 100 && size.width === 820) Object.assign(regression, await scopes(page, server, device));
        }
        const timing = common.map(item => item.inputToTwoFramesMs).sort((a, b) => a - b);
        report.measurements.push({ count, width: size.width, fixture: { sourceCount: seeded.sourceCount, versionCount: seeded.versionCount, bodyUtf16Units: seeded.bodyUtf16Units }, load, common, commonMedianMs: timing[2], commonMaxMs: timing.at(-1), rare, exactOldVersion: true, rawUtf16Locator: true, backQueryFocusScroll: true, compositionIntermediateSuppressed: true, compositionEndCards, regression, longTasks: performanceLongTasks });
        assert.equal(server.writes().length, 0); report.checks.push({ name: label, pass: true }); await save();
        console.log(`PASS ${label}: list ${load.cards} cards / ${load.domElements} DOM elements; reload ${load.reloadToReadyTwoFramesWallMs}ms; common median ${timing[2].toFixed(1)}ms max ${timing.at(-1).toFixed(1)}ms`);
      } catch (error) { report.checks.push({ name: label, pass: false, error: error.stack }); console.error('FAIL ' + label + '\n' + error.stack); ciFailure(label, error); await page.screenshot({ path: path.join(output, `browser-${phase}-failure-${count}-${size.width}.png`) }).catch(() => {}); await save(); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); await save(); }
  if (!report.checks.length || report.checks.some(item => !item.pass) || report.consoleErrors.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
  console.log(`Search browser ${phase}: ${report.checks.filter(item => item.pass).length}/${report.checks.length}; ${report.captures.length} captures; console ${report.consoleErrors.length}; page ${report.pageErrors.length}.`);
}
if (require.main === module) main().catch(error => { console.error(error.stack); ciFailure('setup', error); process.exitCode = 1; });

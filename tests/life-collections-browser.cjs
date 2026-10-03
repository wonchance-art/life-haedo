/* Collection/import journeys through the real page, SDK and account-scoped IDB.
 * npm run dev; node tests/life-collections-browser.cjs
 * Auth HTTP is anonymous FakeCloud only. No production account or Apple hardware.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { FakeCloud, platformContext, base, cloud } = require('./life-sync-browser.cjs');

function playwright() {
  for (const candidate of [process.env.PW_MODULE_PATH, 'playwright', 'playwright-core', '/opt/codex/cua_node/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(candidate); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Set PW_MODULE_PATH to an existing Playwright installation.');
}
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Local anonymous server required');
const settle = page => page.waitForFunction(() => !document.querySelector('.life-app[aria-busy="true"]'));
async function click(page, name) { await page.getByRole('button', { name, exact: true }).click(); await settle(page); }
async function ready(page) {
  await page.waitForFunction(() => globalThis.HaedoLife?.Shell?.storage && !document.querySelector('#lifeApp').hidden);
  await page.evaluate(() => HaedoLife.Shell.ready);
}
const stored = page => page.evaluate(async () => HaedoLife.Shell.storage.read(await HaedoLife.Shell.storage.getActive()));
const rows = page => page.locator('#lifeSearchResults article[data-record-id]');
async function selectQuote(page, quote) {
  await page.locator('#lifeReviewText').evaluate((el, text) => {
    const start = el.value.indexOf(text); if (start < 0) throw new Error('Original quote not found in review');
    el.focus(); el.setSelectionRange(start, start + text.length); el.dispatchEvent(new Event('select', { bubbles: true }));
  }, quote);
}
async function openFilters(page) {
  const control = page.getByRole('button', { name: '검색 필터', exact: true });
  if (await control.getAttribute('aria-expanded') !== 'true') await control.click();
}
async function reviewFocus(page) {
  await page.waitForFunction(() => document.activeElement?.matches('#lifeMain > h2') && document.activeElement.textContent === '원문·출처 검토');
}
const quote = '함께 읽을 문장🌱';
const oldTexts = ['첫째 자료\r\n' + quote + '\r\n마지막 문장', '🌸 둘째 자료\r\n다시 ' + quote + ' 끝'];
async function seedCollections(page) {
  const data = await page.evaluate(async ({ quote, oldTexts }) => {
    const storage = HaedoLife.Shell.storage, core = HaedoLife.Core;
    let bundle = await storage.read(await storage.getActive()); const sources = [];
    for (let index = 0; index < 2; index++) {
      const source = { versions: [] };
      for (let version = 0; version < 2; version++) {
        const prepared = await core.prepareImport({ title: index ? 'Obsidian에서 다시 읽으며 연결한 두 번째 출처' : 'Apple 메모에서 보관한 첫 번째 출처',
          origin: index ? 'obsidian' : 'apple_notes', text: version ? '최신 원문에는 다른 내용만 있습니다. ' + index : oldTexts[index],
          ...(source.id ? { existingSourceId: source.id } : { forceSeparate: true }) }, bundle);
        prepared.version.importedAt = `2026-10-0${version + 1}T09:00:00.000Z`;
        const result = await storage.commitLocal({ operationId: core.id(), workspaceId: bundle.workspaceId, baseRevision: bundle.revision,
          changes: core.buildImportChanges(bundle, prepared, []) });
        if (result.status !== 'stored') throw new Error('Fixture source failed to save');
        source.id = prepared.source.id; source.versions.push(prepared.version.id); bundle = await storage.read(bundle.workspaceId);
      }
      sources.push(source);
    }
    const ref = index => ({ sourceId: sources[index].id, sourceVersionId: sources[index].versions[0],
      locator: { start: oldTexts[index].indexOf(quote), end: oldTexts[index].indexOf(quote) + quote.length } });
    const now = '2026-10-03T09:00:00.000Z';
    const record = (topic, refs, note = '') => ({ id: core.id(), kind: 'excerpt', text: quote, topic, note, sourceRefs: refs,
      provenance: { kind: 'user' }, revision: 1, createdAt: now, updatedAt: now });
    const multi = record('출처 연결', [ref(0), ref(1)], '서로 다른 두 원문의 이전 버전을 함께 읽습니다.');
    const records = [multi, record('', [ref(0)]), record('', [ref(1)]), record('주제 없음', [ref(0)]), record('모든 주제', [ref(0)])];
    for (let index = 1; index <= 24; index++) records.push(record('긴 주제 이름으로 분류한 읽기 기록 ' + String(index).padStart(2, '0'), [ref(0)]));
    const result = await storage.commitLocal({ operationId: core.id(), workspaceId: bundle.workspaceId, baseRevision: bundle.revision, changes: { put: { records } } });
    if (result.status !== 'stored') throw new Error('Fixture collection failed to save');
    return { sources, multi: multi.id, unassigned: records.slice(1, 3).map(item => item.id), reserved: records[3].id, total: records.length };
  }, { quote, oldTexts });
  await page.reload(); await ready(page); return data;
}

async function main() {
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const server = new FakeCloud(), report = { checks: [], consoleErrors: [], pageErrors: [], blockedRequests: [], realRemoteWrites: 0 };
  async function check(name, run) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 820, height: 1000 } });
    try {
      await platformContext(context, server, 'collections-' + report.checks.length);
      await context.route('**/*', route => {
        if ([new URL(base).origin, cloud].includes(new URL(route.request().url()).origin)) return route.fallback();
        report.blockedRequests.push(new URL(route.request().url()).origin); return route.abort('blockedbyclient');
      });
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ check: name, message: event.text() }); });
      page.on('pageerror', error => report.pageErrors.push({ check: name, message: error.message }));
      await page.goto(base + '/life.html'); await ready(page); await run(page);
      assert.equal(server.writes().length, 0, 'UI journey must not opt into remote upload');
      report.checks.push({ name, pass: true }); console.log('PASS ' + name);
    } catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
    finally { await context.close(); }
  }
  try {
    await check('import method switches preserve the same draft and never silently commit or discard its body', async page => {
      const raw = '방법을 바꾸어도 남아야 할 익명 본문 🌱';
      await click(page, '가져오기'); await page.locator('#lifeImportTitle').fill('방식 전환 초안'); await page.locator('#lifeImportText').fill(raw);
      await click(page, '텍스트 파일'); assert.equal(await page.locator('#lifeImportText').inputValue(), raw);
      await click(page, '링크 보관'); await page.locator('#lifeImportUrl').fill('https://example.invalid/anonymous-source');
      assert.match(await page.locator('#lifeImportForm').innerText(), /기존 본문.*함께 보관/);
      assert.equal(await page.locator('#lifeImportText').inputValue(), raw);
      await click(page, '본문 확인'); assert.ok(await page.locator('#lifeImportText').isVisible());
      await click(page, '검토 내용 보관');
      const stages = await page.evaluate(async () => HaedoLife.Shell.storage.listStages(await HaedoLife.Shell.storage.getActive()));
      assert.equal(stages.length, 1); assert.equal(stages[0].input.text, raw); assert.equal(stages[0].input.url, 'https://example.invalid/anonymous-source');
      const bundle = await stored(page); assert.equal(bundle.sources.length, 0); assert.equal(bundle.records.length, 0);
      await click(page, '링크 보관'); await click(page, '원문·출처 확인');
      assert.equal(await page.locator('#lifeReviewText').inputValue(), raw, 'hidden original body was dropped by link mode');
      assert.equal(await page.locator('#lifeImportForm').isHidden(), true);
      await click(page, '자료만 보관');
      const saved = await stored(page); assert.equal(saved.sourceVersions[0].contentText, raw); assert.notEqual(saved.sourceVersions[0].coverage.status, 'link_only');
    });
    await check('an empty-body link preview and commit agree on unavailable body and keep no invented excerpt', async page => {
      await click(page, '가져오기'); await click(page, '링크 보관');
      await page.locator('#lifeImportTitle').fill('본문 없는 익명 링크'); await page.locator('#lifeImportUrl').fill('https://example.invalid/link-only');
      await click(page, '원문·출처 확인');
      assert.equal(await page.locator('#lifeReviewText').count(), 0); assert.match(await page.locator('.life-review').innerText(), /본문 미확보/);
      assert.equal((await stored(page)).sources.length, 0);
      await click(page, '자료만 보관');
      const bundle = await stored(page); assert.equal(bundle.sourceVersions[0].contentText, null); assert.equal(bundle.sourceVersions[0].coverage.status, 'link_only'); assert.equal(bundle.records.length, 0);
    });
    await check('review input editing retains exact candidate and note for metadata-only changes, then commits once', async page => {
      const raw = '앞 문장\n메타정보를 바꾸어도 남는 구절🌱\n끝 문장', selected = '메타정보를 바꾸어도 남는 구절🌱';
      await click(page, '가져오기'); await page.locator('#lifeImportTitle').fill('확인 전 제목'); await page.locator('#lifeImportText').fill(raw);
      await click(page, '원문·출처 확인'); await reviewFocus(page);
      await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'lifeImportEdit');
      await page.keyboard.press('Enter'); await settle(page);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'lifeImportTitle');
      await click(page, '원문·출처 확인'); await reviewFocus(page);
      await selectQuote(page, selected); await page.locator('#lifeExcerptTopic').fill('이어 읽기'); await page.locator('#lifeExcerptNote').fill('제목을 바꾸어도 유지할 메모');
      await click(page, '발췌 후보 추가');
      await page.waitForFunction(() => document.activeElement.id === 'lifeDraftExcerpts');
      assert.equal(await page.locator('#lifeDraftExcerpts').getAttribute('aria-label'), '발췌 후보 1개');
      await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.textContent), '후보 제거');
      await click(page, '입력 수정'); assert.equal(await page.evaluate(() => document.activeElement.id), 'lifeImportTitle');
      assert.equal(await page.locator('.life-review').count(), 0); assert.equal(await page.getByRole('button', { name: '선택한 발췌 모음에 반영', exact: true }).count(), 0);
      await page.locator('#lifeImportTitle').fill('출처를 확인한 제목'); await click(page, '원문·출처 확인'); await reviewFocus(page);
      assert.match(await page.locator('.life-draft-excerpts').innerText(), /제목을 바꾸어도 유지할 메모/);
      assert.equal(await page.locator('.life-draft-excerpts blockquote').innerText(), selected); assert.equal((await stored(page)).records.length, 0);
      await click(page, '선택한 발췌 모음에 반영');
      const bundle = await stored(page); assert.equal(bundle.sources.length, 1); assert.equal(bundle.sourceVersions.length, 1); assert.equal(bundle.records.length, 1);
      assert.equal(bundle.sources[0].title, '출처를 확인한 제목'); assert.equal(bundle.records[0].note, '제목을 바꾸어도 유지할 메모');
      assert.deepEqual(bundle.records[0].sourceRefs[0].locator, { start: raw.indexOf(selected), end: raw.indexOf(selected) + selected.length });
      assert.equal(bundle.sourceVersions[0].contentText, raw);
      await page.reload(); await ready(page); assert.equal((await stored(page)).records.length, 1);
    });
    await check('unassigned filtering is distinct from named reserved topics and survives zero-result recovery', async page => {
      const ids = await seedCollections(page); assert.equal(await rows(page).count(), ids.total); await openFilters(page);
      const unassigned = page.locator('[data-topic-kind="unassigned"]');
      assert.match(await unassigned.getAttribute('aria-description'), /2/); await unassigned.click();
      assert.deepEqual(await rows(page).evaluateAll(items => items.map(item => item.dataset.recordId).sort()), [...ids.unassigned].sort());
      await page.locator('#lifeSearch').fill('절대일치하지않는문장'); assert.equal(await rows(page).count(), 0); assert.match(await page.locator('#lifeSearchCount').innerText(), /0개/);
      await click(page, '검색·필터 초기화'); assert.equal(await page.locator('#lifeSearch').inputValue(), ''); assert.equal(await rows(page).count(), ids.total);
      await openFilters(page); await page.locator('[data-topic-kind="named"][data-topic-name="주제 없음"]').click();
      assert.deepEqual(await rows(page).evaluateAll(items => items.map(item => item.dataset.recordId)), [ids.reserved]);
      assert.equal(await page.locator('[data-topic-kind="named"][data-topic-name="주제 없음"]').getAttribute('aria-pressed'), 'true');
      await click(page, '필터 해제'); assert.equal(await rows(page).count(), ids.total);
      await openFilters(page); await page.locator('#lifeTopicSearch').fill('읽기 기록 24');
      assert.equal(await page.locator('[data-topic-kind="named"]:visible').count(), 1); assert.equal(await rows(page).count(), ids.total, 'finding a topic implicitly filtered records');
      await page.locator('[data-topic-kind="named"][data-topic-name$="24"]').click(); assert.equal(await rows(page).count(), 1);
    });
    await check('each source action opens its exact older version and restores the collection context', async page => {
      const ids = await seedCollections(page); await page.locator('#lifeSearch').fill('서로 다른 두 원문');
      for (let index = 0; index < 2; index++) {
        const card = page.locator('article[data-record-id="' + ids.multi + '"]');
        const open = card.locator('button[data-ref-index="' + index + '"]');
        if (!(await open.isVisible())) await open.locator('xpath=ancestor::details[1]').locator('summary').click();
        assert.match(await card.innerText(), /이전 버전/);
        const focusKey = await open.getAttribute('data-focus-key'); await open.click(); await settle(page);
        assert.equal(await page.locator('#lifeVersion').inputValue(), ids.sources[index].versions[0]);
        assert.equal(await page.locator('#lifeSourceText').textContent(), oldTexts[index]);
        await page.waitForFunction(expected => getSelection().toString() === expected, quote);
        await page.locator('#lifeSearchReturn').click(); await settle(page);
        assert.equal(await page.locator('#lifeSearch').inputValue(), '서로 다른 두 원문');
        await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, focusKey);
      }
    });
    await check('collapsed excerpt management cancels removal unchanged and confirmed removal keeps all original versions', async page => {
      const ids = await seedCollections(page), before = await stored(page);
      const card = page.locator('article[data-record-id="' + ids.multi + '"]');
      const remove = card.getByRole('button', { name: '발췌 제거', exact: true });
      assert.ok(await remove.isHidden()); await card.locator('details.life-excerpt-manage summary').click();
      page.once('dialog', dialog => dialog.dismiss()); await remove.click(); await settle(page);
      assert.deepEqual(await stored(page), before, 'cancelled removal modified the stored workspace');
      page.once('dialog', dialog => dialog.accept()); await remove.click(); await settle(page);
      const after = await stored(page); assert.equal(after.records.length, before.records.length - 1); assert.ok(!after.records.some(record => record.id === ids.multi));
      assert.deepEqual(after.sources, before.sources); assert.deepEqual(after.sourceVersions, before.sourceVersions);
      assert.ok(after.tombstones.some(item => item.entityType === 'record' && item.entityId === ids.multi));
      await page.reload(); await ready(page); assert.deepEqual((await stored(page)).sourceVersions, before.sourceVersions);
    });
  } finally {
    report.capturedAt = new Date().toISOString(); report.browser = browser.version();
    await fs.mkdir('.local', { recursive: true }); await fs.writeFile('.local/life-collections-report.json', JSON.stringify(report, null, 2) + '\n');
    await browser.close();
  }
  const failed = report.checks.filter(item => !item.pass).length;
  console.log(JSON.stringify({ passed: report.checks.length - failed, failed, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, blockedRequests: report.blockedRequests.length, realRemoteWrites: 0 }));
  if (failed || report.consoleErrors.length || report.pageErrors.length || report.blockedRequests.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

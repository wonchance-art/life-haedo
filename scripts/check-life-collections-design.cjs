/* Collections/import visual audit with existing anonymous design samples.
 * npm run dev; node scripts/check-life-collections-design.cjs
 * Uses packaged Auth SDK + intercepted HTTP + account-scoped IndexedDB.
 * No real Supabase, production records, external font downloads or Apple device claims.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, platformContext, cloud, base } = require('../tests/life-sync-browser.cjs');
const { inspect } = require('./check-life-design.cjs');
require('../assets/design-review/sample-data.js');
const design = globalThis.HaedoDesignData;
const samples = [0, 1, 2, 4, 5, 10].map(index => design.sources[index]);
const quote = design.excerpt;
const subjects = ['읽기와 기록', '걷기와 관찰', '자료 연결', '원문과 출처', '동네 도서관', '느리게 읽기', '문장과 기억', '메모 습관', '생각의 변화', '함께 읽기', '', '주제 없음'];
const importText = '퇴근길에 작은 도서관에 들렀다. 읽지 못한 책을 더 빌리기보다, 지난주에 고른 한 문단을 천천히 다시 읽었다.\r\n\r\n좋았던 문장을 저장한 이유도 함께 남기고 싶다. 원문을 대신하는 요약을 만들기보다, 나중에 같은 자리로 돌아올 수 있는 단서를 적어 두기로 했다.\r\n\r\n다음에는 산책 메모와 같은 주제로 묶어 비교해 보자.';
const importTitle = '다시 읽고 싶은 문장을 저장한 이유와 산책 중 떠오른 질문을 연결해 보는 작은 읽기 기록';
const root = path.resolve(__dirname, '..');
const out = path.join(root, '.local/design-review/collections');
const evidence = path.join(root, 'docs/design-review/evidence/collections');
const sizes = [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'tablet', width: 820, height: 1000 }, { name: 'phone', width: 390, height: 844 }];
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Only a local server is permitted');
function playwright() {
  for (const module of [process.env.PW_MODULE_PATH, 'playwright', 'playwright-core', '/opt/codex/cua_node/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(module); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Set PW_MODULE_PATH to an existing Playwright installation.');
}
const settle = page => page.waitForFunction(() => !document.querySelector('.life-app[aria-busy="true"]'));
async function ready(page) {
  await page.waitForFunction(() => globalThis.HaedoLife?.Shell?.storage && !document.querySelector('#lifeApp').hidden);
  await page.evaluate(() => HaedoLife.Shell.ready);
}
async function click(page, name) { await page.getByRole('button', { name, exact: true }).click(); await settle(page); }
async function seed(page) {
  const result = await page.evaluate(async ({ samples, subjects, quote }) => {
    const core = HaedoLife.Core, storage = HaedoLife.Shell.storage;
    let bundle = await storage.read(await storage.getActive()); const sources = [];
    for (let index = 0; index < samples.length; index++) {
      const sample = samples[index];
      const raw = sample.paragraphs.join('\r\n\r\n') + (index === 3 ? '\r\n\r\n다른 메모에서 다시 인용한 문장: ' + quote : '');
      const prepared = await core.prepareImport({ origin: sample.origin.replaceAll('-', '_'), title: sample.title, text: raw,
        url: sample.url, forceSeparate: true, coverage: { status: sample.coverage === 'full' ? 'full_text' : 'partial', omissions: ['사진과 첨부 파일은 포함하지 않음'] } }, bundle);
      prepared.version.importedAt = '2026-10-03T09:30:00.000Z';
      await storage.commitLocal({ operationId: core.id(), workspaceId: bundle.workspaceId, baseRevision: bundle.revision, changes: core.buildImportChanges(bundle, prepared, []) });
      sources.push({ sourceId: prepared.source.id, sourceVersionId: prepared.version.id, raw });
      bundle = await storage.read(bundle.workspaceId);
    }
    const now = '2026-10-03T09:30:00.000Z';
    const records = subjects.map((topic, index) => {
      const source = sources[index % sources.length], sample = samples[index % samples.length];
      const paragraph = sample.paragraphs[Math.floor(index / sources.length) % sample.paragraphs.length];
      const text = index === 0 ? quote : paragraph.slice(0, paragraph.indexOf('.') + 1 || paragraph.length);
      const refs = (index === 0 ? [source, sources[3]] : [source]).map(item => ({ sourceId: item.sourceId, sourceVersionId: item.sourceVersionId,
        locator: { start: item.raw.indexOf(text), end: item.raw.indexOf(text) + text.length } }));
      return { id: core.id(), kind: 'excerpt', text, topic, note: index === 0 ? '문장을 더 모으기 전에, 왜 이 문장으로 돌아오고 싶은지 먼저 적어 두기. 산책 뒤의 메모와 나란히 읽어 보자.' : sample.summary,
        sourceRefs: refs, provenance: { kind: 'user' }, revision: 1, createdAt: now, updatedAt: now };
    });
    await storage.commitLocal({ operationId: core.id(), workspaceId: bundle.workspaceId, baseRevision: bundle.revision, changes: { put: { records } } });
    return { sources, records };
  }, { samples, subjects, quote });
  await page.reload(); await ready(page); return result;
}
async function main() {
  await fs.mkdir(out, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const server = new FakeCloud();
  const report = { capturedAt: new Date().toISOString(), browser: browser.version(), platform: 'Linux Chromium viewport simulation; Apple hardware/IME/Files/VoiceOver not verified',
    fixtures: 'Six existing anonymous proposal sources, twelve excerpts; eleven named topics including a literal 주제 없음 plus one unassigned record; one two-source excerpt',
    authentication: 'Packaged SDK with local FakeCloud interception', checks: [], captures: [], errors: [], consoleErrors: [], pageErrors: [], external: [], realRemoteWrites: 0 };
  const check = (name, pass, detail) => report.checks.push({ name, pass, ...(detail === undefined ? {} : { detail }) });
  async function capture(page, scene, size, committed = false) {
    await page.evaluate(() => document.fonts.ready);
    const metrics = await page.evaluate(inspect), file = scene + '-' + size.name + '.png';
    await page.screenshot({ path: path.join(out, file) });
    if (committed) await fs.copyFile(path.join(out, file), path.join(evidence, file));
    report.captures.push({ scene, size, file, committed, ...metrics });
    for (const [label, pass, detail] of [['no horizontal overflow', !metrics.horizontalOverflow], ['text contrast', !metrics.contrastFailures.length, metrics.contrastFailures],
      ['44px targets', !metrics.smallTargets.length, metrics.smallTargets], ['named controls', !metrics.unnamed.length, metrics.unnamed], ['16px inputs', !metrics.smallInputs.length, metrics.smallInputs]]) check(size.name + ' ' + scene + ': ' + label, pass, detail);
  }
  async function contextFor(size) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.width <= 820, serviceWorkers: 'block' });
    await platformContext(context, server, 'collections-visual-' + size.name);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(base).origin || url.origin === cloud || ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'].includes(url.hostname)) return route.fallback();
      report.external.push(url.hostname); return route.abort('blockedbyclient');
    });
    return context;
  }
  async function filter(page, open) {
    const button = page.locator('#lifeFilterToggle');
    if (await button.getAttribute('aria-expanded') !== String(open)) {
      if (page.viewportSize().width <= 820) await button.tap(); else await button.click();
    }
    assert.equal(await page.locator('#lifeSearchFilters').isVisible(), open);
  }
  async function clean(page) { await page.evaluate(() => document.activeElement.blur()); await page.mouse.move(page.viewportSize().width / 2, 10); }
  const counts = page => page.evaluate(async () => {
    const b = await HaedoLife.Shell.storage.read(await HaedoLife.Shell.storage.getActive()); return { sources: b.sources.length, records: b.records.length };
  });
  try {
    for (const size of sizes) {
      const context = await contextFor(size), page = await context.newPage(); page.setDefaultTimeout(12000);
      page.on('pageerror', error => report.pageErrors.push({ size: size.name, message: error.message }));
      page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ size: size.name, message: message.text() }); });
      try {
        await page.goto(base + '/life.html'); await ready(page); await capture(page, 'empty', size);
        const seeded = await seed(page); await clean(page); await capture(page, 'collections', size, true);
        assert.equal(await page.locator('.life-excerpt-card').count(), 12);
        await filter(page, true); await capture(page, 'topics', size, size.name === 'tablet');
        assert.equal(await page.locator('#lifeTopicSearch').isVisible(), true);
        await page.locator('#lifeTopicSearch').fill('읽기');
        check(size.name + ' topic name search has matching choices', await page.locator('.life-topic-list button').count() > 0);
        await page.locator('#lifeTopicSearch').fill('');
        await page.locator('[data-topic-kind="unassigned"]').click();
        assert.equal(await page.locator('.life-excerpt-card').count(), 1);
        await filter(page, false); await capture(page, 'unassigned', size);
        await filter(page, true);
        await click(page, '필터 해제'); assert.equal(await page.locator('.life-excerpt-card').count(), 12);
        await filter(page, false);
        await page.locator('#lifeSearch').fill('존재하지않는검증문장'); await capture(page, 'no-results', size);
        await click(page, '검색·필터 초기화'); assert.equal(await page.locator('.life-excerpt-card').count(), 12);
        const card = page.locator('.life-excerpt-card').first();
        assert.equal(await card.locator('.life-source-refs button').count(), 2);
        const manage = card.locator('summary').filter({ hasText: '발췌 관리' });
        await card.locator('.life-source-refs button').last().focus(); await page.keyboard.press('Tab');
        assert.equal(await manage.evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Enter');
        assert.equal(await card.getByRole('button', { name: '발췌 제거', exact: true }).isVisible(), true);
        await capture(page, 'excerpt-management', size);
        const focus = (await page.evaluate(inspect)).focus;
        check(size.name + ' excerpt management keyboard focus', focus.visible && focus.width >= 3 && focus.contrast >= 3, focus);
        check(size.name + ' focused excerpt control stays above fixed mobile navigation', await manage.evaluate(el => {
          if (innerWidth > 700) return true;
          const css = getComputedStyle(el), ring = parseFloat(css.outlineWidth) + parseFloat(css.outlineOffset);
          return el.getBoundingClientRect().bottom + ring + 8 <= document.querySelector('.life-nav').getBoundingClientRect().top;
        }));
        await page.keyboard.press('Space');
        assert.equal(await card.getByRole('button', { name: '발췌 제거', exact: true }).isHidden(), true);
        await card.locator('.life-source-refs button').first().click(); await settle(page);
        await page.waitForFunction(expected => getSelection().toString() === expected, quote);
        assert.equal(await page.locator('#lifeSourceText').textContent(), seeded.sources[0].raw);
        await page.locator('#lifeSearchReturn').click(); await settle(page);
        await click(page, '가져오기'); await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await clean(page);
        await capture(page, 'import-choice', size, true);
        await click(page, '본문 붙여넣기');
        await page.locator('#lifeImportTitle').fill(importTitle); await page.locator('#lifeImportText').fill(importText);
        await page.locator('#lifeImportText').scrollIntoViewIfNeeded(); await capture(page, 'draft', size);
        await click(page, '텍스트 파일');
        await page.locator('#lifeImportFile').setInputFiles({ name: '인코딩-확인이-필요한-메모.txt', mimeType: 'text/plain', buffer: Buffer.from([0xc3, 0x28]) }); await settle(page);
        await page.locator('#lifeError').scrollIntoViewIfNeeded(); await capture(page, 'import-error', size);
        await click(page, '본문 붙여넣기');
        assert.equal(await page.locator('#lifeImportText').inputValue(), importText.replace(/\r\n/g, '\n'));
        await click(page, '원문·출처 확인');
        assert.equal(await page.locator('#lifeImportForm').isHidden(), true);
        await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await clean(page); await capture(page, 'review', size, size.name !== 'tablet');
        assert.deepEqual(await counts(page), { sources: 6, records: 12 });
        await click(page, '입력 수정');
        assert.equal(await page.locator('#lifeImportText').inputValue(), importText.replace(/\r\n/g, '\n'));
        await click(page, '링크 보관'); await capture(page, 'link', size);
        await click(page, '텍스트 파일');
        if (!await page.locator('#lifeBatchPicker').evaluate(el => el.open)) await page.locator('#lifeBatchPicker summary').click();
        // Hold one synthetic File read to inspect the real pending batch UI.
        await page.evaluate(() => {
          const original = File.prototype.arrayBuffer;
          let release; const pending = new Promise(resolve => { release = resolve; });
          File.prototype.arrayBuffer = function () { return this.name.startsWith('산책-후-') ? pending.then(() => original.call(this)) : original.call(this); };
          globalThis.__releaseCollectionFileRead = () => { File.prototype.arrayBuffer = original; release(); delete globalThis.__releaseCollectionFileRead; };
        });
        await page.locator('#lifeBatchFiles').setInputFiles([
          { name: '산책-후-다시-읽고-싶은-문장과-출처를-정리한-긴-제목의-익명-메모.md', mimeType: 'text/markdown', buffer: Buffer.from(importText) },
          { name: '다시-인코딩할-메모.txt', mimeType: 'text/plain', buffer: Buffer.from([0xc3, 0x28]) },
          { name: '아직-내용이-없는-메모.txt', mimeType: 'text/plain', buffer: Buffer.from('') }
        ]);
        await page.locator('#lifeBatchList [data-batch-state="reading"]').waitFor();
        await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await capture(page, 'batch-reading', size);
        await page.evaluate(() => __releaseCollectionFileRead());
        await page.waitForFunction(() => document.querySelector('#lifeBatchList') && !document.querySelector('#lifeBatchList [data-batch-state="reading"], #lifeBatchList [data-batch-state="saving"], #lifeBatchList [data-batch-state="unread"]'));
        await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await clean(page); await capture(page, 'batch', size, size.name === 'phone');
        assert.equal(await page.locator('#lifeBatchList [data-batch-state="failed"]').count(), 1);
        assert.equal(await page.locator('#lifeBatchList [data-batch-state="draft"]').count(), 2);
        assert.deepEqual(await counts(page), { sources: 6, records: 12 });
        check(size.name + ' selection/import/review remain uncommitted', true);
      } catch (error) { report.errors.push({ size: size.name, message: error.message }); }
      finally { await context.close(); }
    }
    check('no console errors', !report.consoleErrors.length, report.consoleErrors);
    check('no page errors', !report.pageErrors.length, report.pageErrors);
    check('no unexpected external requests', !report.external.length, report.external);
    check('no synthetic remote writes', !server.writes().length);
  } finally {
    await browser.close(); report.syntheticRemoteWrites = server.writes().length;
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  const failed = report.checks.filter(item => !item.pass);
  console.log(JSON.stringify({ captures: report.captures.length, committed: report.captures.filter(item => item.committed).length, passed: report.checks.length - failed.length,
    failed, errors: report.errors, report: '.local/design-review/collections/report.json' }, null, 2));
  if (failed.length || report.errors.length) process.exitCode = 1;
}
module.exports = { seed, samples, subjects, importText, importTitle };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

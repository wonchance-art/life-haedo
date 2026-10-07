/* Private page expression B: actual application, bundled SDK and IndexedDB.
 * BASE_URL=http://127.0.0.1:4184 node tests/page-expression-browser.cjs
 * All accounts/HTTP/content are synthetic. Viewports/touch are Chromium
 * simulations, not Apple hardware, native IME or production publication. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, observe } = require('./unified-home-browser.cjs');
const { current, abortWorkbenchWrites } = require('./life-workbench-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const out = path.resolve('.local/page-expression');
const clone = value => JSON.parse(JSON.stringify(value));
const frames = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
function ciFailure(error) {
  if (process.env.GITHUB_ACTIONS) console.error('::error title=Private page expression::' + String(error.stack || error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'));
}

// Only the two owner RPCs used by this focused test are implemented. Auth and
// private sync retain the existing FakeCloud's real bundled SDK interception.
class PublicationCloud extends FakeCloud {
  constructor() { super(); this.publicPage = null; this.publicationWrites = []; }
  async handle(route, device) {
    const request = route.request(), rpc = new URL(request.url()).pathname.split('/').at(-1);
    if (!rpc.startsWith('life_public_page_')) return super.handle(route, device);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'content-type': 'application/json', 'cache-control': 'no-store, max-age=0' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    assert.equal(request.method(), 'POST');
    const token = request.headers().authorization?.replace(/^Bearer /i, '');
    assert.equal(JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub, accounts.a.id);
    const payload = request.postDataJSON(); let result;
    if (rpc === 'life_public_page_get') result = this.publicPage ? clone(this.publicPage.metadata) : { status: 'missing', revision: 0, publicId: null, updatedAt: null, lastOperationId: null };
    else {
      assert.equal(rpc, 'life_public_page_put'); assert.equal(payload.p_action, 'publish');
      assert.equal(payload.p_expected_revision, this.publicPage?.metadata.revision || 0);
      this.publicationWrites.push(clone(payload));
      const metadata = { status: 'published', revision: payload.p_expected_revision + 1, publicId: '33333333-3333-4333-8333-000000000001', updatedAt: new Date().toISOString(), lastOperationId: payload.p_operation_id };
      this.publicPage = { metadata, snapshot: clone(payload.p_snapshot) };
      result = { status: 'stored', revision: metadata.revision, publicId: metadata.publicId, updatedAt: metadata.updatedAt, published: true, action: 'publish' };
    }
    return route.fulfill({ status: 200, headers, body: JSON.stringify(result) });
  }
}

async function samples() {
  const context = vm.createContext({});
  vm.runInContext(await fs.readFile(path.resolve('assets/design-expression/sample-data.js'), 'utf8'), context);
  return clone(context.HaedoExpressionSamples);
}
async function go(page) {
  await page.goto(base + '/index.html?section=records&view=page'); await ready(page); await settle(page);
  await page.locator('.life-workbench[data-mode="page"][aria-busy="false"]').waitFor();
}
async function fixture(page, sample) {
  await go(page);
  const result = await page.evaluate(async sample => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, versionIds = {}, sourceIds = {}, entryIds = {};
    let bundle = await s.read(await s.getActive());
    for (const source of sample.sources) {
      for (const version of source.versions) {
        const input = { origin: source.origin, title: source.title, text: version.text, authorRelation: source.relation, originalCreatedAt: version.originalCreatedAt, coverage: source.coverage, omissions: source.omissions };
        if (source.url) input.url = source.url;
        if (sourceIds[source.id]) input.existingSourceId = sourceIds[source.id]; else input.forceSeparate = true;
        const prepared = await c.prepareImport(input, bundle);
        const saved = await s.commitLocal({ workspaceId: bundle.workspaceId, baseRevision: bundle.revision, operationId: c.id(), changes: c.buildImportChanges(bundle, prepared, []) });
        if (saved.status !== 'stored') throw Error('Anonymous expression source fixture failed');
        sourceIds[source.id] = prepared.source.id; versionIds[version.id] = prepared.version.id;
        bundle = await s.read(bundle.workspaceId);
      }
    }
    const wb = await s.readWorkbench(bundle.workspaceId);
    wb.page.title = sample.title; wb.page.intro = sample.intro; wb.page.showIntro = true; wb.page.showRecent = true;
    wb.page.entries = sample.entries.map(entry => {
      const id = c.id(); entryIds[entry.id] = id;
      return { id, title: entry.title, parts: entry.sourceRefs.map(ref => ({ versionId: versionIds[ref.versionId], enabled: true })), note: entry.note, pinned: entry.pinned, enabled: true, showBody: true, showNote: true };
    });
    await s.saveWorkbench(bundle.workspaceId, wb, wb.revision);
    return { workspaceId: bundle.workspaceId, versionIds, sourceIds, entryIds };
  }, sample);
  await page.reload(); await ready(page); await page.locator('.wb-page-entry').first().waitFor(); await frames(page);
  return result;
}
function entry(page, f, preview = false, id = 'exhibition-walk') {
  return page.locator(`${preview ? '#wbVisitor article' : '.wb-page-entry'}[data-entry-id="${f.entryIds[id]}"]`);
}
function part(page, f, preview = false, version = 'garden-old', entryId = 'exhibition-walk') {
  return entry(page, f, preview, entryId).locator(`.wb-page-part[data-version-id="${f.versionIds[version]}"]`);
}
async function waitSaved(page, expected) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const wb = (await current(page)).workbench;
    if (wb.page.entries.some(entry => entry.note === expected) && await page.locator('#wbStatus').getAttribute('data-state') === 'saved') return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('Comment was not saved');
}
async function snapshotBackup(page) {
  return page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, id = await s.getActive();
    const backup = HaedoLife.Workbench.makeBackup(await s.read(id), await s.readWorkbench(id));
    delete backup.exportedAt; delete backup.sourceBackup.exportedAt;
    return backup;
  });
}
async function rawParts(page, f, sample, preview) {
  for (const item of sample.entries) for (const ref of item.sourceRefs) {
    const source = sample.sources.find(source => source.id === ref.sourceId), version = source.versions.find(version => version.id === ref.versionId);
    const p = part(page, f, preview, ref.versionId, item.id), bodies = p.locator('.wb-source-body'); await p.waitFor();
    if (version.text === null) { assert.equal(await bodies.count(), 0); assert.match(await p.textContent(), /본문 미확보/); }
    else { const rendered = await bodies.textContent(); assert(rendered.length > 0 && version.text.startsWith(rendered), 'Rendered body must be an exact raw prefix'); assert(!rendered.endsWith('\r'), 'Fold must not divide CRLF'); assert(!/[\uD800-\uDBFF]$/.test(rendered), 'Fold must not divide an emoji surrogate pair'); }
    if (version.originalCreatedAt) assert.equal(await p.locator('.wb-page-source-date').textContent(), '원문 작성일 ' + version.originalCreatedAt);
    else assert.equal(await p.locator('.wb-page-source-date').count(), 0, 'Unknown source dates must not fall back to import time');
    for (const omitted of source.omissions) assert((await p.locator('.wb-page-omissions').textContent()).includes(omitted));
  }
}
async function activate(page, locator, width) { if (width <= 820) await locator.tap(); else { await locator.focus(); await page.keyboard.press('Enter'); } }
async function take(page, report, label, width) {
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); }); await frames(page);
  const metrics = await page.evaluate(inspect);
  const file = `${label}-${width}.png`;
  await page.screenshot({ path: path.join(out, file), fullPage: true });
  report.visual.push({ label, width, screenshot: file, ...metrics });
  if (width === 390) {
    const screenshot = `${label}-${width}-viewport.png`;
    await page.screenshot({ path: path.join(out, screenshot), fullPage: false });
    const firstScreen = await page.evaluate(() => {
      const rect = el => { const r = el?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null; };
      return { firstBody: rect(document.querySelector('.wb-page-part .wb-source-body')), navigation: rect(document.querySelector('[data-haedo-navigation]')) };
    });
    report.observations.push({ scene: label, width, screenshot, firstScreen });
  }
  assert.equal(metrics.horizontalOverflow, false, 'No horizontal page overflow');
  assert.deepEqual(metrics.smallInputs, []); assert.deepEqual(metrics.unnamed, []); assert.deepEqual(metrics.contrastFailures, []);
  assert.deepEqual(metrics.smallTargets, []);
}
async function main() {
  await fs.mkdir(out, { recursive: true }); const sample = await samples();
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), browser: browser.version(), scope: 'Actual private page/preview, bundled SDK and IndexedDB; synthetic intercepted publication; Chromium viewport/touch/keyboard, not Apple hardware or native IME.', checks: [], visual: [], observations: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, operatingRemoteWrites: 0 };
  async function check(name, width, run) {
    if (process.env.PAGE_EXPRESSION_MATCH && !new RegExp(process.env.PAGE_EXPRESSION_MATCH).test(name)) return;
    const server = new PublicationCloud(), context = await makeContext(browser, server, 'expression-' + report.checks.length, accounts.a, { viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width <= 820, reducedMotion: 'reduce' });
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push(url.origin); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
    try { await run({ page, server }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); ciFailure(error); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    for (const width of [1440, 820, 390]) await check(`private page and preview preserve exact raw sources, expansion and reader return at ${width}`, width, async ({ page }) => {
      const f = await fixture(page, sample), initial = await current(page), backup = await snapshotBackup(page);
      const raw = sample.sources[0].versions[0].text;
      assert(raw.includes('\r\n') && raw.includes('🌱'));
      await rawParts(page, f, sample, false); await take(page, report, 'page', width);
      const original = part(page, f), expand = original.locator('.wb-page-expand');
      assert.equal(await expand.getAttribute('aria-expanded'), 'false'); assert((await original.locator('.wb-source-body').textContent()).length < raw.length);
      await activate(page, expand, width); assert.equal(await expand.getAttribute('aria-expanded'), 'true'); assert.equal(await original.locator('.wb-source-body').textContent(), raw);
      assert.equal(await original.locator('.wb-source-body').evaluate(el => { const r = el.getBoundingClientRect(); return document.activeElement === el && r.bottom > 0 && r.top < innerHeight; }), true, 'Expanded reading surface should receive focus in viewport');
      await page.locator('#wbPagePreview').click(); await page.locator('#wbVisitor').waitFor();
      let previewPart = part(page, f, true); assert.equal(await previewPart.locator('.wb-source-body').textContent(), raw); assert.equal(await previewPart.locator('.wb-page-expand').getAttribute('aria-expanded'), 'true');
      await activate(page, previewPart.locator('.wb-page-expand'), width);
      assert.equal(await previewPart.locator('.wb-page-expand').getAttribute('aria-expanded'), 'false'); assert.equal(await previewPart.locator('.wb-page-expand').evaluate(el => document.activeElement === el), true);
      await rawParts(page, f, sample, true); await take(page, report, 'preview', width);
      await activate(page, previewPart.locator('.wb-page-expand'), width);
      const open = previewPart.locator('.wb-page-source-open'); await open.scrollIntoViewIfNeeded(); await frames(page);
      const originScroll = await page.evaluate(() => scrollY); await activate(page, open, width);
      await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
      await page.locator('#lifeSearchReturn').click(); await page.locator('#wbVisitor').waitFor(); await frames(page);
      previewPart = part(page, f, true); assert.equal(await previewPart.locator('.wb-source-body').textContent(), raw);
      assert.equal(await previewPart.locator('.wb-page-source-open').evaluate(el => document.activeElement === el), true);
      assert(Math.abs((await page.evaluate(() => scrollY)) - originScroll) <= 3, 'Reader return restores the original scroll');
      await page.locator('#wbPagePreview').click(); await page.locator('#wbVisitor').waitFor({ state: 'detached' });
      assert.equal(await part(page, f).locator('.wb-source-body').textContent(), raw);
      await activate(page, part(page, f).locator('.wb-page-expand'), width);
      assert.deepEqual(await current(page), initial, 'Folding, preview and source opening do not save composition or source changes'); assert.deepEqual(await snapshotBackup(page), backup);
      const restore = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, id = await s.getActive(); return HaedoLife.Workbench.restoreBackup(JSON.stringify(HaedoLife.Workbench.makeBackup(await s.read(id), await s.readWorkbench(id)))); });
      assert(restore.bundle.sourceVersions.some(version => version.contentText === raw));
      const restoredEntry = restore.workbench.page.entries.find(entry => entry.title === sample.entries[0].title);
      assert.equal(restore.bundle.sourceVersions.find(version => version.id === restoredEntry.parts[0].versionId).contentText, raw);
      report.observations.push({ width, rawUtf16Length: raw.length, restoreExactOldVersion: true, foldDidNotWrite: true, readerReturnPreview: true });
    });
    await check('comment failure keeps draft and editor context while fold remains independent', 390, async ({ page }) => {
      const f = await fixture(page, sample), original = (await current(page)).bundle, e = entry(page, f);
      await e.locator('.wb-page-entry-open').click(); const input = e.getByLabel('내 코멘트', { exact: true });
      const note = '원문은 보존하고 이 페이지의 생각만 고친다.🌱\n실패 뒤에도 입력한 문장을 다시 읽는다.';
      await input.fill(note); await input.evaluate(el => { el.setSelectionRange(9, 27, 'backward'); el.focus(); window.__expressionInput = el; });
      await page.locator('#wbPagePreview').click(); await page.locator('#wbVisitor').waitFor(); assert((await entry(page, f, true).textContent()).includes(note));
      await page.locator('#wbPagePreview').click(); await page.locator('#wbVisitor').waitFor({ state: 'detached' });
      assert.equal(await input.evaluate(el => document.activeElement === el), true); assert.deepEqual(await input.evaluate(el => [el.selectionStart, el.selectionEnd, el.selectionDirection]), [9, 27, 'backward']);
      await input.evaluate(el => { window.__expressionInput = el; }); await abortWorkbenchWrites(page, true);
      const failed = note + '\n저장이 실패해도 사라지면 안 되는 다음 질문.'; await input.fill(failed); await page.locator('#wbPagePreview').click(); await page.locator('#wbError').waitFor({ state: 'visible' });
      await page.waitForFunction(() => __wbAborted > 0 && document.querySelector('#wbStatus')?.dataset.state === 'error' && !document.querySelector('#wbPagePreview')?.disabled);
      assert.equal(await page.locator('#wbVisitor').count(), 0); assert.equal(await input.inputValue(), failed); assert.equal(await input.evaluate(el => el === __expressionInput), true);
      const abortsBeforeOpening = await page.evaluate(() => __wbAborted);
      await part(page, f).locator('.wb-page-source-open').click();
      // Keep the fault active through this distinct attempted navigation. The
      // previous preview error alone does not prove this async save has settled.
      await page.waitForFunction(({ before, versionId }) => __wbAborted > before && document.querySelector('#wbStatus')?.dataset.state === 'error' && document.querySelector(`.wb-page-part[data-version-id="${versionId}"] .wb-page-source-open`)?.disabled === false, { before: abortsBeforeOpening, versionId: f.versionIds['garden-old'] });
      assert.equal(await page.locator('#lifeSourceText').count(), 0, 'Unsaved failed comments block source navigation'); assert.equal(await input.inputValue(), failed); assert.equal(await input.evaluate(el => el === __expressionInput), true);
      await abortWorkbenchWrites(page, false); await page.locator('#wbError').getByRole('button', { name: '다시 저장', exact: true }).click(); await waitSaved(page, failed);
      await page.locator('#wbPagePreview').click(); await page.locator('#wbVisitor').waitFor(); assert((await entry(page, f, true).textContent()).includes(failed));
      await page.locator('#wbPagePreview').click(); assert.equal(await input.inputValue(), failed); assert.deepEqual((await current(page)).bundle, original);
      await page.reload(); await ready(page); await entry(page, f).waitFor(); assert((await entry(page, f).textContent()).includes(failed));
    });
    await check('publication body consent and full backup remain independent of page fold', 820, async ({ page, server }) => {
      const f = await fixture(page, sample), before = await current(page), raw = sample.sources[0].versions[0].text;
      async function publish(optIn) {
        await page.locator('#wbPageShare').click(); await page.locator('#wbSharePreview').waitFor();
        if (optIn) { await page.locator('#wbShareChoices > summary').click(); await page.locator(`.wb-share-body[data-version-id="${f.versionIds['garden-old']}"]`).check(); }
        await page.locator('#wbShareConsent').check(); await page.locator('#wbSharePublish').click(); await page.locator('#wbShareUrl').waitFor({ state: 'visible' });
        const snapshot = clone(server.publicPage.snapshot); await page.locator('#wbShareBack').click(); await entry(page, f).waitFor(); return snapshot;
      }
      const defaults = await publish(false);
      assert(defaults.entries.every(entry => entry.parts.every(part => part.text === null && part.textKind === 'none')), 'Private body display must never opt into publication');
      await part(page, f).locator('.wb-page-expand').click(); const expanded = await publish(true);
      assert.equal(expanded.entries[0].parts[0].text, raw); assert.equal(expanded.entries[0].parts[0].textKind, 'body');
      await part(page, f).locator('.wb-page-expand').click(); const folded = await publish(true); assert.deepEqual(folded, expanded, 'Fold is presentation only; explicit full-body publication stays exact');
      const other = folded.entries.flatMap(entry => entry.parts).find(part => part.title === '느린 선택을 다루는 책 소개'); assert.equal(other.text, null); assert.equal(other.textKind, 'none');
      assert.equal(server.publicationWrites.length, 3); assert.deepEqual(await current(page), before);
      const backup = await snapshotBackup(page); assert.equal(backup.sourceBackup.workspace.sourceVersions.find(v => v.id === f.versionIds['garden-old']).contentText, raw);
      report.observations.push({ scene: 'publication', simulatedWrites: 3, privateSourcesUnchanged: true, defaultBodyIncluded: false, explicitBodyIsRaw: true, foldIndependent: true });
    });
    await check('free-form dates, duplicate-source entry independence and responsive fold boundaries', 820, async ({ page }) => {
      const variation = clone(sample); variation.sources[0].versions[0].originalCreatedAt = '2024년 가을 산책';
      variation.entries.push({ id: 'same-source-second-entry', title: '다른 질문으로 다시 놓은 같은 원문', pinned: false, sourceRefs: [{ sourceId: 'exhibition-garden', versionId: 'garden-old' }], note: '' });
      const f = await fixture(page, variation), raw = variation.sources[0].versions[0].text, before = await current(page);
      const first = part(page, f), second = part(page, f, false, 'garden-old', 'same-source-second-entry');
      assert.equal(await first.locator('.wb-page-source-date').textContent(), '원문 작성일 2024년 가을 산책');
      assert.equal(await part(page, f, false, 'questions-first', 'after-walk').locator('.wb-page-source-date').count(), 0);
      await first.locator('.wb-page-expand').click(); assert.equal(await first.locator('.wb-source-body').textContent(), raw);
      assert.equal(await second.locator('.wb-page-expand').getAttribute('aria-expanded'), 'false'); assert((await second.locator('.wb-source-body').textContent()).length < raw.length);
      const selectedText = await first.locator('.wb-source-body').evaluate(el => {
        window.__expressionExpandedNode = el.firstChild;
        const phrase = '🌱 낮은 화단의 새잎', start = el.firstChild.textContent.indexOf(phrase);
        if (start < 0) throw Error('Anonymous selection fixture missing');
        const range = document.createRange(); range.setStart(el.firstChild, start); range.setEnd(el.firstChild, start + phrase.length);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        return selection.toString();
      });
      assert.equal(selectedText, '🌱 낮은 화단의 새잎');
      for (const width of [701, 700, 390, 820]) {
        await page.setViewportSize({ width, height: 1000 }); await frames(page);
        const prefix = await second.locator('.wb-source-body').textContent(); assert(prefix.length > 0 && prefix.length < raw.length && raw.startsWith(prefix));
        assert(!prefix.endsWith('\r') && !/[\uD800-\uDBFF]$/.test(prefix)); assert.equal(await first.locator('.wb-source-body').textContent(), raw);
        assert.equal(await first.locator('.wb-source-body').evaluate(el => el.firstChild === window.__expressionExpandedNode), true, 'Responsive changes retain the expanded text node');
        assert.equal(await page.evaluate(() => window.getSelection().toString()), selectedText, 'Responsive changes retain the selected exact phrase');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      await first.locator('.wb-page-expand').click(); await second.locator('.wb-page-expand').click();
      assert.equal(await first.locator('.wb-page-expand').getAttribute('aria-expanded'), 'false'); assert.equal(await second.locator('.wb-source-body').textContent(), raw);
      await page.locator('#wbPagePreview').click(); await page.locator('#wbVisitor').waitFor();
      assert.equal(await part(page, f, true).locator('.wb-page-expand').getAttribute('aria-expanded'), 'false');
      assert.equal(await part(page, f, true, 'garden-old', 'same-source-second-entry').locator('.wb-source-body').textContent(), raw);
      assert.deepEqual(await current(page), before);
      report.observations.push({ scene: 'responsive-duplicate-source', widths: [701, 700, 390, 820], freeFormDatePreserved: true, unknownDateOmitted: true, eachEntryIndependent: true, expandedTextNodeRetained: true, selectedPhraseRetained: true });
    });
    assert(report.checks.length > 0, 'At least one selected check must run');
    report.pass = report.checks.every(check => check.pass) && !report.consoleErrors.length && !report.pageErrors.length && !report.external.length;
  } finally {
    await browser.close(); report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(out, 'run-' + report.createdAt.replace(/[:.]/g, '-') + '.json'), JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ checks: report.checks.length, passed: report.checks.filter(c => c.pass).length, visual: report.visual.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length, report: path.join(out, 'browser-report.json') }));
  if (!report.pass) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); ciFailure(error); process.exitCode = 1; });
module.exports = { fixture, samples, PublicationCloud };

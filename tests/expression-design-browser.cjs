/* Isolated interactive A/B expression-page samples; no production authentication,
 * personal storage, real remote service or actual Apple-device claims.
 * BASE_URL=http://127.0.0.1:4188 PW_MODULE_PATH=... node this-file
 */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4188';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright } = require('./unified-home-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const base = process.env.BASE_URL;
const focusOnly = process.env.EXPRESSION_FOCUS === 'expansion';
const output = path.resolve(__dirname, '../.local/expression-design');
const sizes = [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }];
const twoFrames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function controls(page) {
  if (!await page.locator('#expressionReview').evaluate(el => el.open)) await page.locator('#expressionReview > summary').click();
}
function watchPrivateStorage() {
  window.__expressionStorageCalls = [];
  const wrap = (object, name, kind) => {
    const original = object[name];
    if (typeof original !== 'function') return;
    object[name] = function (...args) { __expressionStorageCalls.push({ kind, method: name }); return Reflect.apply(original, this, args); };
  };
  for (const name of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) wrap(Storage.prototype, name, 'Storage');
  for (const name of ['open', 'deleteDatabase', 'databases']) wrap(IDBFactory.prototype, name, 'IndexedDB');
  if (globalThis.CacheStorage) for (const name of ['open', 'match', 'delete', 'keys', 'has']) wrap(CacheStorage.prototype, name, 'CacheStorage');
  if (navigator.serviceWorker) wrap(navigator.serviceWorker, 'register', 'ServiceWorker');
}
function readingGeometry() {
  const y = el => el ? +(el.getBoundingClientRect().top + scrollY).toFixed(1) : null;
  const first = document.querySelector('#expressionApp article[data-entry-id]');
  const entries = [...document.querySelectorAll('#expressionApp article[data-entry-id]')];
  const body = first?.querySelector('.expression-body');
  const comment = first?.querySelector('.expression-comment');
  return { firstBodyY: y(body), firstCommentY: y(comment), secondEntryY: y(entries[1]), firstBodyAboveFold: !!body && body.getBoundingClientRect().top < innerHeight, firstCommentAboveFold: !!comment && comment.getBoundingClientRect().top < innerHeight, secondEntryAboveFold: !!entries[1] && entries[1].getBoundingClientRect().top < innerHeight, entryCount: entries.length };
}
async function capture(page, report, variant, scene, size) {
  await page.evaluate(() => document.fonts.ready); await twoFrames(page);
  const metrics = await page.evaluate(inspect);
  // Read-only original document surfaces are not action targets.
  metrics.smallTargets = metrics.smallTargets.filter(item => item.id !== 'expressionReader');
  const layout = await page.evaluate(readingGeometry);
  const file = `${focusOnly ? 'recheck-' : ''}${variant}-${scene}-${size.width}.png`;
  await page.screenshot({ path: path.join(output, file) });
  report.captures.push({ variant, scene, width: size.width, file, metrics, layout });
  assert.equal(metrics.horizontalOverflow, false, file + ': horizontal overflow');
  for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], file + ': ' + key);
}
function ciFailure(label, error) {
  if (process.env.GITHUB_ACTIONS) console.error('::error title=Expression sample ' + label + '::' + String(error.stack || error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'));
}
async function activate(locator, page, size) {
  if (size.width <= 820) await locator.tap();
  else { await locator.focus(); await page.keyboard.press('Enter'); }
  await twoFrames(page);
}
async function normal(page) {
  await page.locator('#expressionApp article[data-entry-id]').first().waitFor(); await twoFrames(page);
}
async function variantFlow(page, report, fixture, variant, size) {
  const sourceById = new Map(fixture.sources.map(source => [source.id, source]));
  const before = JSON.stringify(fixture);
  await activate(page.locator(`#expressionVariant [data-variant="${variant}"]`), page, size); await normal(page);
  assert.equal(await page.locator(`#expressionVariant [data-variant="${variant}"]`).getAttribute('aria-pressed'), 'true');
  const entries = page.locator('#expressionApp article[data-entry-id]'); assert.equal(await entries.count(), fixture.entries.length);
  assert.deepEqual(await entries.evaluateAll(nodes => nodes.map(el => el.dataset.entryId)), fixture.entries.map(entry => entry.id));
  await page.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); }); await twoFrames(page);
  await capture(page, report, variant, 'normal', size);
  const displayed = await page.locator('#expressionApp section[data-source-id][data-version-id]').evaluateAll(nodes => nodes.map(el => ({ sourceId: el.dataset.sourceId, versionId: el.dataset.versionId, body: el.querySelector('.expression-body')?.textContent ?? null, meta: el.querySelector('.expression-source-meta')?.textContent || '', dates: [...el.querySelectorAll('time')].map(time => time.dateTime), allText: el.textContent, expandable: !!el.querySelector('.expression-expand') })));
  assert.equal(displayed.length, fixture.entries.reduce((sum, entry) => sum + entry.sourceRefs.length, 0));
  for (const row of displayed) {
    const source = sourceById.get(row.sourceId), version = source.versions.find(version => version.id === row.versionId); assert(version, 'Exact fixture version must exist');
    if (version.text === null) { assert.equal(row.body, null); assert.equal(row.expandable, false); assert.match(row.allText, /본문 미확보/); }
    else { assert(version.text.startsWith(row.body), 'Preview must be a contiguous raw original prefix'); assert(row.body.length > 0); if (row.sourceId === 'short-day') { assert.equal(row.body, version.text); assert.equal(row.expandable, false); } }
    if (source.coverage === 'partial') { assert.match(row.allText, /본문 일부/); for (const omission of source.omissions) assert(row.allText.includes(omission)); }
    assert.deepEqual(row.dates, version.originalCreatedAt ? [version.originalCreatedAt] : [], 'Known selected-version dates must be exposed; unknown dates must not be invented');
    if (source.versions.at(-1).id !== version.id) assert.match(row.meta, /이전 버전/);
  }
  const garden = page.locator('section[data-source-id="exhibition-garden"][data-version-id="garden-old"]'), expand = garden.locator('.expression-expand');
  const raw = sourceById.get('exhibition-garden').versions.find(v => v.id === 'garden-old').text;
  assert.equal(await expand.getAttribute('aria-expanded'), 'false'); assert((await garden.locator('.expression-body').textContent()).length < raw.length);
  await activate(expand, page, size); assert.equal(await expand.getAttribute('aria-expanded'), 'true'); assert.equal(await garden.locator('.expression-body').textContent(), raw);
  assert.equal(await garden.locator('.expression-body').getAttribute('data-collapsed'), 'false');
  assert.equal(await garden.locator('.expression-body').evaluate(el => { const r = el.getBoundingClientRect(); return document.activeElement === el && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0; }), true, 'Expansion must focus original text intersecting the viewport');
  await capture(page, report, variant, 'expanded', size);
  const open = garden.locator('.expression-open');
  await open.evaluate(el => el.addEventListener('pointerdown', () => { window.__expressionReaderFromY = scrollY; }, { once: true }));
  // Reader/back uses a real pointer at every viewport to measure activation scroll.
  if (size.width <= 820) await open.tap(); else await open.click();
  await page.locator('#expressionReader').waitFor(); await twoFrames(page);
  assert.equal(await page.locator('#expressionReader .expression-body').textContent(), raw);
  assert.notEqual(raw, sourceById.get('exhibition-garden').versions.at(-1).text);
  assert.match(await page.locator('#expressionReader').textContent(), /이전 버전/);
  assert.equal(await entries.count(), 0, 'Original reader replaces the feed');
  if (!focusOnly) await capture(page, report, variant, 'original-old-version', size);
  await activate(page.locator('#expressionBack'), page, size); await normal(page);
  assert.equal(await garden.locator('.expression-body').textContent(), raw); assert.equal(await garden.locator('.expression-open').evaluate(el => document.activeElement === el), true);
  assert.equal(await page.evaluate(() => Math.abs(scrollY - __expressionReaderFromY) <= 2), true);
  await activate(garden.locator('.expression-expand'), page, size); assert.equal(await garden.locator('.expression-expand').getAttribute('aria-expanded'), 'false'); assert(raw.startsWith(await garden.locator('.expression-body').textContent())); assert.equal(await garden.locator('.expression-expand').evaluate(el => document.activeElement === el), true);
  assert.equal(await garden.locator('.expression-body').getAttribute('data-collapsed'), 'true');
  assert.equal(await garden.locator('.expression-body').evaluate(el => getComputedStyle(el, '::after').content.includes('…')), true);
  if (focusOnly) {
    await capture(page, report, variant, 'collapsed', size);
    assert.equal(await page.evaluate(() => JSON.stringify(HaedoExpressionSamples)), before);
    return { rawPrefixAndExpandedWholeText: true, expansionFocusIsVisibleReadingSurface: true, exactOldOriginalAndBackFocusScroll: true, collapseButtonFocused: true, sourceFixtureImmutable: true };
  }
  const noteId = fixture.entries[0].id, note = page.locator(`textarea[data-note-id="${noteId}"]`), edited = fixture.entries[0].note + '\n\n이 비교에서만 더한 익명 코멘트🌱';
  const entryEdit = page.locator(`article[data-entry-id="${noteId}"] [data-note-edit]`);
  await page.locator('#expressionMode').click(); await activate(entryEdit, page, size); await note.waitFor();
  await note.fill(edited); await note.evaluate(el => { el.focus(); el.setSelectionRange(8, 22, 'backward'); });
  await capture(page, report, variant, 'comment-edit', size);
  await page.locator('#expressionMode').click(); await normal(page); assert.equal(await page.locator(`article[data-entry-id="${noteId}"] .expression-comment-body`).textContent(), edited);
  await page.locator('#expressionMode').click(); await note.waitFor(); assert.equal(await note.inputValue(), edited);
  assert.deepEqual(await note.evaluate(el => [el.selectionStart, el.selectionEnd, el.selectionDirection]), [8, 22, 'backward']);
  await activate(entryEdit, page, size); assert.equal(await note.count(), 0); assert.equal(await entryEdit.evaluate(el => document.activeElement === el), true);
  await activate(entryEdit, page, size); await note.waitFor(); assert.equal(await note.inputValue(), edited); assert.equal(await note.evaluate(el => document.activeElement === el), true);
  await page.locator('#expressionMode').click(); await normal(page);
  assert.equal(await page.evaluate(() => JSON.stringify(HaedoExpressionSamples)), before, 'Editing a comment must not mutate frozen source/fixture values');
  await controls(page);
  for (const state of ['empty', 'loading', 'error']) {
    await page.locator('#expressionState').selectOption(state); await twoFrames(page); assert.equal(await entries.count(), 0);
    assert.equal(await page.locator('#expressionApp').evaluate(el => el.textContent.trim().length > 0), true);
    if (state === 'loading') assert.equal(await page.locator('#expressionApp [aria-busy="true"], #expressionApp[aria-busy="true"]').count(), 1);
    await capture(page, report, variant, state, size);
  }
  const retry = page.locator('#expressionApp').getByRole('button', { name: /다시|재시도/ }); await activate(retry, page, size); await normal(page); assert.equal(await page.locator('#expressionState').inputValue(), 'normal');
  assert.equal(await page.locator(`article[data-entry-id="${noteId}"] .expression-comment-body`).textContent(), edited);
  return { exactFixtureOrderAndPairs: true, rawPrefixAndExpandedWholeText: true, shortBodyHasNoCollapse: true, selectedOldOriginalAndBackFocusScroll: true, commentEditPreviewAndEntryFocus: true, sourceFixtureImmutable: true, linkPartialDatesTruthful: true, emptyLoadingErrorRetry: true };
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), base, browser: browser.version(), focused: focusOnly ? 'expansion' : null, scope: 'Standalone anonymous design samples in Linux Chromium at three viewports; touch/keyboard simulation, no Apple hardware, authentication, production UI, publishing or personal data', checks: [], captures: [], consoleErrors: [], pageErrors: [], external: [], storageCalls: [], realRemoteWrites: 0 };
  try {
    for (const size of sizes) for (const variant of ['a', 'b']) {
      if (process.env.EXPRESSION_SKIP_CASE === `${variant}:${size.width}`) continue;
      if (process.env.EXPRESSION_WIDTH && size.width !== Number(process.env.EXPRESSION_WIDTH)) continue;
      if (process.env.EXPRESSION_VARIANT && variant !== process.env.EXPRESSION_VARIANT) continue;
      const context = await browser.newContext({ viewport: size, hasTouch: size.width <= 820, serviceWorkers: 'block' }); await context.addInitScript(watchPrivateStorage);
      await context.route('**/*', route => { const u = new URL(route.request().url()); if (u.origin === new URL(base).origin && route.request().method() === 'GET') return route.continue(); report.external.push({ origin: u.origin, method: route.request().method(), path: u.pathname }); return route.abort('blockedbyclient'); });
      const page = await context.newPage(), label = variant + '/' + size.width; page.setDefaultTimeout(15000);
      page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ check: label, message: event.text() }); }); page.on('pageerror', error => report.pageErrors.push({ check: label, message: error.message }));
      try {
        await page.goto(base + '/expression-sample.html'); await normal(page);
        const fixture = await page.evaluate(() => HaedoExpressionSamples);
        assert.equal(await page.evaluate(() => { function frozen(v) { return !v || typeof v !== 'object' || Object.isFrozen(v) && Object.values(v).every(frozen); } return frozen(HaedoExpressionSamples); }), true);
        const detail = await variantFlow(page, report, fixture, variant, size);
        assert.deepEqual(await page.evaluate(() => __expressionStorageCalls), []);
        await page.reload(); await normal(page); assert.equal(await page.locator('article[data-entry-id="exhibition-walk"] .expression-comment-body').textContent(), fixture.entries[0].note);
        assert.deepEqual(await page.evaluate(() => __expressionStorageCalls), []); report.checks.push({ name: label, pass: true, detail }); console.log('PASS expression ' + label);
      } catch (error) { report.checks.push({ name: label, pass: false, error: error.stack }); console.error('FAIL ' + label + '\n' + error.stack); ciFailure(label, error); await page.screenshot({ path: path.join(output, `failure-${variant}-${size.width}.png`) }).catch(() => {}); }
      finally { report.storageCalls.push(...await page.evaluate(() => __expressionStorageCalls || []).catch(() => [])); await context.close(); }
    }
  } finally { await browser.close(); await fs.writeFile(path.join(output, focusOnly ? 'browser-expansion-recheck-report.json' : 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(`Expression sample: ${report.checks.filter(c => c.pass).length}/${report.checks.length}; ${report.captures.length} captures; console ${report.consoleErrors.length}; page ${report.pageErrors.length}; storage ${report.storageCalls.length}.`);
  if (!report.checks.length || report.checks.some(c => !c.pass) || report.consoleErrors.length || report.pageErrors.length || report.storageCalls.length || report.external.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); ciFailure('setup', error); process.exitCode = 1; });

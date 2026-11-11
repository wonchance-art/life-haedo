/* Shared by the records reader checks (자료 읽기·내 사본 수정). Actual application bytes with synthetic Auth
 * (FakeCloud) and anonymous Korean fixtures seeded through Core, as tests/records-split-resize-browser.cjs does.
 * Chromium viewport sizes only: not an iPad/iPhone touch, rotation or Safari check.
 * Pointer actions use coordinates (page.mouse) where a Playwright locator click would scroll the target into
 * view first and so hide a control that a person cannot see. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('../life-sync-browser.cjs');
const { playwright, makeContext, ready, settle } = require('../unified-home-browser.cjs');

const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
function suite(name, scope) {
  const out = path.resolve(process.env.RECORDS_READER_OUTPUT || path.join(__dirname, '../../.local', name));
  const report = { createdAt: new Date().toISOString(), scope, checks: [], consoleErrors: [], pageErrors: [], external: [], captures: [] };
  let browser = null;
  async function start() {
    await fs.mkdir(out, { recursive: true });
    browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    return browser;
  }
  // One isolated signed-in context on the records list.
  async function open({ width = 1440, height = 900, touch = false, url = '/index.html?section=records', server = new FakeCloud(), device = name + '-' + Math.random().toString(36).slice(2), label = name } = {}) {
    const context = await makeContext(browser, server, device, accounts.a, { viewport: { width, height }, hasTouch: touch });
    const page = await context.newPage(); page.setDefaultTimeout(Number(process.env.RECORDS_READER_TIMEOUT) || 15000);
    page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ check: label, message: event.text() }); });
    page.on('pageerror', error => report.pageErrors.push({ check: label, message: error.message }));
    await context.route('**/*', route => {
      const target = new URL(route.request().url());
      if ([new URL(base).origin, cloud].includes(target.origin) || target.protocol === 'data:' || target.protocol === 'blob:') return route.fallback();
      report.external.push(target.origin + target.pathname); return route.abort('blockedbyclient');
    });
    await page.goto(base + url); await ready(page); await settle(page);
    return { context, page, server };
  }
  async function check(title, action) {
    const started = Date.now();
    try { await action(); report.checks.push({ name: title, pass: true, ms: Date.now() - started }); console.log('PASS ' + title); }
    catch (error) { report.checks.push({ name: title, pass: false, ms: Date.now() - started, error: error.stack }); console.error('FAIL ' + title + '\n' + error.stack); }
  }
  async function capture(page, file) {
    const target = path.join(out, file + '.png'); await page.screenshot({ path: target }); report.captures.push(target);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, file + ': horizontal overflow');
  }
  async function finish() {
    await browser?.close();
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    const failed = report.checks.filter(item => !item.pass).length;
    console.log(JSON.stringify({ suite: name, passed: report.checks.length - failed, failed, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length }));
    if (report.consoleErrors.length || report.pageErrors.length || report.external.length) console.error(JSON.stringify({ consoleErrors: report.consoleErrors, pageErrors: report.pageErrors, external: report.external }, null, 1));
    if (failed || !report.checks.length || report.consoleErrors.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
  }
  return { start, open, check, capture, finish, report, out };
}
// Anonymous sources through Core. Returns [{ sourceId, versionId }] in the given order.
async function seed(page, items, { reload = true } = {}) {
  const ids = await page.evaluate(async items => {
    const storage = HaedoLife.Shell.storage, core = HaedoLife.Core; let bundle = await storage.read(await storage.getActive()); const result = [];
    for (const raw of items) {
      const { excerpts = [], ...input } = raw;
      const prepared = await core.prepareImport({ origin: 'apple_notes', forceSeparate: true, ...input }, bundle);
      const stored = await storage.commitLocal({ operationId: core.id(), workspaceId: bundle.workspaceId, baseRevision: bundle.revision, changes: core.buildImportChanges(bundle, prepared, excerpts) });
      if (stored.status !== 'stored') throw new Error('anonymous fixture was not stored');
      bundle = await storage.read(bundle.workspaceId); result.push({ sourceId: prepared.source.id, versionId: prepared.version.id });
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    return result;
  }, items);
  if (reload) { await page.reload(); await ready(page); await settle(page); }
  return ids;
}
// A newer version of an existing source, as another device's sync or a re-import would add.
async function addVersion(page, sourceId, text, title) {
  return page.evaluate(async ({ sourceId, text, title }) => {
    const storage = HaedoLife.Shell.storage, core = HaedoLife.Core, bundle = await storage.read(await storage.getActive());
    const source = bundle.sources.find(item => item.id === sourceId);
    const prepared = await core.prepareImport({ origin: source.origin, title: title || source.title, text, existingSourceId: sourceId }, bundle);
    const stored = await storage.commitLocal({ operationId: core.id(), workspaceId: bundle.workspaceId, baseRevision: bundle.revision, changes: core.buildImportChanges(bundle, prepared, []) });
    if (stored.status !== 'stored') throw new Error('anonymous newer version was not stored');
    return prepared.version.id;
  }, { sourceId, text, title });
}
const bundle = page => page.evaluate(async () => { const storage = HaedoLife.Shell.storage; return storage.read(await storage.getActive()); });
const stages = (page, kind = 'source-edit') => page.evaluate(async kind => {
  const storage = HaedoLife.Shell.storage;
  return (await storage.listStages(await storage.getActive())).filter(stage => stage.kind === kind).map(stage => ({ stageId: stage.stageId, state: stage.state, revision: stage.revision, text: stage.input.text, title: stage.input.title, base: stage.baseSourceVersionId }));
}, kind);
async function list(page) {
  // (A different address than the reader's own: going to the same address again is a reload, and a reload reopens the reader.)
  await page.goto(base + '/index.html?section=records&view=sources'); await ready(page); await settle(page);
  await page.locator('#lifeMain[data-mode="sources"]').waitFor();
}
// Open an original from the records list by its exact version.
async function openSource(page, versionId) {
  const row = page.locator('#lifeSearchResults .life-source-open' + (versionId ? '[data-version-id="' + versionId + '"]' : '')).first();
  await row.click(); await settle(page); await page.locator('#lifeMain[data-mode="source"] #lifeSourceText').waitFor(); await frames(page);
}
// Real wheel input over the reader (a reading action), then let the scroll settle.
async function wheel(page, total, { step = 500, pause = 25 } = {}) {
  const box = await page.locator('#lifeSourceText').boundingBox(), viewport = page.viewportSize();
  await page.mouse.move(Math.min(viewport.width - 8, box.x + box.width / 2), Math.min(viewport.height - 80, Math.max(140, viewport.height / 2)));
  for (let moved = 0; moved < total; moved += step) { await page.mouse.wheel(0, Math.min(step, total - moved)); await page.waitForTimeout(pause); }
  await page.waitForTimeout(250); await frames(page);
}
// Press a control where it is on screen. Fails when a person could not see it there.
async function pressAt(page, selector) {
  const box = await page.evaluate(selector => {
    const element = document.querySelector(selector); if (!element) return null;
    const rect = element.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, inView: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth, hit: !!hit && (hit === element || element.contains(hit)) };
  }, selector);
  assert(box, selector + ' exists'); assert(box.inView, selector + ' is inside the viewport'); assert(box.hit, selector + ' is not covered');
  await page.mouse.click(box.x, box.y); await frames(page);
}
const rect = (page, selector) => page.evaluate(selector => {
  const element = document.querySelector(selector); if (!element) return null;
  const box = element.getBoundingClientRect();
  return { hidden: !element.checkVisibility(), top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height };
}, selector);
// What is on the original reader's reading line (a third down the screen), in either view: the paragraph (counted by the
// "N번째" each fixture paragraph has), and the exact character there
// (`mark`: which text node of the reader and which offset in it) with its height on screen. Given an earlier
// mark, `was` is where that same character is now. Run in the page; also used inside other page scripts.
const measureLine = mark => {
  const element = document.querySelector('#lifeSourceText'), line = innerHeight / 3, range = document.createRange();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes = []; let node; while ((node = walker.nextNode())) nodes.push(node);
  const rect = (node, offset) => { range.setStart(node, offset); range.setEnd(node, Math.min(node.length, offset + 1)); return range.getBoundingClientRect(); };
  const ends = node => { range.selectNodeContents(node); return range.getBoundingClientRect(); };
  // The first text node that reaches below the line, then the first character in it that does.
  let index = nodes.findIndex(node => /\S/.test(node.data) && ends(node).bottom > line);
  if (index < 0) index = nodes.length - 1;
  let low = 0, high = nodes[index].length - 1;
  while (low < high) { const mid = (low + high) >> 1, box = rect(nodes[index], mid); if (!box.height || box.bottom <= line) low = mid + 1; else high = mid; }
  const before = nodes.slice(0, index).map(node => node.data).join('') + nodes[index].data.slice(0, low + 1);
  const place = (node, offset) => { const box = rect(node, offset); return Math.round(box.top * 10) / 10; };
  return { para: (before.match(/\d+번째/g) || []).length, mark: [index, low], top: place(nodes[index], low), was: mark ? place(nodes[mark[0]], mark[1]) : null,
    y: Math.round(scrollY), height: innerHeight, lineHeight: parseFloat(getComputedStyle(element).lineHeight) || parseFloat(getComputedStyle(element).fontSize) * 1.6,
    width: Math.round(element.getBoundingClientRect().width), textHeight: Math.round(element.getBoundingClientRect().height), mode: element.dataset.readingMode,
    split: !!document.querySelector('#lifeRecordsPane')?.checkVisibility(), title: document.querySelector('.life-reader-heading')?.textContent ?? null };
};
const lineAt = (page, before) => page.evaluate('(' + measureLine + ')(' + JSON.stringify(before?.mark || null) + ')');
// The character that was on the reading line (`before`) is at the same height in `after` (the same share of the screen after
// a rotation), within half a line. `extra`: whole lines allowed on top of that. The formatted (Markdown) view keeps a block
// and a share of its height, not a character, so one more line there. Returns the distance in px.
function sameLine(before, after, label, extra = 0) {
  assert(Number.isFinite(after.was), label + ': measured where the earlier character is now');
  const want = before.top * after.height / before.height, error = Math.abs(after.was - want), lines = extra + (after.mode === 'formatted' ? 1 : 0);
  assert(error <= after.lineHeight * (lines + 0.5), label + ': the character being read stays at its height within ' + (lines + 0.5) + ' lines (' + after.lineHeight * (lines + 0.5) + 'px): wanted ' + want.toFixed(1) + ', is ' + after.was + ' · ' + JSON.stringify(before) + ' → ' + JSON.stringify(after));
  return error;
}
module.exports = { assert, base, cloud, accounts, FakeCloud, suite, seed, addVersion, bundle, stages, list, openSource, wheel, pressAt, rect, frames, ready, settle, measureLine, lineAt, sameLine };

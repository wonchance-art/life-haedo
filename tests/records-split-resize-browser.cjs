/* 2026-11-07 소유자 요청: 자료 목록에는 고르기 전 읽기 칸이 없고, 원문을 열면 목록 옆 읽기 칸이 남는 폭을 차지한다.
 * 화면 너비를 따르는 2단 배치와 목록·읽기 칸 사이 구분선 끌기(자료·뉴스), 이 기기의 너비 기억을 확인한다.
 * npm run dev; node tests/records-split-resize-browser.cjs
 * Actual application bytes with synthetic Auth (FakeCloud) and anonymous Korean fixtures. Publisher pages are
 * synthetic responses. Chromium viewport widths and mouse input only: not an iPad touch or Safari check. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, nav } = require('./unified-home-browser.cjs');
const { harnessFrameError } = require('./helpers/news-reader.cjs');
const out = path.resolve(process.env.RECORDS_SPLIT_OUTPUT || path.join(__dirname, '../.local/records-split-resize'));
const report = { createdAt: new Date().toISOString(), scope: 'Local Chromium, synthetic Auth, anonymous records and synthetic news feed; mouse and keyboard only.', checks: [], consoleErrors: [], pageErrors: [], external: [], captures: [] };
const RECORDS_KEY = 'caeyeon_life_split_records', NEWS_KEY = 'caeyeon_life_split_news';
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const idle = page => page.waitForFunction(() => document.querySelector('#discoveryReview')?.getAttribute('aria-busy') === 'false');
const paragraph = index => (index + 1) + '번째 문단. 토요일 오후 동네 도서관 2층 창가에서 3장을 다시 읽었다. 같은 문장인데 집에서 읽을 때와 무게가 다르다. 창밖의 은행나무가 노랗게 물들었다.';
const longText = Array.from({ length: 80 }, (_, index) => paragraph(index)).join('\n\n');

async function seedRecords(page) {
  await page.evaluate(async ({ longText }) => {
    const storage = HaedoLife.Shell.storage, core = HaedoLife.Core;
    let bundle = await storage.read(await storage.getActive());
    const put = async input => {
      const prepared = await core.prepareImport(input, bundle);
      await storage.commitLocal({ operationId: core.id(), workspaceId: bundle.workspaceId, baseRevision: bundle.revision, changes: core.buildImportChanges(bundle, prepared, []) });
      bundle = await storage.read(bundle.workspaceId);
    };
    for (let index = 0; index < 8; index++) {
      await put({ origin: 'obsidian', title: '독서 메모 ' + (index + 1) + ' — 도서관 창가에서 다시 읽은 문장', text: (index === 7 ? '' : index + '번 메모. ') + longText, forceSeparate: true });
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }, { longText });
  await page.reload(); await ready(page); await settle(page);
}
function feed() {
  const now = Date.now(), iso = offset => new Date(now - offset * 60000).toISOString();
  const rights = { mode: 'metadata_only', label: '합성 제목·링크', url: 'https://www.readersnews.com/' };
  const source = { id: 'readersnews-books', name: '독서신문', url: 'https://www.readersnews.com/', feedUrl: 'https://www.readersnews.com/feed', language: 'ko', rights, status: 'ok', stale: false, error: null, lastSuccessAt: iso(1), lastAttemptAt: iso(1) };
  const article = (id, title, minutes) => ({ id, sourceId: source.id, url: 'https://www.readersnews.com/news/articleView.html?idxno=' + id, title, language: 'ko', tags: [], author: null, publishedAt: iso(minutes), fetchedAt: iso(1), summary: '', coverage: 'link_only', rights });
  return { schemaVersion: 1, generatedAt: iso(1), sources: [source], articles: [article('910001', '합성 신간 소개 기사', 10), article('910002', '합성 도서관 운영 기사', 20), article('910003', '합성 서점 방문 기사', 30)] };
}
async function toList(page) {
  if (await page.locator('#lifeSearchReturn').isVisible()) { await page.locator('#lifeSearchReturn').click(); await settle(page); }
}
async function openRecord(page, index = 0) {
  await toList(page);
  await page.locator('#lifeSearchResults .life-source-open').nth(index).click(); await settle(page); await frames(page);
  await page.locator('#lifeRecordsPane').waitFor({ state: 'attached' });
}
async function horizontalOverflow(page) { return page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); }
async function capture(page, name) {
  const file = path.join(out, name + '.png'); await page.screenshot({ path: file }); report.captures.push(file);
  assert.equal(await horizontalOverflow(page), false, name + ': horizontal overflow');
}
// The separator's state and the grid columns it drives.
async function split(page, container) {
  return page.evaluate(container => {
    const host = document.querySelector(container), handle = host?.querySelector(':scope > .haedo-split-handle');
    const columns = host ? getComputedStyle(host).gridTemplateColumns.split(' ').map(parseFloat) : [];
    let stored = null; try { stored = localStorage.getItem(host?.id === 'lifeMain' ? 'caeyeon_life_split_records' : 'caeyeon_life_split_news'); } catch { stored = 'unreadable'; }
    if (!handle) return { handle: false, columns, stored };
    const box = handle.getBoundingClientRect();
    return { handle: true, visible: handle.checkVisibility(), role: handle.getAttribute('role'), orientation: handle.getAttribute('aria-orientation'), label: handle.getAttribute('aria-label'),
      tabIndex: handle.tabIndex, controls: handle.getAttribute('aria-controls'), now: Number(handle.getAttribute('aria-valuenow')), min: Number(handle.getAttribute('aria-valuemin')), max: Number(handle.getAttribute('aria-valuemax')),
      width: Math.round(box.width), x: box.left + box.width / 2, y: Math.max(box.top, 0) + (Math.min(box.bottom, innerHeight) - Math.max(box.top, 0)) / 2, cursor: getComputedStyle(handle).cursor, columns, stored,
      dragging: document.documentElement.dataset.haedoSplitDragging || null };
  }, container);
}
async function drag(page, container, dx, { release = true } = {}) {
  const start = await split(page, container);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  for (let step = 1; step <= 8; step++) await page.mouse.move(start.x + dx * step / 8, start.y + step);
  await frames(page);
  const during = await split(page, container);
  if (release) { await page.mouse.up(); await frames(page); }
  return { start, during };
}
function assertSeparator(state, label = '목록 너비 조절') {
  assert.equal(state.handle && state.visible, true, 'separator shown');
  assert.equal(state.role, 'separator'); assert.equal(state.orientation, 'vertical'); assert.equal(state.label, label); assert.equal(state.tabIndex, 0);
  assert.equal(state.width, 44, '44px hit area'); assert.equal(state.cursor, 'col-resize');
  assert(state.min === 280 && state.max >= state.min && state.now >= state.min && state.now <= state.max, 'aria values within the range: ' + JSON.stringify(state));
  assert.equal(state.columns.length, 3); assert.equal(Math.round(state.columns[0]), state.now, 'list column follows aria-valuenow'); assert.equal(Math.round(state.columns[1]), 44);
  assert(state.columns[2] >= 419.5, 'reader keeps at least 420px: ' + state.columns[2]);
}

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, run, viewport = { width: 1440, height: 960 }) {
    const server = new FakeCloud(), context = await makeContext(browser, server, 'records-split-' + report.checks.length, accounts.a, { viewport });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback();
      if (url.hostname === 'www.readersnews.com') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>합성 출판사 응답</title><p>검사용 응답입니다.</p>' });
      report.external.push({ check: name, origin: url.origin }); return route.abort('blockedbyclient');
    });
    await context.route(base + '/assets/life/discovery-feed.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(feed()) }));
    // Observers on the split containers, to prove each view disconnects its own on leave.
    await context.addInitScript(() => {
      const Native = window.ResizeObserver; if (!Native) return;
      window.__splitObservers = new Set();
      window.ResizeObserver = class extends Native {
        observe(target, options) { if (target.id === 'lifeMain' || target.classList?.contains('discovery-layout')) window.__splitObservers.add(this); return super.observe(target, options); }
        disconnect() { window.__splitObservers.delete(this); return super.disconnect(); }
      };
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ check: name, text: message.text() }); });
    page.on('pageerror', error => { if (harnessFrameError(error.message)) (report.harnessFrameErrors ||= []).push(name); else report.pageErrors.push({ check: name, text: error.message }); });
    try {
      await page.goto(base + '/index.html'); await ready(page);
      await run({ page });
      assert.equal(server.writes().length, 0, 'The list width is never uploaded to the account');
      report.checks.push({ name, pass: true }); console.log('PASS ' + name);
    } catch (error) {
      report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack);
      await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png') }).catch(() => {});
    } finally { await context.close(); }
  }
  try {
    await check('records list has no reading placeholder and uses the page width; opening shows list and reader', async ({ page }) => {
      await seedRecords(page); await nav(page, 'records');
      for (const width of [1101, 1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 960 }); await frames(page);
        const layout = await page.evaluate(() => {
          const main = document.querySelector('#lifeMain'), css = getComputedStyle(main), list = document.querySelector('#lifeSearchResults');
          return { split: main.dataset.split || null, wide: main.dataset.wide || null, placeholder: document.querySelectorAll('#lifeRecordsReaderEmpty, .records-reader-empty').length, handles: document.querySelectorAll('.haedo-split-handle').length,
            content: main.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight), list: list.getBoundingClientRect().width, app: document.querySelector('.life-app').getBoundingClientRect() };
        });
        assert.deepEqual([layout.split, layout.wide, layout.placeholder, layout.handles], [null, 'records', 0, 0], width + ': list only, no placeholder or separator');
        assert(Math.abs(layout.list - layout.content) <= 1, width + ': the list fills the content width');
        // Wider than the 720px reading column, capped at 960px so rows stay scannable on very wide screens.
        assert.equal(Math.round(layout.content), Math.min(960, Math.round(layout.app.width - 48)), width + ': content width ' + layout.content);
        assert(layout.content > 720 && layout.content <= 960);
        assert(layout.app.right <= width - 23.5, width + ': right gutter');
        if (width === 1440 || width === 1920) await capture(page, 'records-list-' + width); else assert.equal(await horizontalOverflow(page), false);
      }
      await page.setViewportSize({ width: 1440, height: 960 }); await frames(page);
      await openRecord(page, 2);
      const state = await split(page, '#lifeMain'); assertSeparator(state);
      assert.equal(state.controls, 'lifeRecordsPane'); assert.equal(state.now, 400, 'default list width'); assert.equal(state.stored, null);
      const rects = await page.evaluate(() => ({ pane: document.querySelector('#lifeRecordsPane').getBoundingClientRect().toJSON(), reader: document.querySelector('#lifeSourceText').getBoundingClientRect().toJSON(),
        column: document.querySelector('.records-reader-pane').getBoundingClientRect().toJSON(), handle: document.querySelector('.haedo-split-handle').getBoundingClientRect().toJSON() }));
      assert(rects.pane.right <= rects.handle.left + 13 && rects.handle.right <= rects.reader.left, 'list, separator, reader from left to right');
      assert(rects.reader.width <= 720.5, 'reading measure stays within 720px');
      const content = await page.evaluate(() => { const main = document.querySelector('#lifeMain'), css = getComputedStyle(main); return main.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight); });
      assert.equal(state.max, Math.floor(content - 44 - 420), 'maximum leaves the reader 420px');
      for (const width of [1101, 1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 960 }); await frames(page);
        const shown = await split(page, '#lifeMain'); assertSeparator(shown);
        assert.equal(shown.now, Math.min(400, shown.max), width + ': default width, clamped to the window');
        const app = await page.evaluate(() => document.querySelector('.life-app').getBoundingClientRect().right);
        assert(Math.abs(app - (width - 24)) <= 1, width + ': the split fills the width up to the 24px gutter (no 1200px cap)');
        if (width === 1440 || width === 1920) await capture(page, 'records-split-' + width); else assert.equal(await horizontalOverflow(page), false);
      }
      const wideReader = await page.evaluate(() => { const reader = document.querySelector('.records-reader-pane > .life-reader').getBoundingClientRect(), column = document.querySelector('.records-reader-pane').getBoundingClientRect(); return { width: reader.width, left: reader.left - column.left, right: column.right - reader.right }; });
      assert(wideReader.width <= 720.5 && Math.abs(wideReader.left - wideReader.right) <= 1, '1920: the 720px reading column is centred in the extra width');
    });

    await check('records separator: mouse drag, Escape, clamps, keyboard, reset, persistence, re-clamp and clean-up', async ({ page }) => {
      await seedRecords(page); await nav(page, 'records'); await openRecord(page);
      // Reading in the middle of the original: the line at a third of the window stays there while the column reflows.
      await page.evaluate(() => scrollTo({ top: 2400, behavior: 'instant' })); await frames(page);
      const anchor = () => page.evaluate(() => {
        const reader = document.querySelector('#lifeSourceText'), box = reader.getBoundingClientRect(), range = document.caretRangeFromPoint(box.left + 2, innerHeight / 3);
        return { offset: range.startContainer === reader.firstChild ? range.startOffset : null, scrollY };
      });
      const before = await anchor();
      const moved = await drag(page, '#lifeMain', 120, { release: false });
      assert.equal(moved.during.dragging, 'true', 'drag state while the pointer is down');
      assert.equal(moved.during.now, 520, 'rAF update during the drag'); assert.equal(moved.during.stored, null, 'stored only when the drag ends');
      await page.mouse.up(); await frames(page);
      let state = await split(page, '#lifeMain'); assertSeparator(state);
      assert.equal(state.now, 520); assert.equal(state.stored, '520'); assert.equal(state.dragging, null);
      assert.equal(await page.evaluate(() => getSelection().toString()), '', 'dragging selects no text');
      const after = await anchor();
      assert(before.offset !== null && after.offset !== null && Math.abs(after.offset - before.offset) <= 90, 'the line being read stays in place: ' + JSON.stringify({ before, after }));
      // Escape cancels a drag back to where it started; it does not close the reader.
      await drag(page, '#lifeMain', 96, { release: false });
      assert.equal((await split(page, '#lifeMain')).now, 616);
      await page.keyboard.press('Escape'); await frames(page);
      state = await split(page, '#lifeMain'); assert.equal(state.now, 520); assert.equal(state.stored, '520'); assert.equal(state.dragging, null);
      await page.mouse.move(state.x + 200, state.y); await page.mouse.up(); await frames(page);
      assert.equal((await split(page, '#lifeMain')).now, 520, 'the cancelled drag stays cancelled');
      assert.equal(await page.locator('#lifeSourceText').isVisible(), true, 'Escape during a drag keeps the reader open');
      // Clamps: list 280px at least, reader 420px at least.
      await drag(page, '#lifeMain', -1000); state = await split(page, '#lifeMain'); assertSeparator(state); assert.equal(state.now, 280); assert.equal(state.stored, '280');
      await drag(page, '#lifeMain', 3000); state = await split(page, '#lifeMain'); assertSeparator(state);
      assert.equal(state.now, state.max); assert.equal(state.stored, String(state.max)); assert(Math.abs(state.columns[2] - 420) <= 1, 'reader at its 420px minimum');
      // Keyboard: ±16px, Shift ±64px, Home/End, Enter resets; page scroll does not move.
      const handle = page.locator('#lifeMain > .haedo-split-handle');
      await handle.focus(); const scrollY = await page.evaluate(() => scrollY);
      await page.keyboard.press('Home'); assert.equal((await split(page, '#lifeMain')).now, 280);
      await page.keyboard.press('ArrowRight'); assert.equal((await split(page, '#lifeMain')).now, 296);
      await page.keyboard.press('Shift+ArrowRight'); assert.equal((await split(page, '#lifeMain')).now, 360);
      await page.keyboard.press('ArrowLeft'); state = await split(page, '#lifeMain'); assert.equal(state.now, 344); assert.equal(state.stored, '344');
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Shift+ArrowLeft'); assert.equal((await split(page, '#lifeMain')).now, 280, 'keys stop at the minimum');
      await page.keyboard.press('End'); state = await split(page, '#lifeMain'); assert.equal(state.now, state.max);
      await page.keyboard.press('ArrowRight'); assert.equal((await split(page, '#lifeMain')).now, state.max, 'keys stop at the maximum');
      assert.equal(await page.evaluate(() => scrollY), scrollY, 'Home/End on the separator do not scroll the page');
      assert.deepEqual(await handle.evaluate(node => ({ focus: node.matches(':focus-visible'), ring: getComputedStyle(node.querySelector('.haedo-split-grip')).outlineStyle })), { focus: true, ring: 'solid' }, 'visible focus ring');
      await page.keyboard.press('Enter'); state = await split(page, '#lifeMain'); assert.equal(state.now, 400); assert.equal(state.stored, null, 'Enter resets to the default');
      await page.keyboard.press('Shift+ArrowRight'); assert.equal((await split(page, '#lifeMain')).now, 464);
      await handle.dblclick(); await frames(page); state = await split(page, '#lifeMain'); assert.equal(state.now, 400); assert.equal(state.stored, null, 'double-click resets');
      // Persistence on this device, after a reload.
      await drag(page, '#lifeMain', 136); assert.equal((await split(page, '#lifeMain')).stored, '536');
      await page.reload(); await ready(page); await settle(page);
      if (!await page.locator('#lifeRecordsPane').count()) { await nav(page, 'records'); await openRecord(page); }
      state = await split(page, '#lifeMain'); assertSeparator(state); assert.equal(state.now, 536, 'chosen width after reload');
      // A narrower window shows a clamped width; the preference returns when it widens again.
      await page.setViewportSize({ width: 1101, height: 900 }); await frames(page); await frames(page);
      state = await split(page, '#lifeMain'); assertSeparator(state); assert.equal(state.now, state.max); assert(state.max < 536); assert.equal(state.stored, '536');
      assert.equal(await horizontalOverflow(page), false);
      await page.setViewportSize({ width: 1920, height: 1000 }); await frames(page); await frames(page);
      assert.equal((await split(page, '#lifeMain')).now, 536);
      // Leaving the reader removes the separator and its observer.
      await page.locator('#lifeSearchReturn').click(); await settle(page);
      assert.deepEqual(await page.evaluate(() => ({ handles: document.querySelectorAll('.haedo-split-handle').length, width: document.querySelector('#lifeMain').style.getPropertyValue('--haedo-split-list'), observers: window.__splitObservers.size })), { handles: 0, width: '', observers: 0 });
      for (let round = 0; round < 3; round++) { await openRecord(page, round); await page.locator('#lifeSearchReturn').click(); await settle(page); }
      await openRecord(page); await nav(page, 'schedule');
      assert.deepEqual(await page.evaluate(() => ({ handles: document.querySelectorAll('.haedo-split-handle').length, observers: window.__splitObservers.size })), { handles: 0, observers: 0 }, 'no listeners left after repeated opens');
    }, { width: 1920, height: 1000 });

    await check('a press without moving keeps the stored width; the resize scroll is not saved as reading', async ({ page }) => {
      await seedRecords(page); await page.evaluate(([key]) => localStorage.setItem(key, '536'), [RECORDS_KEY]);
      await nav(page, 'records'); await openRecord(page);
      assert.equal((await split(page, '#lifeMain')).now, 536);
      // Narrow window: the shown width is clamped; a click or a touch tap on the line must not store that clamp.
      await page.setViewportSize({ width: 1101, height: 900 }); await frames(page); await frames(page);
      let state = await split(page, '#lifeMain'); assert(state.now < 536); assert.equal(state.stored, '536');
      await page.mouse.click(state.x, state.y); await frames(page);
      state = await split(page, '#lifeMain'); assert.equal(state.stored, '536', 'a click keeps the preference'); assert.equal(state.now, state.max);
      await page.mouse.move(state.x, state.y); await page.mouse.down(); await page.mouse.move(state.x + 0.2, state.y + 30); await page.mouse.up(); await frames(page);
      assert.equal((await split(page, '#lifeMain')).stored, '536', 'a press that does not move the line keeps the preference');
      await page.evaluate(({ x, y }) => {
        const handle = document.querySelector('#lifeMain > .haedo-split-handle'), init = { pointerId: 41, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: 1 };
        handle.dispatchEvent(new PointerEvent('pointerdown', init)); handle.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
      }, state); await frames(page);
      assert.equal((await split(page, '#lifeMain')).stored, '536', 'a touch tap keeps the preference');
      await page.setViewportSize({ width: 1920, height: 1000 }); await frames(page); await frames(page);
      assert.equal((await split(page, '#lifeMain')).now, 536, 'the chosen width returns on a wide window');
      // A touch drag (synthetic pointer events) still chooses a width.
      state = await split(page, '#lifeMain');
      await page.evaluate(({ x, y }) => {
        const handle = document.querySelector('#lifeMain > .haedo-split-handle'), init = { pointerId: 42, pointerType: 'touch', isPrimary: true, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: 1 };
        handle.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: x })); handle.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: x - 56 }));
        return new Promise(resolve => requestAnimationFrame(() => { handle.dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: x - 56, buttons: 0 })); resolve(); }));
      }, state); await frames(page);
      state = await split(page, '#lifeMain'); assert.equal(state.now, 480); assert.equal(state.stored, '480', 'a touch drag stores its width');
      // Reading in the middle with recent scroll intent (a wheel turn): dragging reflows the column and the module
      // scrolls to keep the line; that program scroll must not be saved as the reading position.
      await page.locator('#lifeMain > .haedo-split-handle').focus(); await page.keyboard.press('End'); state = await split(page, '#lifeMain'); assert.equal(state.now, 700);
      await page.evaluate(() => scrollTo({ top: 2400, behavior: 'instant' })); await frames(page);
      const position = () => page.evaluate(async () => JSON.stringify(await HaedoLife.Shell.storage.readReadingPosition(await HaedoLife.Shell.storage.getActive())));
      await page.waitForTimeout(600); const before = await position();
      await page.mouse.move(state.x, state.y); await page.mouse.down(); await page.mouse.wheel(4, 0);
      for (let step = 1; step <= 8; step++) { await page.mouse.move(state.x - step * 50, state.y); await frames(page); }
      await page.mouse.up(); await frames(page);
      const held = await page.evaluate(() => ({ y: scrollY, now: document.querySelector('#lifeMain > .haedo-split-handle').getAttribute('aria-valuenow'), h: document.documentElement.scrollHeight }));
      assert(held.y !== 2400 && held.now === '300', 'the reading line was held by a program scroll: ' + JSON.stringify(held));
      await page.waitForTimeout(1200);
      assert.equal(await position(), before, 'no reading position from the resize scroll');
      assert.equal(await page.evaluate(() => HaedoLife.SplitResize.adjusting()), false);
    }, { width: 1920, height: 1000 });

    await check('stored widths that are not numbers are ignored; storage failure keeps the drag working', async ({ page }) => {
      await seedRecords(page);
      await nav(page, 'records');
      for (const value of ['abc', '-5', '99999999', '1e3', ' 400', '']) {
        await toList(page); await page.evaluate(([key, value]) => localStorage.setItem(key, value), [RECORDS_KEY, value]);
        await openRecord(page);
        assert.equal((await split(page, '#lifeMain')).now, 400, JSON.stringify(value) + ' falls back to the default');
      }
      // Blocked storage for the width keys only (other app state is not part of this check).
      await page.evaluate(() => {
        for (const name of ['getItem', 'setItem', 'removeItem']) {
          const native = Storage.prototype[name];
          Storage.prototype[name] = function (key, ...rest) { if (String(key).startsWith('caeyeon_life_split_')) throw new DOMException('blocked', 'SecurityError'); return native.call(this, key, ...rest); };
        }
      });
      await openRecord(page);
      await drag(page, '#lifeMain', 48); const state = await split(page, '#lifeMain');
      assert.equal(state.now, 448); assert.equal(state.stored, 'unreadable');
    });

    await check('below 1101px there is no separator and the reader replaces the list as before', async ({ page }) => {
      await seedRecords(page); await page.evaluate(([key]) => localStorage.setItem(key, '600'), [RECORDS_KEY]);
      await nav(page, 'records'); await openRecord(page);
      for (const [width, height] of [[1100, 900], [820, 1180], [390, 844]]) {
        await page.setViewportSize({ width, height }); await frames(page);
        const layout = await page.evaluate(() => ({ handle: document.querySelector('.haedo-split-handle')?.checkVisibility() ?? false, pane: document.querySelector('#lifeRecordsPane')?.checkVisibility() ?? false,
          reader: document.querySelector('#lifeSourceText').checkVisibility(), display: getComputedStyle(document.querySelector('#lifeMain')).display, placeholder: document.querySelectorAll('.records-reader-empty').length }));
        assert.deepEqual(layout, { handle: false, pane: false, reader: true, display: 'block', placeholder: 0 }, width + ': single column');
        assert.equal(await horizontalOverflow(page), false, width + ': horizontal overflow');
        await page.locator('#lifeSearchReturn').click(); await settle(page);
        const list = await page.evaluate(() => { const main = document.querySelector('#lifeMain'), css = getComputedStyle(main); return { width: main.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight), placeholder: document.querySelectorAll('.records-reader-empty').length }; });
        assert(list.width <= 720.5 && list.placeholder === 0, width + ': the list keeps its 720px column');
        await openRecord(page);
      }
      await page.setViewportSize({ width: 1920, height: 1000 }); await frames(page);
      assert.equal((await split(page, '#lifeMain')).now, 600, 'the stored width applies again when the window widens');
    }, { width: 1100, height: 900 });

    await check('news list has no reading column until an article opens; closing returns to the list and the row', async ({ page }) => {
      await nav(page, 'news'); await idle(page);
      const listOnly = async label => {
        const layout = await page.evaluate(() => {
          const main = document.querySelector('#lifeMain'), css = getComputedStyle(main), host = document.querySelector('#discoveryReaderHost'), list = document.querySelector('#discoveryListPane');
          return { split: main.dataset.split || null, wide: main.dataset.wide || null, handles: document.querySelectorAll('.haedo-split-handle').length, reading: document.querySelector('#discoveryReview').dataset.reading,
            host: host.checkVisibility(), hostChildren: host.childElementCount, placeholder: document.querySelectorAll('.discovery-reader-empty').length, text: document.body.innerText.includes('목록에서 글을 고르면'),
            content: main.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight), list: list.getBoundingClientRect().width, app: document.querySelector('.life-app').getBoundingClientRect().width };
        });
        assert.deepEqual([layout.split, layout.wide, layout.handles, layout.reading, layout.host, layout.hostChildren, layout.placeholder, layout.text], [null, 'news', 0, 'false', false, 0, 0, false], label + ': list only');
        assert(Math.abs(layout.list - layout.content) <= 1, label + ': the list fills the content width');
        assert.equal(Math.round(layout.content), Math.min(960, Math.round(layout.app - 48)), label + ': same frame as the 자료 list');
      };
      for (const width of [1101, 1440, 1920]) {
        await page.setViewportSize({ width, height: 960 }); await frames(page); await listOnly(String(width));
        if (width !== 1101) await capture(page, 'news-list-' + width); else assert.equal(await horizontalOverflow(page), false);
      }
      await page.setViewportSize({ width: 1440, height: 960 }); await frames(page);
      const row = page.locator('#discoveryList [data-discovery-id="910002"] [data-discovery-select]');
      await row.click(); await idle(page); await frames(page); await page.locator('#discoveryReaderFrame').waitFor();
      let state = await split(page, '.discovery-layout'); assertSeparator(state);
      assert.equal(state.controls, 'discoveryListPane'); assert.equal(state.now, 440, 'news default list width'); assert.equal(state.stored, null);
      assert.equal(await page.evaluate(() => [document.querySelector('#lifeMain').dataset.split, document.querySelector('#lifeMain').dataset.wide || null].join()), 'news,');
      const back = page.locator('#discoveryReaderBack');
      assert.deepEqual(await back.evaluate(node => { const box = node.getBoundingClientRect(); return { visible: node.checkVisibility(), name: node.getAttribute('aria-label'), width: Math.round(box.width), height: Math.round(box.height) }; }),
        { visible: true, name: '뉴스로 돌아가기', width: 44, height: 44 }, 'wide screens can close the reading column');
      await capture(page, 'news-open-1440');
      await page.setViewportSize({ width: 1920, height: 1000 }); await frames(page); await capture(page, 'news-open-1920');
      await page.setViewportSize({ width: 1440, height: 960 }); await frames(page);
      const historyLength = await page.evaluate(() => history.length);
      await back.click(); await idle(page); await frames(page);
      await listOnly('closed');
      assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-discovery-id]')?.dataset.discoveryId), '910002', 'focus returns to the opened row');
      assert.equal(await page.evaluate(() => history.length), historyLength, 'closing on a wide screen writes no history');
      assert.equal(await page.evaluate(() => window.__splitObservers.size), 0, 'closing removes the separator observer');
      // Narrow screens keep their behaviour: the reader replaces the list; back returns to the same row.
      await page.setViewportSize({ width: 820, height: 1180 }); await frames(page); await capture(page, 'news-list-820');
      await row.click(); await idle(page); await frames(page);
      assert.deepEqual(await page.evaluate(() => ({ list: document.querySelector('#discoveryListPane').checkVisibility(), reader: document.querySelector('#discoveryReader').checkVisibility(), handle: document.querySelector('.haedo-split-handle')?.checkVisibility() ?? false })), { list: false, reader: true, handle: false });
      await capture(page, 'news-open-820');
      await page.goBack(); await idle(page); await frames(page);
      assert.equal(await page.evaluate(() => document.querySelector('#discoveryReview').dataset.reading), 'false', 'browser back closes the narrow reader');
      await page.setViewportSize({ width: 390, height: 844 }); await frames(page); await capture(page, 'news-list-390');
      await row.click(); await idle(page); await frames(page); await capture(page, 'news-open-390');
      await page.locator('#discoveryReaderBack').click(); await idle(page); await frames(page);
      assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-discovery-id]')?.dataset.discoveryId), '910002', 'phone back returns to the row');
    });

    await check('news separator: drag, clamps, keyboard, persistence and no separator below 1101px', async ({ page }) => {
      await nav(page, 'news'); await idle(page);
      await page.locator('#discoveryList [data-discovery-id="910001"] [data-discovery-select]').click(); await idle(page); await frames(page);
      await page.locator('#discoveryReaderFrame').waitFor();
      let state = await split(page, '.discovery-layout'); assertSeparator(state);
      const moved = await drag(page, '.discovery-layout', -100, { release: false });
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#discoveryReaderFrame')).pointerEvents), 'none', 'the frame cannot take the pointer while dragging');
      assert.equal(moved.during.now, 340); await page.mouse.up(); await frames(page);
      state = await split(page, '.discovery-layout'); assert.equal(state.now, 340); assert.equal(state.stored, '340');
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#discoveryReaderFrame')).pointerEvents), 'auto');
      await drag(page, '.discovery-layout', 64, { release: false }); await page.keyboard.press('Escape'); await page.mouse.up(); await frames(page);
      assert.equal((await split(page, '.discovery-layout')).now, 340); assert.equal(await page.locator('#discoveryReader').isVisible(), true, 'Escape during a drag keeps the article open');
      await drag(page, '.discovery-layout', -1000); assert.equal((await split(page, '.discovery-layout')).now, 280);
      await drag(page, '.discovery-layout', 3000); state = await split(page, '.discovery-layout'); assertSeparator(state); assert.equal(state.now, state.max); assert(Math.abs(state.columns[2] - 420) <= 1);
      await page.locator('.discovery-layout > .haedo-split-handle').focus();
      await page.keyboard.press('Home'); assert.equal((await split(page, '.discovery-layout')).now, 280);
      await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('ArrowRight'); state = await split(page, '.discovery-layout'); assert.equal(state.now, 360); assert.equal(state.stored, '360');
      assert.equal((await split(page, '#lifeMain')).stored, null, 'news and records keep separate widths');
      await capture(page, 'news-split-1440');
      await page.setViewportSize({ width: 1920, height: 1000 }); await frames(page);
      state = await split(page, '.discovery-layout'); assertSeparator(state); assert.equal(state.now, 360); await capture(page, 'news-split-1920');
      await page.reload(); await ready(page); await settle(page);
      if (!await page.locator('.discovery-layout').count()) { await nav(page, 'news'); }
      await idle(page);
      if (!await page.locator('#discoveryReaderFrame').count()) { await page.locator('#discoveryList [data-discovery-id="910001"] [data-discovery-select]').click(); await idle(page); await frames(page); }
      state = await split(page, '.discovery-layout'); assert.equal(state.now, 360, 'news width after reload');
      for (const [width, height] of [[1100, 900], [820, 1180], [390, 844]]) {
        await page.setViewportSize({ width, height }); await frames(page);
        assert.equal(await page.evaluate(() => document.querySelector('.haedo-split-handle')?.checkVisibility() ?? false), false, width + ': no separator');
        assert.equal(await horizontalOverflow(page), false, width + ': horizontal overflow');
      }
      await page.setViewportSize({ width: 1440, height: 960 }); await frames(page); await nav(page, 'records');
      assert.deepEqual(await page.evaluate(() => ({ handles: document.querySelectorAll('.haedo-split-handle').length, observers: window.__splitObservers.size })), { handles: 0, observers: 0 }, 'leaving news removes its separator');
    }, { width: 1440, height: 960 });
  } finally {
    await browser.close();
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  const failed = report.checks.filter(item => !item.pass).length;
  console.log(JSON.stringify({ passed: report.checks.length - failed, failed, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length }));
  if (failed || report.consoleErrors.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });

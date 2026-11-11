/* 2026-11-11 자료 읽기: 읽기 칸 너비가 바뀌어도 읽던 줄을 잃지 않는다.
 * A. 문서 가를 중간까지 읽기 → 문서 나 열기 → 구분선으로 폭 변경 → 문서 가 다시 열기 (세션 안 위치가 scrollY가 아니라 글자 기준).
 * B. 읽는 중 화면 폭만 바꿈(창 크기, 가로·세로 전환). 일반 텍스트와 Markdown 서식 보기.
 * C. 보정은 너비가 바뀐 그때 한 번뿐이고, 그 뒤의 사람 스크롤을 되돌리지 않는다. 계정에 올라가는 읽기 위치는 바뀌지 않는다.
 * D. 읽는 줄은 스크롤이 멎은 뒤에 한 번만 잰다(스크롤 프레임마다 재지 않는다). 아직 재지 않은 스크롤 바로 뒤에 너비가
 *    바뀌어도 그때 화면에 있던 줄을 지킨다.
 * npm run dev; node tests/reader-position-resize-browser.cjs
 * 허용 오차는 글자 높이 기준이다: 읽는 줄(화면 높이 1/3)에 있던 바로 그 글자가 너비가 바뀐 뒤에도 같은 화면 높이(회전 뒤에는
 * 화면 높이의 같은 비율)에서 반 줄 안에 있어야 한다. 실측 오차는 0~1px이다. 수정 전에는 27~50문단 어긋났다.
 * 사람이 다른 너비에서 스크롤한 뒤에는 그때 읽는 줄(그 너비에서의 줄 첫 글자)이 새 기준이다. 그 글자는 처음 너비에서 바로
 * 윗줄에 있을 수 있으므로, 처음 글자와 비교할 때만 한 줄을 더 허용한다.
 * Markdown 서식 보기는 글자가 아니라 문단(블록)과 그 안의 높이 비율로 기억한다(서식 화면에는 원문 글자 위치가 없다). 줄 수가
 * 달라진 문단 안에서 같은 비율의 지점은 글자 기준으로 한 줄까지 다를 수 있어, 서식 보기에는 한 줄을 더 허용한다.
 * Chromium viewport sizes: page.setViewportSize is not a real device rotation, and no WebKit run. */
'use strict';
const R = require('./helpers/records-reader.cjs');
const { assert, frames, settle } = R;
const S = R.suite('reader-position-resize', 'Local Chromium, synthetic Auth, anonymous records. Reading line across reading-column width changes.');
const paragraphs = (tag, count) => Array.from({ length: count }, (_, index) => `${tag}-${index + 1}번째 문단. 저녁마다 조금씩 읽어 나간 긴 글의 한 대목이다. 창밖이 어두워질 때까지 읽었고 다음 날에도 이어서 읽었다.`).join('\n\n');
const worst = { raw: 0, formatted: 0 };

// What is on the reading line (a third down the screen), in either view: the paragraph, and the exact character there
// (`mark`: which text node of the reader and which offset in it) with its height on screen. Given an earlier
// mark, `was` is where that same character is now. Run in the page; also used inside other page scripts.
const measure = mark => {
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
  return { para: (before.match(/가-(\d+)번째/g) || []).length, mark: [index, low], top: place(nodes[index], low), was: mark ? place(nodes[mark[0]], mark[1]) : null,
    y: Math.round(scrollY), height: innerHeight, lineHeight: parseFloat(getComputedStyle(element).lineHeight) || parseFloat(getComputedStyle(element).fontSize) * 1.6,
    width: Math.round(element.getBoundingClientRect().width), mode: element.dataset.readingMode,
    split: !!document.querySelector('#lifeRecordsPane')?.checkVisibility(), title: document.querySelector('.life-reader-heading').textContent };
};
const at = (page, before) => page.evaluate('(' + measure + ')(' + JSON.stringify(before?.mark || null) + ')');
const savedPosition = page => page.evaluate(async () => JSON.stringify((await HaedoLife.Shell.storage.readReadingPosition(await HaedoLife.Shell.storage.getActive())).position));
// The character that was on the reading line is at the same height (the same share of the screen after a rotation), within half a line.
// `lines`: whole lines allowed on top of that (only where the person scrolled at another width in between).
function same(before, after, label, extra = 0) {
  assert(Number.isFinite(before.para) && before.para > 20, label + ': reading in the middle (' + JSON.stringify(before) + ')');
  assert(Number.isFinite(after.was), label + ': measured where the earlier character is now');
  const want = before.top * after.height / before.height, error = Math.abs(after.was - want), lines = extra + (after.mode === 'formatted' ? 1 : 0);
  if (!extra) worst[after.mode] = Math.max(worst[after.mode], error);
  assert(error <= after.lineHeight * (lines + 0.5), label + ': the character being read stays at its height within ' + (lines + 0.5) + ' lines (' + after.lineHeight * (lines + 0.5) + 'px): wanted ' + want.toFixed(1) + ', is ' + after.was + ' · ' + JSON.stringify(before) + ' → ' + JSON.stringify(after));
}

async function main() {
  await S.start();
  try {
    await S.check('A. read 가, open 나, change the list width, reopen 가: the same paragraph (1440)', async () => {
      const { page, context } = await S.open({ width: 1440, height: 900 });
      const ids = await R.seed(page, [{ title: '문서 가', text: paragraphs('가', 400) }, { title: '문서 나', text: paragraphs('나', 40) }]);
      const pane = async index => { await page.locator(`#lifeRecordsPaneList .records-row[data-version-id="${ids[index].versionId}"] .records-row-open`).click(); await settle(page); await frames(page); await frames(page); };
      await R.openSource(page, ids[0].versionId);
      await page.locator('.haedo-split-handle').focus(); await page.keyboard.press('Home'); await frames(page);
      await R.wheel(page, 15000); await page.waitForTimeout(500);
      const before = await at(page);
      await pane(1);
      assert.equal((await at(page)).title, '문서 나');
      await page.locator('.haedo-split-handle').focus(); await page.keyboard.press('End'); await frames(page); await frames(page);
      await pane(0);
      const after = await at(page, before);
      assert.equal(after.title, '문서 가'); assert.notEqual(after.width, before.width, 'the reading column really changed width');
      same(before, after, 'reopen after a width change');
      // And back again at the first width, through the list as well.
      await pane(1); await page.locator('.haedo-split-handle').focus(); await page.keyboard.press('Home'); await frames(page); await frames(page);
      await pane(0);
      same(before, await at(page, before), 'reopen at the first width');
      await context.close();
    });

    await S.check('A. the separator while reading keeps the paragraph through many steps (no drift), and the scroll is not reading', async () => {
      const { page, context } = await S.open({ width: 1440, height: 900 });
      const ids = await R.seed(page, [{ title: '문서 가', text: paragraphs('가', 400) }]);
      await R.openSource(page, ids[0].versionId);
      await R.wheel(page, 15000); await page.waitForTimeout(700);
      const before = await at(page), position = await savedPosition(page);
      const handle = page.locator('.haedo-split-handle'); await handle.focus();
      // 16px steps reflow the text again and again; each one must return to the same character, not to a line start above it.
      // (The list goes 400px → 304 → 400 three times: inside its 280px minimum, so the steps cancel out.)
      for (let round = 0; round < 3; round++) for (const key of [...Array(6).fill('ArrowLeft'), ...Array(6).fill('ArrowRight')]) { await page.keyboard.press(key); await frames(page); }
      const after = await at(page, before);
      assert.equal(after.width, before.width); same(before, after, 'no drift over 36 width steps');
      assert(Math.abs(after.y - before.y) <= 2, 'back at the first width the page is where it was (' + before.y + ' → ' + after.y + ')');
      const box = await handle.boundingBox(); await page.mouse.move(box.x + box.width / 2, 450); await page.mouse.down();
      for (let step = 1; step <= 10; step++) { await page.mouse.move(box.x + box.width / 2 + step * 20, 450); await frames(page); }
      await page.mouse.up(); await frames(page); await frames(page);
      same(before, await at(page, before), 'after a mouse drag');
      await page.waitForTimeout(1200);
      assert.equal(await savedPosition(page), position, 'the program scroll was not saved as the reading position');
      assert.equal(await page.evaluate(() => HaedoLife.SplitResize.adjusting()), false);
      await context.close();
    });

    await S.check('C. a width change right after the page was scrolled elsewhere does not pull it back to the earlier line', async () => {
      const { page, context } = await S.open({ width: 1440, height: 900 });
      const ids = await R.seed(page, [{ title: '문서 가', text: paragraphs('가', 400) }]);
      await R.openSource(page, ids[0].versionId);
      await R.wheel(page, 15000); await page.waitForTimeout(500);
      const before = await at(page);
      // The app moves the page (as a return to an earlier place does) and the column reflows in the same frame,
      // before the scroll has been looked at. The line remembered at the old place must not be restored: the line
      // that was on screen at the new place, before the reflow, is the one kept.
      const moved = await page.evaluate('(() => { scrollTo({ top: 4000, behavior: "instant" }); const there = (' + measure + ')(null); document.querySelector("#lifeMain").style.setProperty("--haedo-split-list", "300px"); return there; })()');
      await frames(page); await frames(page); await page.waitForTimeout(200);
      const after = await at(page, moved);
      assert.notEqual(after.width, before.width, 'the reading column changed width');
      assert(moved.para < before.para - 50 && Math.abs(after.para - moved.para) <= 1, 'not pulled back to the earlier line: ' + before.para + ' → ' + moved.para + ' → ' + after.para);
      same(moved, after, 'the line at the place the page was moved to');
      // From there the line is kept again on the next width change.
      await page.evaluate(() => document.querySelector('#lifeMain').style.setProperty('--haedo-split-list', '420px')); await frames(page); await frames(page);
      same(moved, await at(page, moved), 'the new line on the next width change');
      await context.close();
    });

    await S.check('D. the line is measured after scrolling stops, not in every scrolled frame; a width change before that still keeps the line on screen', async () => {
      const { page, context } = await S.open({ width: 1440, height: 900 });
      const ids = await R.seed(page, [{ title: '문서 가', text: paragraphs('가', 400) }]);
      await R.openSource(page, ids[0].versionId);
      await R.wheel(page, 9000); await page.waitForTimeout(500);
      const start = await at(page);
      // 60 scrolled frames in a row: count the character measurements (Range rectangles) made meanwhile.
      // `one` is what a single measurement costs on this text (one scroll, then rest). A measurement may only
      // happen where the scrolling paused for the settle time; on a busy machine some frames are that far apart
      // (`slow`, counted in the same loop), so the bound follows the machine instead of a fixed number.
      const counted = await page.evaluate(async () => {
        const real = Range.prototype.getBoundingClientRect; let calls = 0;
        Range.prototype.getBoundingClientRect = function () { calls++; return real.call(this); };
        scrollBy(0, 40); await new Promise(resolve => setTimeout(resolve, 600));
        const one = calls; calls = 0;
        let slow = 0, last = performance.now();
        for (let frame = 0; frame < 60; frame++) { scrollBy(0, 40); await new Promise(resolve => requestAnimationFrame(resolve)); const now = performance.now(); if (now - last >= 100) slow++; last = now; }
        const during = calls;
        await new Promise(resolve => setTimeout(resolve, 600));
        Range.prototype.getBoundingClientRect = real;
        return { one, during, after: calls - during, slow };
      });
      assert(counted.one > 0, 'a measurement at rest was seen: ' + JSON.stringify(counted));
      // Measuring in every frame would be 60 measurements here.
      assert(counted.during <= (counted.slow + 1) * counted.one, 'no character measurement in every scrolled frame: ' + JSON.stringify(counted));
      assert(counted.after > 0, 'the line is measured once the scrolling has stopped: ' + JSON.stringify(counted));
      // Real wheel input, and the column changes width at once: in the frame the scroll arrives, before anything was measured.
      const viewport = page.viewportSize(); await page.mouse.move(viewport.width - 300, 450);
      const y = await page.evaluate(() => scrollY);
      await page.mouse.wheel(0, 3000);
      const moved = await page.evaluate('(async () => { while (scrollY < ' + (y + 2990) + ') await new Promise(resolve => requestAnimationFrame(resolve)); const there = (' + measure + ')(null); document.querySelector("#lifeMain").style.setProperty("--haedo-split-list", "300px"); return there; })()');
      await frames(page); await frames(page); await page.waitForTimeout(250);
      const after = await at(page, moved);
      assert.notEqual(after.width, start.width, 'the reading column changed width');
      assert(moved.para > start.para + 10, 'the wheel moved the reading on: ' + start.para + ' → ' + moved.para);
      same(moved, after, 'the line read after the wheel turn, not the one measured before it');
      // One frame after the scroll arrived (its event was seen, the measurement still waits): the same.
      const again = await page.evaluate('(async () => { scrollBy({ top: -1500, behavior: "instant" }); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); const there = (' + measure + ')(null); document.querySelector("#lifeMain").style.setProperty("--haedo-split-list", "420px"); return there; })()');
      await frames(page); await frames(page); await page.waitForTimeout(250);
      same(again, await at(page, again), 'the line read one frame after a scroll');
      assert.equal(await page.evaluate(() => HaedoLife.SplitResize.adjusting()), false);
      // What the measurement at rest is for: once the scrolling has rested, the remembered line is the one that was
      // on screen then, also when it is asked for after the page has started to move again (a reader closing).
      // keepLine itself, with an adapter that only counts.
      const rested = await page.evaluate(async () => {
        let calls = 0;
        const keeper = HaedoLife.SplitResize.keepLine(document.querySelector('#lifeSourceText'), { capture: () => { calls++; return { offset: Math.round(scrollY), top: 100, viewport: innerHeight }; }, top: () => 100 });
        scrollBy({ top: 200, behavior: 'instant' }); await new Promise(resolve => setTimeout(resolve, 600));
        const atRest = calls, y = Math.round(scrollY);
        scrollBy({ top: -150, behavior: 'instant' });
        const line = keeper.peek(); keeper.dispose();
        return { atRest, y, line, moved: Math.round(scrollY) };
      });
      assert.equal(rested.atRest, 1, 'one measurement once the scrolling rested: ' + JSON.stringify(rested));
      assert.equal(rested.line?.offset, rested.y, 'the line measured at rest stands after the page moved: ' + JSON.stringify(rested)); assert.equal(rested.moved, rested.y - 150);
      await context.close();
    });

    const cases = [['window 1440→1150', [1440, 900], [1150, 900], false], ['tablet portrait→landscape', [820, 1180], [1180, 820], true],
      ['tablet landscape→portrait', [1180, 820], [820, 1180], true], ['phone portrait→landscape', [390, 844], [844, 390], true]];
    for (const format of ['text/plain', 'text/markdown']) for (const [name, from, to, touch] of cases) await S.check('B. ' + format + ' ' + name + ': the paragraph stays, there and back', async () => {
      const { page, context } = await S.open({ width: from[0], height: from[1], touch });
      const ids = await R.seed(page, [{ title: '문서 가', text: paragraphs('가', 400), format }, { title: '문서 나', text: '짧은 글.' }]);
      await R.openSource(page, ids[0].versionId);
      await R.wheel(page, 15000); await page.waitForTimeout(700);
      const before = await at(page), position = await savedPosition(page);
      assert.equal(before.mode, format === 'text/markdown' ? 'formatted' : 'raw');
      await page.setViewportSize({ width: to[0], height: to[1] }); await frames(page); await page.waitForTimeout(400);
      const after = await at(page, before);
      assert.notEqual(after.width, before.width, 'the reading column changed width');
      same(before, after, name);
      // C. The correction happened once. Reading on is not pulled back.
      const y = after.y; await page.waitForTimeout(300);
      assert.equal((await at(page)).y, y, 'no further correction after the resize');
      const viewport = page.viewportSize(), box = await page.locator('#lifeSourceText').boundingBox();
      await page.mouse.move(Math.min(viewport.width - 8, box.x + box.width / 2), Math.min(viewport.height - 80, Math.max(140, viewport.height / 2)));
      await page.mouse.wheel(0, 600); await page.waitForTimeout(500);
      const read = await at(page);
      assert.equal(read.y, y + 600, 'the person\'s own scroll stays where they put it'); assert(read.para > after.para);
      await page.mouse.wheel(0, -600); await page.waitForTimeout(500);
      // Back to the first size. The person scrolled here, so the line now on the reading line is the one kept...
      const here = await at(page, before);
      assert.equal(here.y, y); same(before, here, name + ' after scrolling away and back');
      await page.setViewportSize({ width: from[0], height: from[1] }); await frames(page); await page.waitForTimeout(400);
      same(here, await at(page, here), name + ' and back');
      // ...and the character read at the very start is within a line of where it was.
      same(before, await at(page, before), name + ' and back, against the first character', 1);
      // Account-synced reading position: same format and meaning (one exact offset of this version), set by the wheel turns only.
      const stored = JSON.parse(await savedPosition(page));
      assert.deepEqual(Object.keys(stored).sort(), ['offset', 'sourceId', 'sourceVersionId', 'updatedAt']); assert.equal(stored.sourceVersionId, ids[0].versionId); assert(Number.isInteger(stored.offset));
      assert.equal(JSON.parse(position).sourceVersionId, ids[0].versionId);
      await context.close();
    });

    await S.check('the excerpt panel returns to the line being read, also when the column changed width meanwhile', async () => {
      const { page, context } = await S.open({ width: 1440, height: 900 });
      const ids = await R.seed(page, [{ title: '문서 가', text: paragraphs('가', 400) }]);
      await R.openSource(page, ids[0].versionId);
      await R.wheel(page, 15000); await page.waitForTimeout(500);
      const before = await at(page);
      await R.pressAt(page, '#lifeExcerptToggle'); await page.locator('#lifeExcerptPanel').waitFor();
      await page.setViewportSize({ width: 1150, height: 900 }); await frames(page); await page.waitForTimeout(300);
      await page.locator('#lifeExcerptPanel .life-panel-heading button').click(); await frames(page); await frames(page);
      same(before, await at(page, before), 'closing the excerpt panel');
      // Leaving and reopening from the list still returns there.
      // (Pressed where it is: a locator click may scroll the page first, which a person's press never does.)
      await R.pressAt(page, '#lifeSearchReturn'); await settle(page);
      await page.locator(`.life-source-open[data-version-id="${ids[0].versionId}"], .records-row[data-version-id="${ids[0].versionId}"] .records-row-open`).first().click(); await settle(page); await frames(page); await frames(page);
      same(before, await at(page, before), 'reopen from the list');
      await context.close();
    });
    console.log('largest distance of the read character from its height: original text ' + worst.raw.toFixed(1) + 'px, formatted view ' + worst.formatted.toFixed(1) + 'px');
  } finally { await S.finish(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

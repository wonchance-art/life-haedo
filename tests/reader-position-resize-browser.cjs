/* 2026-11-11 자료 읽기: 읽기 칸 너비가 바뀌어도 읽던 줄을 잃지 않는다.
 * A. 문서 가를 중간까지 읽기 → 문서 나 열기 → 구분선으로 폭 변경 → 문서 가 다시 열기 (세션 안 위치가 scrollY가 아니라 글자 기준).
 * B. 읽는 중 화면 폭만 바꿈(창 크기, 가로·세로 전환). 일반 텍스트와 Markdown 서식 보기.
 * C. 보정은 너비가 바뀐 그때 한 번뿐이고, 그 뒤의 사람 스크롤을 되돌리지 않는다. 계정에 올라가는 읽기 위치는 바뀌지 않는다.
 * npm run dev; node tests/reader-position-resize-browser.cjs
 * 허용 오차는 문단 ±1이다: 읽는 줄(화면 높이 1/3)의 첫 글자를 같은 높이에 되돌리므로, 줄바꿈이 달라진 뒤 그 높이에 걸치는
 * 문단이 바로 옆 문단일 수 있다(문단 하나는 2~4줄). 수정 전에는 27~50문단 어긋났다.
 * Chromium viewport sizes: page.setViewportSize is not a real device rotation, and no WebKit run. */
'use strict';
const R = require('./helpers/records-reader.cjs');
const { assert, frames, settle } = R;
const S = R.suite('reader-position-resize', 'Local Chromium, synthetic Auth, anonymous records. Reading line across reading-column width changes.');
const paragraphs = (tag, count) => Array.from({ length: count }, (_, index) => `${tag}-${index + 1}번째 문단. 저녁마다 조금씩 읽어 나간 긴 글의 한 대목이다. 창밖이 어두워질 때까지 읽었고 다음 날에도 이어서 읽었다.`).join('\n\n');
const TOLERANCE = 1;

// Which paragraph is on the reading line (a third down the screen), in either view.
const at = page => page.evaluate(() => {
  const element = document.querySelector('#lifeSourceText'); let para;
  if (element.dataset.readingMode === 'formatted') {
    const block = [...element.querySelectorAll('[data-source-block]')].find(item => item.getBoundingClientRect().bottom > innerHeight / 3);
    para = Number(block?.textContent.match(/가-(\d+)번째/)?.[1]);
  } else {
    const node = element.firstChild, range = document.createRange(); let low = 0, high = node.length;
    while (low < high) { const mid = (low + high) >> 1; range.setStart(node, mid); range.setEnd(node, Math.min(node.length, mid + 1)); if (range.getBoundingClientRect().bottom < innerHeight / 3) low = mid + 1; else high = mid; }
    para = (node.data.slice(0, low + 1).match(/가-(\d+)번째/g) || []).length;
  }
  return { para, y: Math.round(scrollY), width: Math.round(element.getBoundingClientRect().width), mode: element.dataset.readingMode,
    split: !!document.querySelector('#lifeRecordsPane')?.checkVisibility(), title: document.querySelector('.life-reader-heading').textContent };
});
const savedPosition = page => page.evaluate(async () => JSON.stringify((await HaedoLife.Shell.storage.readReadingPosition(await HaedoLife.Shell.storage.getActive())).position));
function same(before, after, label) {
  assert(Number.isFinite(before.para) && before.para > 20, label + ': reading in the middle (' + JSON.stringify(before) + ')');
  assert(Math.abs(after.para - before.para) <= TOLERANCE, label + ': the paragraph being read stays on the reading line: ' + JSON.stringify(before) + ' → ' + JSON.stringify(after));
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
      const after = await at(page);
      assert.equal(after.title, '문서 가'); assert.notEqual(after.width, before.width, 'the reading column really changed width');
      same(before, after, 'reopen after a width change');
      // And back again at the first width, through the list as well.
      await pane(1); await page.locator('.haedo-split-handle').focus(); await page.keyboard.press('Home'); await frames(page); await frames(page);
      await pane(0);
      same(before, await at(page), 'reopen at the first width');
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
      const after = await at(page);
      assert.equal(after.width, before.width); assert(Math.abs(after.para - before.para) <= TOLERANCE, 'no drift over 36 width steps: ' + JSON.stringify(before) + ' → ' + JSON.stringify(after));
      assert(Math.abs(after.y - before.y) <= 40, 'back at the first width the page is where it was (' + before.y + ' → ' + after.y + ')');
      const box = await handle.boundingBox(); await page.mouse.move(box.x + box.width / 2, 450); await page.mouse.down();
      for (let step = 1; step <= 10; step++) { await page.mouse.move(box.x + box.width / 2 + step * 20, 450); await frames(page); }
      await page.mouse.up(); await frames(page); await frames(page);
      same(before, await at(page), 'after a mouse drag');
      await page.waitForTimeout(1200);
      assert.equal(await savedPosition(page), position, 'the program scroll was not saved as the reading position');
      assert.equal(await page.evaluate(() => HaedoLife.SplitResize.adjusting()), false);
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
      const after = await at(page);
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
      // Back to the first size: the same paragraph again.
      await page.setViewportSize({ width: from[0], height: from[1] }); await frames(page); await page.waitForTimeout(400);
      same(before, await at(page), name + ' and back');
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
      same(before, await at(page), 'closing the excerpt panel');
      // Leaving and reopening from the list still returns there.
      // (Pressed where it is: a locator click may scroll the page first, which a person's press never does.)
      await R.pressAt(page, '#lifeSearchReturn'); await settle(page);
      await page.locator(`.life-source-open[data-version-id="${ids[0].versionId}"], .records-row[data-version-id="${ids[0].versionId}"] .records-row-open`).first().click(); await settle(page); await frames(page); await frames(page);
      same(before, await at(page), 'reopen from the list');
      await context.close();
    });
  } finally { await S.finish(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

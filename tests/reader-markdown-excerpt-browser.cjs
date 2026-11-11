/* 2026-11-11 자료 읽기: Markdown 서식 보기에서 구절을 고른 채 `발췌와 주제 연결`을 누를 때.
 * 서식 화면의 선택으로는 발췌 위치(locator)를 만들지 않는다. 같은 글자열이 원문의 다른 자리(서식 기호 뒤, 링크 주소 안,
 * 다른 목록 항목·표 칸·인용 문단)에 있을 수 있어서, 글자열이 원문에 한 번뿐이어도 고른 자리를 증명하지 못한다.
 * (정확 일치 경로를 넣었다가 독립 검수에서 다른 자리로 저장되는 사례가 확인돼 철회했다: 아래 사례가 그 목록이다.)
 * 그래서: 발췌 패널로 건너뛰지 않고, 읽던 문단을 같은 화면 높이에 둔 채 원문 보기로 바꾸며, 도구 줄 아래에
 * 원문 텍스트에서 다시 선택하라는 안내를 보인다. 원문 보기에서 고른 구절은 이전처럼 글자 단위로 정확히 저장된다.
 * npm run dev; node tests/reader-markdown-excerpt-browser.cjs
 * Chromium with a real mouse drag, triple-click and the keyboard. A real touch selection is not covered. */
'use strict';
const R = require('./helpers/records-reader.cjs');
const { assert, frames, settle } = R;
const S = R.suite('reader-markdown-excerpt', 'Local Chromium, synthetic Auth, anonymous Markdown records. A passage picked in the formatted view never becomes an excerpt locator.');
const pad = (from, count) => Array.from({ length: count }, (_, index) => `채움 문단 ${from + index}은 읽기 화면을 길게 만들려고 넣은 익명 문장이다.`).join('\n\n');
const NOTICE = '발췌할 구절은 원문 텍스트에서 다시 선택해 주세요.';
const INSTRUCTION = '원문에서 발췌할 구절을 선택하세요.';
// Each case: the raw text, a rendered block (by text it contains), what is picked there, and where that place is in the raw text.
// In the first seven the picked words stand somewhere else in the raw text too (or only there): a locator from them would be wrong.
const cases = [
  { name: 'the same words later in the same paragraph (formatting inside the first)', raw: '# 가\n\n' + pad(1, 12) + '\n\n**중요한 것은** 꾸준함이다. 그러나 중요한 것은 꾸준함이 아니라고도 한다.\n\n' + pad(13, 12),
    block: '중요한 것은 꾸준함이다', pick: '중요한 것은 꾸준함이', rawStart: '**중요한 것은**' },
  { name: 'another list item holds the plain words', raw: '# 나\n\n' + pad(1, 12) + '\n\n- **사과** 맛있다\n- 배는 시원하다\n- 사과 맛있다고 친구가 말했다\n\n' + pad(13, 12),
    block: '사과 맛있다', pick: '사과 맛있다', rawStart: '- **사과**' },
  { name: 'another table cell holds the plain words', raw: '# 다\n\n' + pad(1, 12) + '\n\n| 이름 | 값 |\n|---|---|\n| *가*나 항목 | 1 |\n| 가나 항목 | 2 |\n\n' + pad(13, 12),
    block: '가나 항목', pick: '가나 항목', rawStart: '| 이름 | 값 |' },
  { name: 'the only raw occurrence is inside a link address', raw: '# 라\n\n' + pad(1, 12) + '\n\n기*록*장 이야기는 [여기](https://example.invalid/기록장)에 있다.\n\n' + pad(13, 12),
    block: '기록장 이야기', pick: '기록장', rawStart: '기*록*장' },
  { name: 'an entity: twice on screen, once in the raw text', raw: '# 마\n\n' + pad(1, 12) + '\n\nA &amp; B 회사는 간판에 "A & B"라고 쓴다.\n\n' + pad(13, 12),
    block: 'A & B 회사', pick: 'A & B', rawStart: 'A &amp; B' },
  { name: 'another paragraph of the same quotation', raw: '# 바\n\n' + pad(1, 12) + '\n\n> 처음 *읽을* 때는 몰랐다.\n>\n> 다시 읽을 때는 몰랐다는 것을 알았다. 처음 읽을 때는 몰랐다는 말이다.\n\n' + pad(13, 12),
    block: '처음 읽을 때는 몰랐다.', pick: '처음 읽을 때는 몰랐다', rawStart: '> 처음 *읽을*' },
  { name: 'a triple-click on a paragraph with emphasis; the plain sentence is in a later paragraph', raw: '# 아\n\n' + pad(1, 12) + '\n\n핵심 *문장*이다.\n\n' + pad(13, 4) + '\n\n앞에서 말한 것을 다시 적는다: 핵심 문장이다. 끝.\n\n' + pad(17, 8),
    block: '핵심 문장이다.', triple: true, rawStart: '핵심 *문장*' },
  { name: 'the selection ends in the gap after the block; the plain sentence is far below', raw: '# 자\n\n' + pad(1, 12) + '\n\n시작 *문단*이다.\n\n' + pad(13, 8) + '\n\n마지막 문단: 시작 문단이다.',
    block: '시작 문단이다.', pick: '시작 문단이다.', endInGap: true, rawStart: '시작 *문단*' },
  // Not even a plain passage that is unique: a formatted selection is never a locator.
  { name: 'a plain passage that occurs once', raw: '# 사\n\n' + pad(1, 12) + '\n\n앞 문단이다.\n\n여기에 하나뿐인 구절이 들어 있다.\n\n' + pad(13, 12),
    block: '하나뿐인 구절', pick: '하나뿐인 구절', rawStart: '여기에 하나뿐인' },
];

async function fixture(raw, options = {}) {
  const opened = await S.open(options);
  const ids = await R.seed(opened.page, [{ title: '서식 발췌 실험', text: raw, format: 'text/markdown' }]);
  await R.openSource(opened.page, ids[0].versionId);
  assert.equal(await opened.page.locator('#lifeSourceText').getAttribute('data-reading-mode'), 'formatted');
  return { ...opened, ...ids[0] };
}
// Bring the rendered block to the reading area by real wheel input and return where it is.
async function showBlock(page, text) {
  for (let turn = 0; turn < 80; turn++) {
    const box = await page.evaluate(text => {
      const block = [...document.querySelectorAll('#lifeSourceText [data-source-block]')].filter(item => item.textContent.includes(text)).at(0);
      const rect = block.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: innerHeight };
    }, text);
    if (box.top > 150 && box.bottom < box.height - 200) return box;
    const viewport = page.viewportSize(); await page.mouse.move(viewport.width - 60, Math.min(viewport.height - 80, 400));
    await page.mouse.wheel(0, box.top > 150 ? Math.min(600, box.top - 200) : Math.max(-600, box.top - 200)); await page.waitForTimeout(60);
  }
  throw new Error('the block did not come into view: ' + text);
}
// The screen points where a phrase starts and ends inside a rendered block (first occurrence in the block's text).
const phraseEnds = (page, blockText, phrase) => page.evaluate(({ blockText, phrase }) => {
  const block = [...document.querySelectorAll('#lifeSourceText [data-source-block]')].find(item => item.textContent.includes(blockText));
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT); let node, from = null, to = null, seen = 0;
  const start = block.textContent.indexOf(phrase), end = start + phrase.length;
  while ((node = walker.nextNode())) {
    if (from === null && start < seen + node.length) from = [node, start - seen];
    if (to === null && end <= seen + node.length) { to = [node, end - seen]; break; }
    seen += node.length;
  }
  const point = ([node, offset], after) => { const range = document.createRange(); range.setStart(node, after ? offset - 1 : offset); range.setEnd(node, after ? offset : offset + 1); const rect = range.getBoundingClientRect(); return { x: after ? rect.right - 0.5 : rect.left + 0.5, y: rect.top + rect.height / 2 }; };
  return { from: point(from, false), to: point(to, true) };
}, { blockText, phrase });
// A real mouse drag from the first to the last character of the phrase.
async function dragSelect(page, ends) {
  await page.mouse.move(ends.from.x, ends.from.y); await page.mouse.down();
  await page.mouse.move((ends.from.x + ends.to.x) / 2, (ends.from.y + ends.to.y) / 2, { steps: 4 }); await page.mouse.move(ends.to.x, ends.to.y, { steps: 4 });
  await page.mouse.up(); await frames(page);
}
const view = page => page.evaluate(() => ({ mode: document.querySelector('#lifeSourceText').dataset.readingMode, panel: !document.querySelector('#lifeExcerptPanel').hidden,
  expanded: document.querySelector('#lifeExcerptToggle').getAttribute('aria-expanded'), picked: document.querySelector('#lifeSelectedQuote').textContent,
  save: !document.querySelector('#lifeSourceExcerptSave').disabled, toBlog: !document.querySelector('#lifeSourceToBlog').disabled,
  notice: document.querySelector('#lifeReaderNotice').hidden ? null : document.querySelector('#lifeReaderNotice').textContent,
  selection: getSelection().rangeCount ? getSelection().getRangeAt(0).toString() : '', y: scrollY, focus: document.activeElement?.id }));
const records = async page => (await R.bundle(page)).records;
// Where a raw substring is on screen in the original-text view.
const rawTop = (page, marker) => page.evaluate(marker => {
  const node = document.querySelector('#lifeSourceText').firstChild, at = node.data.indexOf(marker), range = document.createRange();
  range.setStart(node, at); range.setEnd(node, at + 1);
  const notice = document.querySelector('#lifeReaderNotice').getBoundingClientRect(), tools = document.querySelector('.life-reader-tools').getBoundingClientRect();
  return { top: range.getBoundingClientRect().top, notice: { top: notice.top, bottom: notice.bottom }, toolsBottom: tools.bottom, height: innerHeight };
}, marker);
// Select raw[start, end) in the original-text view with a real mouse drag.
async function dragRaw(page, start, end) {
  const ends = await page.evaluate(({ start, end }) => {
    const node = document.querySelector('#lifeSourceText').firstChild, range = document.createRange();
    range.setStart(node, start); range.setEnd(node, start + 1); const a = range.getBoundingClientRect();
    range.setStart(node, end - 1); range.setEnd(node, end); const b = range.getBoundingClientRect();
    return { from: { x: a.left + 0.5, y: a.top + a.height / 2 }, to: { x: b.right - 0.5, y: b.top + b.height / 2 } };
  }, { start, end });
  await dragSelect(page, ends);
}

async function main() {
  await S.start();
  try {
    const sizes = [[1440, 900, false], [820, 1180, true], [390, 844, true]];
    for (const [index, item] of cases.entries()) await S.check('picked in the formatted view, ' + item.name + ': no locator; the original text at the same paragraph and a notice', async () => {
      const [width, height, touch] = sizes[index % sizes.length];
      const f = await fixture(item.raw, { width, height, touch });
      const box = await showBlock(f.page, item.block);
      if (item.triple) await f.page.mouse.click(box.left + 30, box.top + 12, { clickCount: 3 });
      else if (item.endInGap) await f.page.evaluate(({ block, pick }) => {
        const element = [...document.querySelectorAll('#lifeSourceText [data-source-block]')].find(node => node.textContent.includes(block));
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), first = walker.nextNode(), range = document.createRange();
        range.setStart(first, 0); const gap = element.nextSibling;
        if (gap && gap.nodeType === 3) range.setEnd(gap, gap.length); else range.setEnd(element.parentNode, [...element.parentNode.childNodes].indexOf(element) + 1);
        getSelection().removeAllRanges(); getSelection().addRange(range);
      }, item);
      else await dragSelect(f.page, await phraseEnds(f.page, item.block, item.pick));
      await frames(f.page);
      const selected = await f.page.evaluate(() => getSelection().toString());
      assert(selected.trim().length > 0 && (!item.pick || selected.includes(item.pick.slice(0, 4))), 'something is picked in the formatted view: ' + JSON.stringify(selected));
      const before = await records(f.page);
      await R.pressAt(f.page, '#lifeExcerptToggle');
      const state = await view(f.page);
      assert.equal(state.panel, false, 'the excerpt panel does not open'); assert.equal(state.expanded, 'false');
      assert.equal(state.mode, 'raw', 'the original text is shown'); assert.equal(state.notice, NOTICE);
      // No candidate was made from the formatted selection: nothing picked, nothing to save or carry elsewhere.
      assert.equal(state.picked, INSTRUCTION); assert.equal(state.save, false); assert.equal(state.toBlog, false); assert.equal(state.selection, '');
      // The same paragraph is still there, at the same height, now as original text; the notice is under the tool row.
      const place = await rawTop(f.page, item.rawStart);
      assert(Math.abs(place.top - box.top) <= 12, 'the paragraph stays at its height (' + box.top + ' → ' + place.top + ')');
      assert(place.notice.top >= place.toolsBottom - 1 && place.notice.bottom < place.height / 2, 'the notice shows under the tool row, where the person is reading');
      // The pointer is still on the button: its hover label must not sit on the notice.
      assert.equal(await f.page.evaluate(() => getComputedStyle(document.querySelector('#lifeExcerptToggle > .life-tooltip')).display), 'none', 'the button\'s hover label does not cover the notice');
      if (index < 3) await S.capture(f.page, 'formatted-pick-' + width);
      // Opening the panel now (nothing selected in the original text) still offers nothing to save.
      await R.pressAt(f.page, '#lifeExcerptToggle');
      const opened = await view(f.page);
      assert.equal(opened.panel, true); assert.equal(opened.picked, INSTRUCTION); assert.equal(opened.save, false, 'no selection was made for the person');
      assert.deepEqual(await records(f.page), before, 'nothing was stored');
      await f.context.close();
    });

    await S.check('picked in the original text after the notice: the excerpt is that exact place, character for character', async () => {
      const item = cases[1], f = await fixture(item.raw);
      await showBlock(f.page, item.block);
      await dragSelect(f.page, await phraseEnds(f.page, item.block, item.pick));
      await R.pressAt(f.page, '#lifeExcerptToggle');
      assert.equal((await view(f.page)).notice, NOTICE);
      // The first list item, picked where it stands in the raw text (with its marks), by a real drag.
      const passage = '**사과** 맛있다', start = item.raw.indexOf(passage), end = start + passage.length;
      await dragRaw(f.page, start, end);
      assert.equal((await view(f.page)).notice, null, 'the press that starts the new selection takes the notice away');
      await R.pressAt(f.page, '#lifeExcerptToggle');
      let state = await view(f.page);
      assert.equal(state.panel, true); assert.equal(state.picked, passage); assert.equal(state.save, true);
      await f.page.locator('#lifeSourceTopic').fill('원문에서 고름'); await f.page.locator('#lifeSourceExcerptSave').click(); await settle(f.page); await frames(f.page);
      const saved = (await records(f.page)).filter(record => record.sourceRefs.some(ref => ref.sourceVersionId === f.versionId));
      assert.equal(saved.length, 1); assert.deepEqual(saved[0].sourceRefs[0].locator, { start, end }, 'the first item, not the later one with the same words');
      assert.equal(item.raw.slice(start, end), passage); assert.equal(saved[0].text, passage);
      // And the later item, picked in the original text, is its own place.
      const later = '사과 맛있다고', laterStart = item.raw.indexOf(later);
      await dragRaw(f.page, laterStart, laterStart + later.length);
      await R.pressAt(f.page, '#lifeExcerptToggle'); state = await view(f.page);
      assert.equal(state.picked, later);
      await f.page.locator('#lifeSourceTopic').fill('뒤 항목'); await f.page.locator('#lifeSourceExcerptSave').click(); await settle(f.page);
      const second = (await records(f.page)).find(record => record.topic === '뒤 항목');
      assert.deepEqual(second.sourceRefs[0].locator, { start: laterStart, end: laterStart + later.length });
      await f.context.close();
    });

    await S.check('keyboard: a formatted selection and Enter on the button behave the same (no locator, notice)', async () => {
      const item = cases[0], f = await fixture(item.raw);
      const box = await showBlock(f.page, item.block);
      await dragSelect(f.page, await phraseEnds(f.page, item.block, item.pick));
      await f.page.locator('#lifeExcerptToggle').evaluate(element => element.focus({ preventScroll: true })); await f.page.keyboard.press('Enter'); await frames(f.page);
      const state = await view(f.page);
      assert.equal(state.panel, false); assert.equal(state.mode, 'raw'); assert.equal(state.notice, NOTICE); assert.equal(state.save, false); assert.equal(state.focus, 'lifeSourceText');
      assert(Math.abs((await rawTop(f.page, item.rawStart)).top - box.top) <= 12);
      await f.context.close();
    });

    // A touch tap in Chromium keeps the page selection through the click (measured). Some browsers drop it when a
    // button is pressed; that is simulated here by clearing it between the press and the click. Not a real iOS check.
    await S.check('touch tap, also when the selection is gone by the time of the click (simulated): no jump to the panel, the same notice', async () => {
      for (const cleared of [false, true]) {
        const item = cases[8], f = await fixture(item.raw, { width: 390, height: 844, touch: true });
        const box = await showBlock(f.page, item.block);
        await dragSelect(f.page, await phraseEnds(f.page, item.block, item.pick));
        if (cleared) await f.page.evaluate(() => document.querySelector('#lifeExcerptToggle').addEventListener('mousedown', () => getSelection().removeAllRanges(), { once: true }));
        const button = await R.rect(f.page, '#lifeExcerptToggle');
        await f.page.touchscreen.tap(button.left + button.width / 2, button.top + button.height / 2); await frames(f.page);
        const state = await view(f.page);
        assert.equal(state.panel, false, 'cleared=' + cleared + ': the excerpt panel does not open'); assert.equal(state.mode, 'raw'); assert.equal(state.notice, NOTICE); assert.equal(state.save, false);
        assert(Math.abs((await rawTop(f.page, item.rawStart)).top - box.top) <= 12, 'cleared=' + cleared + ': the paragraph stays at its height');
        assert.deepEqual(await records(f.page), []);
        await f.context.close();
      }
    });

    await S.check('with nothing picked the button behaves as before: original text and the panel', async () => {
      const f = await fixture(cases[8].raw);
      await showBlock(f.page, cases[8].block);
      await f.page.evaluate(() => getSelection().removeAllRanges());
      await R.pressAt(f.page, '#lifeExcerptToggle');
      const state = await view(f.page);
      assert.equal(state.mode, 'raw'); assert.equal(state.panel, true); assert.equal(state.notice, null); assert.equal(state.save, false);
      assert.equal(state.picked, INSTRUCTION);
      await f.context.close();
    });
  } finally { await S.finish(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

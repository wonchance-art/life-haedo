/* 2026-11-11 자료 읽기: Markdown 서식 보기에서 고른 구절로 `발췌와 주제 연결`을 누를 때.
 * - 고른 문자열(양 끝 공백만 뗀 것)이 원문 전체에서 정확히 한 번 나오고, 고른 블록의 원문 범위 안에 있으면
 *   그 원문 구간이 발췌 후보가 된다. 저장한 발췌의 locator는 raw.slice(start, end) === 고른 문자열이다.
 * - 서식이 낀 선택, 두 번 나오는 문자열, 다른 곳에만 한 번 나오는 문자열은 추정하지 않는다: 발췌 패널로 건너뛰지 않고
 *   원문 텍스트로 바꾸며 같은 문단에 머문 채 안내만 보인다.
 * 렌더 DOM 좌표로 원문 위치를 정하지 않는다(docs/design-review/material-markdown-edit-delete.md 원문 위치 2항).
 * npm run dev; node tests/reader-markdown-excerpt-browser.cjs
 * Chromium with mouse and keyboard. A real touch selection (iOS clears it differently) is not covered. */
'use strict';
const R = require('./helpers/records-reader.cjs');
const { assert, frames, settle } = R;
const S = R.suite('reader-markdown-excerpt', 'Local Chromium, synthetic Auth, anonymous Markdown records. Excerpt from a passage picked in the formatted view.');
const filler = (from, count) => Array.from({ length: count }, (_, index) => `채움 문단 ${from + index}은 저녁마다 조금씩 읽어 나간 글의 한 대목이다.`).join('\r\n\r\n');
const unique = '유일한 문장은 이 글에서 한 번만 나온다 🌿 끝까지 그대로.';
const raw = ['# 서식 발췌 실험', filler(1, 40), unique, '되풀이되는 문장이다.', filler(41, 3), '되풀이되는 문장이다.', '앞에 **굵은** 글자가 낀 문장이다.',
  '첫째 가**나**다라 문단이다.', filler(44, 3), '뒤쪽 문단에는 가나다라 가 붙어서 한 번 나온다.', '- 목록 하나\r\n- 목록 둘', filler(47, 30)].join('\r\n\r\n');
const NOTICE = '고른 구절이 원문의 한 곳으로 정해지지 않습니다. 원문 텍스트에서 다시 선택해 주세요.';

async function fixture(options = {}) {
  const opened = await S.open(options);
  const ids = await R.seed(opened.page, [{ title: '서식 발췌 실험', text: raw, format: 'text/markdown' }]);
  await R.openSource(opened.page, ids[0].versionId);
  assert.equal(await opened.page.locator('#lifeSourceText').getAttribute('data-reading-mode'), 'formatted');
  return { ...opened, ...ids[0] };
}
// Bring the block that contains `text` to the reading area by real wheel input and return its place.
async function showBlock(page, text) {
  for (let turn = 0; turn < 80; turn++) {
    const box = await page.evaluate(text => {
      const block = [...document.querySelectorAll('#lifeSourceText [data-source-block]')].find(item => item.textContent.includes(text));
      const rect = block.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: innerHeight };
    }, text);
    if (box.top > 150 && box.bottom < box.height - 200) return box;
    const viewport = page.viewportSize(); await page.mouse.move(viewport.width - 60, Math.min(viewport.height - 80, 400));
    await page.mouse.wheel(0, box.top > 150 ? Math.min(600, box.top - 200) : Math.max(-600, box.top - 200)); await page.waitForTimeout(60);
  }
  throw new Error('the block did not come into view: ' + text);
}
// Select a phrase inside one rendered text node, the way a drag does (selectionchange fires on its own).
const selectPhrase = (page, blockText, phrase) => page.evaluate(({ blockText, phrase }) => {
  const block = [...document.querySelectorAll('#lifeSourceText [data-source-block]')].find(item => item.textContent.includes(blockText));
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT); let node, from = null, to = null, seen = 0;
  const start = block.textContent.indexOf(phrase), end = start + phrase.length;
  while ((node = walker.nextNode())) {
    if (from === null && start < seen + node.length) from = [node, start - seen];
    if (to === null && end <= seen + node.length) { to = [node, end - seen]; break; }
    seen += node.length;
  }
  const range = document.createRange(); range.setStart(...from); range.setEnd(...to);
  getSelection().removeAllRanges(); getSelection().addRange(range);
  return { picked: getSelection().toString(), top: range.getBoundingClientRect().top };
}, { blockText, phrase });
const view = page => page.evaluate(() => ({ mode: document.querySelector('#lifeSourceText').dataset.readingMode, panel: !document.querySelector('#lifeExcerptPanel').hidden,
  picked: document.querySelector('#lifeSelectedQuote').textContent, save: !document.querySelector('#lifeSourceExcerptSave').disabled,
  notice: document.querySelector('#lifeReaderNotice').hidden ? null : document.querySelector('#lifeReaderNotice').textContent,
  selection: getSelection().rangeCount ? getSelection().getRangeAt(0).toString() : '', y: scrollY, focus: document.activeElement?.id }));
const records = async page => (await R.bundle(page)).records;
async function saveAndCheck(f, expected) {
  await f.page.locator('#lifeSourceTopic').fill('서식에서 고름'); await f.page.locator('#lifeSourceExcerptSave').click(); await settle(f.page); await frames(f.page);
  const saved = (await records(f.page)).filter(record => record.sourceRefs.some(ref => ref.sourceVersionId === f.versionId));
  assert.equal(saved.length, 1); const locator = saved[0].sourceRefs[0].locator;
  assert.equal(raw.slice(locator.start, locator.end), expected, 'the stored range is the picked string, character for character');
  assert.equal(saved[0].text, expected); assert.equal(locator.start, raw.indexOf(expected)); assert.equal(raw.indexOf(expected, locator.start + 1), -1);
}

async function main() {
  await S.start();
  try {
    for (const [width, height, touch] of [[1440, 900, false], [390, 844, true]]) await S.check('a whole paragraph picked by triple-click becomes the exact excerpt candidate at ' + width, async () => {
      const f = await fixture({ width, height, touch });
      const box = await showBlock(f.page, '유일한 문장');
      await f.page.mouse.click(box.left + 40, box.top + 12, { clickCount: 3 }); await frames(f.page);
      const picked = await f.page.evaluate(() => ({ text: getSelection().toString(), top: getSelection().getRangeAt(0).getBoundingClientRect().top }));
      assert.equal(picked.text.trim(), unique); // the browser adds the paragraph break to a triple-click
      await R.pressAt(f.page, '#lifeExcerptToggle');
      let state = await view(f.page);
      assert.equal(state.mode, 'raw'); assert.equal(state.panel, true, 'the excerpt panel opens with the passage');
      assert.equal(state.picked, unique); assert.equal(state.save, true); assert.equal(state.notice, null);
      await S.capture(f.page, 'exact-candidate-' + width);
      await saveAndCheck(f, unique);
      // Back in the text the same passage is selected in the original, at the height it was picked at.
      state = await view(f.page);
      assert.equal(state.selection, unique, 'the same passage is selected in the original text');
      const top = await f.page.evaluate(() => getSelection().rangeCount ? getSelection().getRangeAt(0).getBoundingClientRect().top : null);
      assert(top !== null && Math.abs(top - picked.top) <= 3, 'the passage is back where it was picked (' + picked.top + ' → ' + top + ')');
      await f.context.close();
    });

    await S.check('a phrase inside a paragraph, with an emoji, keeps its exact UTF-16 range; keyboard activation works too', async () => {
      const f = await fixture();
      await showBlock(f.page, '유일한 문장');
      const phrase = '한 번만 나온다 🌿 끝까지';
      const picked = await selectPhrase(f.page, '유일한 문장', phrase); assert.equal(picked.picked, phrase);
      await f.page.locator('#lifeExcerptToggle').evaluate(element => element.focus({ preventScroll: true })); await f.page.keyboard.press('Enter'); await frames(f.page);
      const state = await view(f.page);
      assert.equal(state.panel, true); assert.equal(state.picked, phrase);
      await saveAndCheck(f, phrase);
      assert.equal((await view(f.page)).selection, phrase);
      await f.context.close();
    });

    // [case, text of the rendered block, phrase picked in it (null: across two list items), how that block starts in the original]
    const refused = [
      ['formatting inside the picked passage', '굵은 글자가 낀 문장', '굵은 글자가 낀 문장이다', '앞에 **굵은**'],
      ['a sentence that occurs twice', '되풀이되는 문장이다.', '되풀이되는 문장이다.', '되풀이되는 문장이다.'],
      ['words that occur once in the original but in another paragraph', '첫째 가나다라 문단', '가나다라', '첫째 가**나**다라'],
      ['a selection across list items', '목록 하나', null, '- 목록 하나']];
    for (const [name, blockText, phrase, rawStart] of refused) await S.check('no guess for ' + name + ': the original text at the same paragraph and a notice, no excerpt panel', async () => {
      const f = await fixture();
      const box = await showBlock(f.page, blockText);
      if (phrase) assert.equal((await selectPhrase(f.page, blockText, phrase)).picked, phrase);
      else {
        await f.page.evaluate(() => { const items = [...document.querySelectorAll('#lifeSourceText li')], range = document.createRange(); range.setStart(items[0].firstChild, 0); range.setEnd(items[1].firstChild, items[1].firstChild.length); getSelection().removeAllRanges(); getSelection().addRange(range); });
        assert.notEqual(await f.page.evaluate(() => getSelection().toString()), '');
      }
      if (name.startsWith('words that occur once')) assert.equal(raw.split('가나다라').length, 2, 'fixture: the raw text has it once, elsewhere');
      const before = await records(f.page);
      await R.pressAt(f.page, '#lifeExcerptToggle');
      const state = await view(f.page);
      assert.equal(state.panel, false, 'the excerpt panel does not open'); assert.equal(state.mode, 'raw'); assert.equal(state.notice, NOTICE);
      assert.equal(state.picked, '원문에서 발췌할 구절을 선택하세요.'); assert.equal(state.save, false); assert.equal(state.selection, '');
      assert.equal(await f.page.locator('#lifeExcerptToggle').getAttribute('aria-expanded'), 'false');
      // The same paragraph is still there, at the same height, now as original text.
      const place = await f.page.evaluate(marker => {
        const node = document.querySelector('#lifeSourceText').firstChild, at = node.data.indexOf(marker), range = document.createRange();
        range.setStart(node, at); range.setEnd(node, at + 1); const notice = document.querySelector('#lifeReaderNotice').getBoundingClientRect(), tools = document.querySelector('.life-reader-tools').getBoundingClientRect();
        return { top: range.getBoundingClientRect().top, notice: { top: notice.top, bottom: notice.bottom }, toolsBottom: tools.bottom, height: innerHeight };
      }, rawStart);
      assert(Math.abs(place.top - box.top) <= 12, 'the paragraph stays at its height (' + box.top + ' → ' + place.top + ')');
      assert(place.notice.top >= place.toolsBottom - 1 && place.notice.bottom < place.height / 2, 'the notice shows under the tool row, where the person is reading');
      await S.capture(f.page, 'refused-' + refused.findIndex(item => item[0] === name));
      assert.deepEqual(await records(f.page), before, 'nothing was stored');
      // The next press takes the notice away, and a selection in the original text works as always.
      await f.page.mouse.click(box.left + 40, place.top + 12, { clickCount: 3 }); await frames(f.page);
      assert.equal((await view(f.page)).notice, null);
      await R.pressAt(f.page, '#lifeExcerptToggle');
      const after = await view(f.page);
      assert.equal(after.panel, true); assert.notEqual(after.picked, '원문에서 발췌할 구절을 선택하세요.'); assert(raw.includes(after.picked));
      await f.context.close();
    });

    await S.check('with nothing picked the button behaves as before: original text and the panel', async () => {
      const f = await fixture();
      await showBlock(f.page, '유일한 문장');
      await f.page.evaluate(() => getSelection().removeAllRanges());
      await R.pressAt(f.page, '#lifeExcerptToggle');
      const state = await view(f.page);
      assert.equal(state.mode, 'raw'); assert.equal(state.panel, true); assert.equal(state.notice, null); assert.equal(state.save, false);
      assert.equal(state.picked, '원문에서 발췌할 구절을 선택하세요.');
      await f.context.close();
    });
  } finally { await S.finish(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

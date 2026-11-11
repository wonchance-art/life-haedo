/* 2026-11-11 자료 읽기: 긴 글을 읽는 중에 화면 위 도구 줄의 `출처 정보`·`이 원문 담기`를 누르면 패널이 누른 자리에서
 * 보이고(문서 맨 위가 아니라), 본문이 밀리지 않으며, Escape·바깥 누름·같은 단추로 닫히고 초점이 단추로 돌아온다.
 * npm run dev; node tests/reader-panels-browser.cjs
 * Buttons are pressed by coordinates: a locator click would scroll an off-screen target into view and hide the defect.
 * Chromium viewport sizes with mouse and keyboard: not an iPad/iPhone touch or Safari check. */
'use strict';
const R = require('./helpers/records-reader.cjs');
const { assert, frames } = R;
const S = R.suite('reader-panels', 'Local Chromium, synthetic Auth, anonymous records. Reader tool row panels while scrolled, at 1440/820/390 and a low landscape window.');
const text = Array.from({ length: 500 }, (_, index) => `문단 ${index + 1}: 저녁마다 조금씩 읽어 나간 글의 한 대목이다. 표식-${index + 1}.`).join('\n\n');
const sizes = [[1440, 900, false], [820, 1180, true], [390, 844, true], [844, 390, true]];

// The character on the reading line and where it is now; the same character is measured again later.
const anchor = page => page.evaluate(() => {
  const node = document.querySelector('#lifeSourceText').firstChild, range = document.createRange(); let low = 0, high = node.length;
  while (low < high) { const mid = (low + high) >> 1; range.setStart(node, mid); range.setEnd(node, mid + 1); if (range.getBoundingClientRect().bottom < innerHeight / 2) low = mid + 1; else high = mid; }
  range.setStart(node, low); range.setEnd(node, low + 1);
  return { offset: low, top: range.getBoundingClientRect().top, scrollY, height: document.documentElement.scrollHeight };
});
const anchorTop = (page, offset) => page.evaluate(offset => {
  const node = document.querySelector('#lifeSourceText').firstChild, range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1);
  return { top: range.getBoundingClientRect().top, scrollY, height: document.documentElement.scrollHeight };
}, offset);
const layout = (page, selector) => page.evaluate(selector => {
  const panel = document.querySelector(selector), tools = document.querySelector('.life-reader-tools').getBoundingClientRect(), box = panel.getBoundingClientRect();
  const nav = document.querySelector('.haedo-nav')?.getBoundingClientRect();
  const tab = nav && nav.height && nav.top > innerHeight / 2 && nav.width >= innerWidth - 1 ? nav.top : innerHeight;
  const column = (document.querySelector('.records-reader-pane') || document.querySelector('#lifeMain')).getBoundingClientRect();
  const list = document.querySelector('#lifeRecordsPane'), listBox = list?.checkVisibility() ? list.getBoundingClientRect() : null;
  const controls = [...panel.querySelectorAll('button, summary, select, a[href]')].filter(item => item.checkVisibility()).map(item => { const rect = item.getBoundingClientRect(); return { name: item.id || item.textContent.trim().slice(0, 20), width: rect.width, height: rect.height }; });
  return { hidden: panel.hidden || !panel.checkVisibility(), top: box.top, bottom: box.bottom, left: box.left, right: box.right, toolsTop: tools.top, toolsBottom: tools.bottom, tab, viewport: innerHeight, viewportWidth: innerWidth,
    column: { left: column.left, right: column.right }, listRight: listBox?.right ?? null, scrolls: panel.scrollHeight > panel.clientHeight + 1, controls,
    expanded: document.querySelector('[aria-controls="' + panel.id + '"]').getAttribute('aria-expanded'), focus: document.activeElement?.id || document.activeElement?.tagName };
}, selector);
function assertShown(state, label) {
  assert.equal(state.hidden, false, label + ': open'); assert.equal(state.expanded, 'true');
  assert(Math.abs(state.toolsTop) <= 1, label + ': the tool row stays at the top of the screen (' + state.toolsTop + ')');
  assert(state.top >= state.toolsBottom - 1, label + ': the panel starts under the tool row (' + state.top + ' vs ' + state.toolsBottom + ')');
  assert(state.top < state.viewport / 2, label + ': the panel is where it was pressed');
  assert(state.bottom <= state.tab + 0.5, label + ': the panel ends above the bottom tab or screen edge (' + state.bottom + ' vs ' + state.tab + ')');
  assert(state.bottom - state.top >= 120, label + ': the panel has a usable height');
  // The tool row hangs 12px past the text on each side (its icons line up with the text edge); the panel is as wide as that row.
  assert(state.left >= state.column.left - 12.5 && state.right <= state.column.right + 12.5, label + ': the panel stays inside the reading column (' + JSON.stringify([state.left, state.right, state.column]) + ')');
  assert(state.left >= 0 && state.right <= state.viewportWidth, label + ': the panel stays on screen');
  if (state.listRight !== null) assert(state.left >= state.listRight, label + ': the panel does not cover the list');
}
async function unmoved(page, before, label) {
  const now = await anchorTop(page, before.offset);
  assert.equal(now.scrollY, before.scrollY, label + ': the page did not scroll');
  assert(Math.abs(now.top - before.top) < 0.5, label + ': the reading line did not move (' + (now.top - before.top) + 'px)');
  assert.equal(now.height, before.height, label + ': the panel takes no room in the document');
}

async function main() {
  await S.start();
  try {
    for (const [width, height, touch] of sizes) await S.check('출처 정보 and 이 원문 담기 while reading far down at ' + width + 'x' + height, async () => {
      const { page, context } = await S.open({ width, height, touch, label: 'panels-' + width });
      const ids = await R.seed(page, [{ title: '긴 문서', text }, { title: '짧은 문서', text: '짧은 글.' }]);
      await R.openSource(page, ids[0].versionId);
      await R.wheel(page, 10000);
      const before = await anchor(page);
      assert(before.scrollY > 5000, 'scrolled far down');

      // 출처 정보: opens where it was pressed, the reading line stays.
      await R.pressAt(page, '#lifeSourceInfoToggle');
      let state = await layout(page, '#lifeSourceDetails');
      assertShown(state, '출처 정보'); await unmoved(page, before, '출처 정보 open');
      for (const control of state.controls) assert(control.height >= 43.5 && control.width >= 43.5, '출처 정보 control at least 44px: ' + JSON.stringify(control));
      await S.capture(page, 'info-open-' + width + 'x' + height);
      // Everything in it can be reached: the last control comes into the panel's own view by scrolling the panel only.
      const reach = await page.evaluate(() => {
        const panel = document.querySelector('#lifeSourceDetails'), last = [...panel.querySelectorAll('button')].filter(item => item.checkVisibility()).at(-1);
        last.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        const box = last.getBoundingClientRect(), frame = panel.getBoundingClientRect();
        return { id: last.id, inside: box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1, panelBottom: frame.bottom };
      });
      assert.equal(reach.inside, true, 'the last control (' + reach.id + ') is reachable inside the panel'); await unmoved(page, before, 'scrolling inside the panel');
      // Escape from anywhere closes it and returns focus to its button.
      await page.keyboard.press('Escape'); await frames(page);
      state = await layout(page, '#lifeSourceDetails');
      assert.equal(state.hidden, true); assert.equal(state.expanded, 'false'); assert.equal(state.focus, 'lifeSourceInfoToggle'); await unmoved(page, before, 'Escape');
      // Escape also closes it when focus is nowhere near the panel (the page body).
      await R.pressAt(page, '#lifeSourceInfoToggle'); assert.equal((await layout(page, '#lifeSourceDetails')).hidden, false);
      await page.evaluate(() => document.activeElement.blur()); assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
      await page.keyboard.press('Escape'); await frames(page);
      state = await layout(page, '#lifeSourceDetails');
      assert.equal(state.hidden, true, 'Escape with focus on the page closes the panel'); assert.equal(state.focus, 'lifeSourceInfoToggle'); await unmoved(page, before, 'Escape from the page');
      // The same button closes it.
      await R.pressAt(page, '#lifeSourceInfoToggle'); assert.equal((await layout(page, '#lifeSourceDetails')).hidden, false);
      await R.pressAt(page, '#lifeSourceInfoToggle'); state = await layout(page, '#lifeSourceDetails');
      assert.equal(state.hidden, true); assert.equal(state.focus, 'lifeSourceInfoToggle'); await unmoved(page, before, 'same button');
      // A press outside closes it. The press lands on the body text under the panel when there is room, else on the tool row.
      await R.pressAt(page, '#lifeSourceInfoToggle'); state = await layout(page, '#lifeSourceDetails');
      const outside = state.tab - state.bottom > 60 ? { x: (state.left + state.right) / 2, y: state.bottom + 40 } : { x: (state.left + state.right) / 2, y: (state.toolsTop + state.toolsBottom) / 2 };
      await page.mouse.click(outside.x, outside.y); await frames(page);
      assert.equal((await layout(page, '#lifeSourceDetails')).hidden, true, 'a press outside closes 출처 정보'); await unmoved(page, before, 'outside press');

      // 이 원문 담기: the same layer. Only one panel is open at a time.
      await R.pressAt(page, '#lifeSourceInfoToggle'); await R.pressAt(page, '#lifeReaderArrange');
      state = await layout(page, '#lifeReaderArrangePanel');
      assertShown(state, '이 원문 담기'); await unmoved(page, before, '이 원문 담기 open');
      assert.equal((await layout(page, '#lifeSourceDetails')).hidden, true, 'opening one panel closes the other');
      for (const control of state.controls) assert(control.height >= 43.5 && control.width >= 43.5, '이 원문 담기 control at least 44px: ' + JSON.stringify(control));
      await S.capture(page, 'arrange-open-' + width + 'x' + height);
      await page.keyboard.press('Escape'); await frames(page);
      state = await layout(page, '#lifeReaderArrangePanel'); assert.equal(state.hidden, true); assert.equal(state.focus, 'lifeReaderArrange'); await unmoved(page, before, 'Escape (담기)');

      // Keyboard: the panel follows its button in focus order, and Escape inside it returns to the button.
      // (Focus reaches the button by a press, as a person's does; a script's element.focus() scrolls on its own.)
      await R.pressAt(page, '#lifeSourceInfoToggle'); await R.pressAt(page, '#lifeSourceInfoToggle');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'lifeSourceInfoToggle'); assert.equal((await layout(page, '#lifeSourceDetails')).hidden, true);
      await page.keyboard.press('Enter'); await frames(page);
      assert.equal((await layout(page, '#lifeSourceDetails')).hidden, false);
      const order = [];
      for (let step = 0; step < 4; step++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => { const active = document.activeElement; return active.closest('#lifeSourceDetails') ? 'panel' : active.closest('.life-reader-tools') ? 'tools:' + active.id : 'other:' + (active.id || active.tagName); })); }
      const first = order.findIndex(item => item === 'panel');
      assert(first >= 0 && order.slice(0, first).every(item => item.startsWith('tools:')) && order.slice(first).every(item => item === 'panel'), 'Tab goes from the tool row into the open panel: ' + order.join(' → '));
      await unmoved(page, before, 'Tab into the panel');
      // By keyboard alone, opening the other panel closes this one (no press outside is involved).
      for (let step = 0; step < 8 && await page.evaluate(() => document.activeElement.id) !== 'lifeReaderArrange'; step++) await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'lifeReaderArrange'); await unmoved(page, before, 'Shift+Tab to 이 원문 담기');
      await page.keyboard.press('Enter'); await frames(page);
      assert.equal((await layout(page, '#lifeReaderArrangePanel')).hidden, false); assert.equal((await layout(page, '#lifeSourceDetails')).hidden, true, 'keyboard: one panel at a time');
      await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await frames(page);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'lifeSourceInfoToggle');
      assert.equal((await layout(page, '#lifeSourceDetails')).hidden, false); assert.equal((await layout(page, '#lifeReaderArrangePanel')).hidden, true, 'keyboard: and back');
      for (let step = 0; step < 3; step++) await page.keyboard.press('Tab');
      // Back to the first control of the tool row and forward again, one stop at a time. (Not past it: leaving the
      // reader for the list or the menu is the browser's own focus move.)
      const atFirst = () => page.evaluate(() => document.activeElement === document.querySelector('.life-reader-tools > button'));
      let back = 0;
      while (!await atFirst() && back < 12) { await page.keyboard.press('Shift+Tab'); back++; await frames(page); await unmoved(page, before, 'Shift+Tab step ' + back); }
      assert(await atFirst() && back >= 4, 'reached the first tool by Shift+Tab in ' + back + ' steps');
      for (let step = 1; step <= back; step++) { await page.keyboard.press('Tab'); await frames(page); await unmoved(page, before, 'Tab step ' + step); }
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('#lifeSourceDetails')), true, 'focus is back inside the panel');
      await page.keyboard.press('Escape'); await frames(page);
      state = await layout(page, '#lifeSourceDetails'); assert.equal(state.hidden, true); assert.equal(state.focus, 'lifeSourceInfoToggle'); await unmoved(page, before, 'Escape inside the panel');

      // 2026-11-11 독립 검수: Tab past the last control of the open panel. What follows the panel in the document is
      // the top of the text; focus used to go there, the page jumped to the top and the open panel covered it.
      // Now the panel closes and focus returns to its button; the reading line does not move.
      for (const [trigger, sheet] of [['#lifeSourceInfoToggle', '#lifeSourceDetails'], ['#lifeReaderArrange', '#lifeReaderArrangePanel']]) {
        await R.pressAt(page, trigger); assert.equal((await layout(page, sheet)).hidden, false);
        let inside = 0, left = false;
        for (let step = 0; step < 40 && !left; step++) {
          await page.keyboard.press('Tab'); await frames(page);
          if (await page.evaluate(sheet => !!document.activeElement.closest(sheet), sheet)) inside++; else left = inside > 0;
          await unmoved(page, before, 'Tab step ' + (step + 1) + ' through ' + sheet);
        }
        assert(inside >= 1 && left, 'Tab went through the panel and past its last control (' + inside + ' stops)');
        state = await layout(page, sheet);
        assert.equal(state.hidden, true, 'the panel closed'); assert.equal(state.expanded, 'false'); assert.equal('#' + state.focus, trigger, 'focus is back on the button that opened it');
        const shown = await page.evaluate(() => { const box = document.activeElement.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return document.activeElement.contains(hit); });
        assert.equal(shown, true, 'the focused control is not covered');
        // Tab from there goes on along the tool row; the panel does not open again by itself.
        await page.keyboard.press('Tab'); await frames(page);
        assert.equal((await layout(page, sheet)).hidden, true);
        if (await page.evaluate(() => !!document.activeElement.closest('.life-reader-dock'))) await unmoved(page, before, 'Tab after the panel closed');
        await page.evaluate(() => document.activeElement.blur()); await page.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), before.scrollY); await frames(page);
      }
      // Focus leaving the tool row another way (Shift+Tab before its first control) also closes an open panel: it never covers what is focused next.
      await R.pressAt(page, '#lifeSourceInfoToggle'); assert.equal((await layout(page, '#lifeSourceDetails')).hidden, false);
      for (let step = 0; step < 12 && !await atFirst(); step++) await page.keyboard.press('Shift+Tab');
      assert(await atFirst()); assert.equal((await layout(page, '#lifeSourceDetails')).hidden, false, 'still open while focus is in the tool row');
      await page.keyboard.press('Shift+Tab'); await frames(page);
      const away = await page.evaluate(() => ({ inDock: !!document.activeElement.closest('.life-reader-dock'), body: document.activeElement === document.body }));
      if (!away.inDock && !away.body) assert.equal((await layout(page, '#lifeSourceDetails')).hidden, true, 'the panel closed when focus left the tool row');
      else assert.fail('Shift+Tab before the first tool did not move focus out of the tool row: ' + JSON.stringify(away));
      await page.evaluate(() => document.activeElement.blur()); await page.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), before.scrollY); await frames(page);

      // At the top of the document the panels open the same way and move nothing.
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await frames(page);
      const heading = await R.rect(page, '.life-reader-heading');
      await R.pressAt(page, '#lifeSourceInfoToggle'); state = await layout(page, '#lifeSourceDetails');
      assert.equal(state.hidden, false); assert(state.bottom <= state.tab + 0.5, 'at the top: ends above the bottom tab');
      assert(Math.abs((await R.rect(page, '.life-reader-heading')).top - heading.top) < 0.5, 'at the top: the title does not move');
      await page.keyboard.press('Escape');
      await context.close();
    });
  } finally { await S.finish(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

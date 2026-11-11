/* 2026-11-11 자료 읽기의 작은 결함들(m1~m6). 항목마다 한 묶음의 확인이다.
 * npm run dev; node tests/records-reader-small-browser.cjs [m1 m2 …]
 * Actual application bytes, synthetic Auth and anonymous fixtures; Chromium only. "Another device" is a second write
 * through the same storage API. The Korean IME is driven with CDP Input.imeSetComposition, not a real keyboard. */
'use strict';
const R = require('./helpers/records-reader.cjs');
const { assert, frames, settle } = R;
const S = R.suite('records-reader-small', 'Local Chromium, synthetic Auth, anonymous records. Small reader defects m1–m6.');
const only = process.argv.slice(2);
const group = (name, run) => only.length && !only.includes(name) ? Promise.resolve() : run();
const original = '첫 문단입니다.\n\n둘째 문단입니다.';

// Everything the status line said from now on (the reader hides the line itself, a screen reader still hears it).
const listen = page => page.evaluate(() => {
  window.__said = []; const status = document.querySelector('#lifeSaveStatus');
  new MutationObserver(() => { if (status.textContent) window.__said.push(status.textContent); }).observe(status, { childList: true, characterData: true, subtree: true });
});
const said = page => page.evaluate(() => window.__said);
const refreshVisible = page => page.getByRole('button', { name: '최신 내용 확인', exact: true }).isVisible();
async function openEditor(page) {
  await frames(page);
  if (await page.locator('#lifeSourceDetails').isHidden()) await page.locator('#lifeSourceInfoToggle').click();
  await page.locator('#lifeSourceEdit').click(); await settle(page); await page.locator('#lifeSourceEdit[aria-busy="false"]').waitFor();
}

async function m1() {
  for (const [width, height] of [[1440, 900], [390, 844]]) await S.check('m1 saving my own edit does not ask to review the latest content at ' + width, async () => {
    const { page, context } = await S.open({ width, height, touch: width < 1000 });
    const ids = await R.seed(page, [{ title: '수정할 메모', text: original }]);
    await R.openSource(page, ids[0].versionId); await openEditor(page);
    await page.locator('#lifeSourceEditText').fill(original + ' 고친 문장.');
    await listen(page);
    await page.locator('#lifeSourceEditSave').click(); await settle(page); await page.locator('#lifeMain[data-mode="source"] #lifeSourceText').waitFor(); await page.waitForTimeout(400);
    assert.match(await page.locator('.life-reader-meta').nth(1).textContent(), /버전 2\/2/);
    assert.equal(await refreshVisible(page), false, 'no 최신 내용 확인 after my own save');
    assert.equal(await page.locator('.life-toolbar').isHidden(), true, 'the reader keeps its page toolbar hidden');
    const heard = await said(page);
    assert(heard.includes('자료를 저장했습니다.'), 'the save is announced: ' + JSON.stringify(heard));
    assert(!heard.some(text => text.includes('보관한 자료가 변경되었습니다')), 'my own save is not announced as a change from elsewhere: ' + JSON.stringify(heard));
    // A change that really comes from elsewhere while reading is still offered for review.
    await R.addVersion(page, ids[0].sourceId, '다른 기기에서 고친 본문.');
    await page.getByRole('button', { name: '최신 내용 확인', exact: true }).waitFor();
    assert((await said(page)).some(text => text.includes('보관한 자료가 변경되었습니다')));
    await context.close();
  });
  await S.check('m1 saving my input on top of a newer version is my own save too', async () => {
    const { page, context } = await S.open();
    const ids = await R.seed(page, [{ title: '수정할 메모', text: original }]);
    await R.openSource(page, ids[0].versionId); await openEditor(page);
    await page.locator('#lifeSourceEditText').fill(original + ' 내 입력.');
    await page.waitForFunction(() => document.querySelector('#lifeSourceEditStatus')?.dataset.state === 'draft');
    await R.addVersion(page, ids[0].sourceId, '다른 기기에서 고친 본문.');
    await page.locator('#lifeSourceEditSave').click(); await page.locator('#lifeSourceEditBase').waitFor();
    await page.getByRole('button', { name: '최신 내용 확인', exact: true }).waitFor(); // the other device's version, announced before my choice
    await listen(page);
    await page.locator('#lifeSourceEditRebase').click(); await settle(page); await page.locator('#lifeMain[data-mode="source"] #lifeSourceText').waitFor(); await page.waitForTimeout(400);
    assert.match(await page.locator('.life-reader-meta').nth(1).textContent(), /버전 3\/3/);
    assert.equal(await refreshVisible(page), false, 'the reader now shows the latest; nothing is left to review');
    assert(!(await said(page)).some(text => text.includes('보관한 자료가 변경되었습니다')));
    await context.close();
  });
}

const paragraphs = count => Array.from({ length: count }, (_, index) => `가-${index + 1}번째 문단. 저녁마다 조금씩 읽어 나간 긴 글의 한 대목이다. 창밖이 어두워질 때까지 읽었고 다음 날에도 이어서 읽었다.`).join('\n\n');
// The reader as a person sees it: which material and version, and which paragraph is on the reading line.
const reading = page => page.evaluate(() => {
  const element = document.querySelector('#lifeSourceText'), main = document.querySelector('#lifeMain');
  if (!element) return { mode: main.dataset.mode };
  let para;
  if (element.dataset.readingMode === 'formatted') para = Number([...element.querySelectorAll('[data-source-block]')].find(item => item.getBoundingClientRect().bottom > innerHeight / 3)?.textContent.match(/가-(\d+)번째/)?.[1]);
  else { const node = element.firstChild, range = document.createRange(); let low = 0, high = node.length; while (low < high) { const mid = (low + high) >> 1; range.setStart(node, mid); range.setEnd(node, Math.min(node.length, mid + 1)); if (range.getBoundingClientRect().bottom < innerHeight / 3) low = mid + 1; else high = mid; } para = (node.data.slice(0, low + 1).match(/가-(\d+)번째/g) || []).length; }
  return { mode: main.dataset.mode, title: document.querySelector('.life-reader-heading').textContent, view: element.dataset.readingMode, para, y: Math.round(scrollY),
    meta: document.querySelectorAll('.life-reader-meta')[1].textContent, version: document.querySelector('#lifeVersion')?.value || null,
    trashed: !!document.querySelector('.life-source-trash-status'), split: !!document.querySelector('#lifeRecordsPane')?.checkVisibility(), address: location.pathname + location.search,
    entry: history.state?.haedo?.entry?.mode || null };
});
async function reload(page) { await page.reload(); await R.ready(page); await settle(page); await frames(page); await frames(page); await page.waitForTimeout(150); }

async function m2() {
  for (const [width, height, format] of [[1440, 900, 'text/plain'], [390, 844, 'text/plain'], [820, 1180, 'text/markdown']]) await S.check('m2 a reload while reading returns to the same material, version and line at ' + width + ' (' + format + ')', async () => {
    const { page, context } = await S.open({ width, height, touch: width < 1000 });
    const ids = await R.seed(page, [{ title: '문서 가', text: paragraphs(300), format }, { title: '문서 나', text: '짧은 글.' }]);
    await R.openSource(page, ids[0].versionId);
    await R.wheel(page, 12000); await page.waitForTimeout(1000); // longer than the 500ms after which the entry records the line
    const before = await reading(page);
    assert.equal(before.mode, 'source'); assert(before.para > 20); assert.equal(before.address, '/index.html?section=records', 'the address keeps its form');
    await reload(page);
    let after = await reading(page);
    assert.equal(after.mode, 'source', 'the reader, not the list'); assert.equal(after.title, '문서 가'); assert.equal(after.view, before.view); assert.equal(after.meta, before.meta);
    assert(Math.abs(after.para - before.para) <= 1, 'the same paragraph: ' + before.para + ' → ' + after.para);
    assert.equal(after.split, before.split, 'the list stays beside the reader where it was'); assert.equal(after.address, before.address); assert.equal(after.entry, 'source');
    assert.equal(await page.evaluate(() => HaedoLife.Shell.storage.getActive().then(id => history.state.haedo.entry.workspaceId === id)), true);
    // Straight away again, without touching the page.
    await reload(page); after = await reading(page);
    assert.equal(after.mode, 'source'); assert(Math.abs(after.para - before.para) <= 1, 'a second reload: ' + before.para + ' → ' + after.para);
    // Scroll and reload at once: the page hiding records the line.
    await R.wheel(page, 3000, { pause: 15 }); const moved = await reading(page); // (about 300ms since the last wheel turn)
    assert(moved.para > before.para + 5);
    await reload(page); after = await reading(page);
    assert(Math.abs(after.para - moved.para) <= 1, 'a reload right after scrolling: ' + moved.para + ' → ' + after.para);
    // The list is one step back, as before the reload.
    await page.locator('#lifeSearchReturn').click(); await settle(page);
    assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'sources');
    await context.close();
  });

  await S.check('m2 a reload keeps an earlier version, a material in the trash and one opened from 찾기', async () => {
    const { page, context } = await S.open({ width: 1440, height: 900 });
    const ids = await R.seed(page, [{ title: '문서 가', text: paragraphs(120) }, { title: '찾을 문서', text: '통합 검색에서 찾을 고유낱말감나무 문서입니다.\n\n' + paragraphs(60) }]);
    const head = await R.addVersion(page, ids[0].sourceId, '새 판의 짧은 본문.');
    await R.list(page); await R.openSource(page, head);
    await page.locator('#lifeVersion').selectOption(ids[0].versionId); await settle(page); await frames(page);
    await R.wheel(page, 4000); await page.waitForTimeout(1000);
    const older = await reading(page); assert.match(older.meta, /버전 1\/2 · 이전 버전/);
    await reload(page);
    let after = await reading(page);
    assert.equal(after.mode, 'source'); assert.equal(after.version, ids[0].versionId, 'the exact earlier version, not the latest'); assert.match(after.meta, /버전 1\/2 · 이전 버전/);
    assert(Math.abs(after.para - older.para) <= 1);
    // In the trash, opened from the trash screen.
    await page.locator('#lifeSourceInfoToggle').click(); await page.locator('#lifeSourceTrash').click(); await page.locator('#lifeSourceTrashConfirm').click(); await settle(page);
    await page.goto(R.base + '/index.html?section=records&view=source-trash'); await R.ready(page); await settle(page);
    await page.locator('.life-source-open').first().click(); await settle(page); await page.locator('#lifeSourceText').waitFor(); await frames(page);
    assert.equal((await reading(page)).trashed, true);
    await reload(page); after = await reading(page);
    assert.equal(after.mode, 'source'); assert.equal(after.trashed, true); assert.equal(after.title, '문서 가');
    await page.locator('#lifeSearchReturn').click(); await settle(page);
    assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'source-trash', 'back to the trash screen it was opened from');
    // Opened from 찾기 (unified search). The search text is not kept across a reload, the material is.
    await page.goto(R.base + '/index.html?section=records&view=find'); await R.ready(page); await settle(page);
    await page.locator('#lifeFindQuery').fill('고유낱말감나무'); await page.locator('.life-find-result').first().waitFor();
    await page.locator('.life-find-result').first().click(); await settle(page); await page.locator('#lifeSourceText').waitFor(); await frames(page);
    assert.equal((await reading(page)).title, '찾을 문서');
    await reload(page); after = await reading(page);
    assert.equal(after.mode, 'source'); assert.equal(after.title, '찾을 문서'); assert.equal(after.address, '/index.html?section=records');
    assert.equal(JSON.stringify(await page.evaluate(() => history.state)).includes('고유낱말감나무'), false, 'no search text in history.state');
    await context.close();
  });

  await S.check('m2 another space or a material that is gone opens the list, as before', async () => {
    const { page, context } = await S.open({ width: 1440, height: 900 });
    const ids = await R.seed(page, [{ title: '문서 가', text: paragraphs(120) }]);
    await R.openSource(page, ids[0].versionId); await R.wheel(page, 3000); await page.waitForTimeout(1000);
    const rewrite = change => page.evaluate(change => { const state = JSON.parse(JSON.stringify(history.state)); Object.assign(state.haedo.entry, change); history.replaceState(state, '', location.href); }, change);
    for (const [name, change] of [['a material that is not in this space', { sourceId: '00000000-0000-4000-8000-000000000001' }], ['a version of another material', { sourceVersionId: '00000000-0000-4000-8000-000000000002' }],
      ['another space', { workspaceId: '00000000-0000-4000-8000-000000000003' }]]) {
      await R.list(page); await R.openSource(page, ids[0].versionId); await page.waitForTimeout(100);
      // Rewrite the entry and keep it as rewritten: the app records the reader's line again as the page unloads.
      await rewrite(change); await page.evaluate(() => { history.replaceState = () => {}; }); await reload(page);
      const after = await reading(page);
      assert.equal(after.mode, 'sources', name + ': the list'); assert.equal(await page.locator('.life-error:not([hidden])').count(), 0, name + ': no error');
    }
    await context.close();
  });
}

// A Korean IME through the browser's own composition path (CDP): the text is in the field but not committed yet.
async function ime(context, page) {
  const session = await context.newCDPSession(page);
  return { compose: async text => { await session.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length }); await frames(page); },
    commit: async text => { await session.send('Input.insertText', { text }); await frames(page); } };
}
async function m3() {
  await S.check('m3 the records search follows the syllable being composed, and the composition goes on', async () => {
    const { page, context } = await S.open({ width: 1440, height: 900 });
    const ids = await R.seed(page, [{ title: '강아지 산책', text: '강아지와 걸은 길.' }, { title: '가방 정리', text: '가방을 비웠다.' },
      ...Array.from({ length: 6 }, (_, index) => ({ title: '나무 물주기 ' + (index + 1), text: '화분에 물을 준 날.' }))]);
    const keyboard = await ime(context, page), input = page.locator('#lifeSearch');
    const titles = () => page.locator('#lifeSearchResults .life-source-open').allTextContents();
    const field = () => input.evaluate(element => ({ value: element.value, focused: document.activeElement === element, caret: [element.selectionStart, element.selectionEnd], same: element.__probe === true }));
    await input.click(); await input.evaluate(element => { element.__probe = true; window.__compositionEnds = 0; element.addEventListener('compositionend', () => window.__compositionEnds++); });
    assert.equal((await titles()).length, 8);
    await keyboard.compose('ㄱ');
    assert.deepEqual(await titles(), [], 'ㄱ alone matches no syllable');
    await keyboard.compose('가');
    assert.deepEqual(await titles(), ['가방 정리'], 'the list shows 가 while it is still being composed');
    assert.deepEqual(await field(), { value: '가', focused: true, caret: [1, 1], same: true }, 'the field, its focus and caret are untouched');
    await keyboard.compose('강');
    assert.deepEqual(await titles(), ['강아지 산책'], 'the same syllable went on composing (가 → 강), and the list followed');
    assert.equal((await field()).value, '강', 'not 가강: the composition was not broken by the redraw');
    assert.equal(await page.evaluate(() => window.__compositionEnds), 0, 'still composing');
    await keyboard.commit('강');
    assert.deepEqual(await field(), { value: '강', focused: true, caret: [1, 1], same: true }); assert.equal(await page.evaluate(() => window.__compositionEnds), 1);
    assert.deepEqual(await titles(), ['강아지 산책']);
    await keyboard.compose('아'); assert.equal((await field()).value, '강아'); assert.deepEqual(await titles(), ['강아지 산책']);
    await keyboard.compose('안'); assert.deepEqual(await titles(), [], '강안 matches nothing, while composing');
    await keyboard.commit('아'); assert.deepEqual(await titles(), ['강아지 산책']); assert.equal((await field()).value, '강아');
    // Plain typing and clearing still work as before.
    await page.locator('#lifeSearchClear').click(); await frames(page); assert.equal((await titles()).length, 8);
    await input.fill('가방'); await frames(page); assert.deepEqual(await titles(), ['가방 정리']);
    // The list beside an open original (1101px and wider) uses the same field.
    await page.locator('#lifeSearchClear').click(); await R.openSource(page, ids[0].versionId);
    const pane = page.locator('#lifePaneSearch'), paneTitles = () => page.locator('#lifeRecordsPaneList .records-row-title').allTextContents();
    await pane.click(); await keyboard.compose('가');
    assert.deepEqual(await paneTitles(), ['가방 정리']); assert.equal(await pane.evaluate(element => document.activeElement === element && element.value), '가');
    await keyboard.compose('강'); assert.deepEqual(await paneTitles(), ['강아지 산책']); assert.equal(await pane.inputValue(), '강');
    assert.match(await page.locator('#lifeReaderMatchCount').textContent(), /일치 [12]/, 'the open original shows its matches for the composing text');
    await keyboard.commit('강'); assert.equal(await pane.inputValue(), '강');
    await context.close();
  });
  await S.check('m3 찾기 (unified search) follows the syllable being composed', async () => {
    const { page, context } = await S.open({ width: 1440, height: 900, url: '/index.html?section=records' });
    await R.seed(page, [{ title: '강아지 산책', text: '강아지와 걸은 길.' }, { title: '가방 정리', text: '가방을 비웠다.' }, { title: '나무 물주기', text: '화분에 물을 준 날.' }]);
    await page.goto(R.base + '/index.html?section=records&view=find'); await R.ready(page); await settle(page);
    const keyboard = await ime(context, page), input = page.locator('#lifeFindQuery');
    const hits = async () => (await page.locator('#lifeFindResults .life-find-result').allTextContents()).map(text => text.includes('강아지') ? '강아지' : text.includes('가방') ? '가방' : '기타').sort();
    await page.locator('#lifeFind[aria-busy="false"]').waitFor(); await input.click(); await input.evaluate(element => { element.__probe = true; });
    await keyboard.compose('가');
    assert.deepEqual(await hits(), ['가방'], 'results while 가 is being composed');
    await keyboard.compose('강');
    assert.deepEqual(await hits(), ['강아지']); assert.equal(await input.evaluate(element => element.__probe === true && document.activeElement === element && element.value), '강');
    await keyboard.commit('강'); assert.deepEqual(await hits(), ['강아지']); assert.equal(await input.inputValue(), '강');
    assert.equal(JSON.stringify(await page.evaluate(() => history.state)).includes('강'), false, 'the query is not stored');
    await context.close();
  });
}

async function m4() {
  await S.check('m4 키보드로 구절 선택: Shift + arrows select an exact passage, and nothing can change the text', async () => {
    const { page, context } = await S.open({ width: 1440, height: 900 });
    const raw = '첫 줄 😀 문장입니다.\r\n둘째 줄입니다.\r\n\r\n셋째 문단.';
    const ids = await R.seed(page, [{ title: '키보드 선택', text: raw }]);
    await R.openSource(page, ids[0].versionId);
    await R.pressAt(page, '#lifeExcerptToggle'); await page.locator('#lifeExcerptPanel').waitFor();
    await page.getByRole('button', { name: '키보드로 구절 선택', exact: true }).click();
    const area = page.locator('#lifeSourceSelectionText'), display = raw.replace(/\r\n/g, '\n');
    const text = () => area.evaluate(element => ({ value: element.value, readOnly: element.readOnly, aria: element.getAttribute('aria-readonly'), focused: document.activeElement === element, selection: [element.selectionStart, element.selectionEnd] }));
    assert.deepEqual(await text(), { value: display, readOnly: false, aria: 'true', focused: true, selection: [0, 0] });
    // Shift + arrows, as the help line says: six characters (the emoji is two UTF-16 units, one arrow press).
    for (let step = 0; step < 6; step++) await page.keyboard.press('Shift+ArrowRight');
    assert.deepEqual((await text()).selection, [0, 7]);
    assert.equal(await page.locator('#lifeSelectedQuote').textContent(), '첫 줄 😀 ');
    // Across the CRLF line break with Shift+ArrowDown and End: display offsets map back to the exact raw range.
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Shift+End');
    const picked = await page.locator('#lifeSelectedQuote').textContent(), selection = (await text()).selection;
    assert.equal(picked, display.slice(selection[0], selection[1]).replace(/\n/g, '\r\n')); assert(picked.includes('\r\n둘째 줄입니다.'), JSON.stringify(picked));
    // Nothing changes the text: typing, Enter, deleting, cutting, pasted or inserted text, an IME composition, a script.
    const session = await context.newCDPSession(page);
    const unchanged = async label => { await frames(page); assert.equal((await text()).value, display, label + ': the text is unchanged'); };
    await page.keyboard.type('abc'); await unchanged('typing');
    await page.keyboard.press('Enter'); await unchanged('Enter');
    await page.keyboard.press('Backspace'); await page.keyboard.press('Delete'); await unchanged('Backspace and Delete');
    await page.keyboard.press('Control+A'); await page.keyboard.press('Control+X'); await unchanged('cut');
    await page.keyboard.press('Control+A'); await page.keyboard.press('Delete'); await unchanged('select all and delete');
    await session.send('Input.insertText', { text: '붙여 넣은 글' }); await unchanged('inserted text (paste, dictation)');
    await area.evaluate(element => { const data = new DataTransfer(); data.setData('text/plain', '붙여넣기'); return element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); }).then(allowed => assert.equal(allowed, false, 'paste is refused'));
    await area.evaluate(element => { const data = new DataTransfer(); data.setData('text/plain', '끌어 놓기'); return element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })); }).then(allowed => assert.equal(allowed, false, 'drop is refused'));
    await unchanged('paste and drop events');
    await session.send('Input.imeSetComposition', { text: '가', selectionStart: 1, selectionEnd: 1 }); await frames(page);
    await session.send('Input.insertText', { text: '가' }); await unchanged('an IME composition');
    await area.evaluate(element => { element.setRangeText('X', 0, 3); element.dispatchEvent(new Event('input', { bubbles: true })); }); await unchanged('a script edit');
    assert.equal(await page.locator('#lifeSourceText').textContent(), raw, 'the original on screen is unchanged');
    // The selection still works after all that, and the saved excerpt is the exact raw range.
    await page.keyboard.press('Control+Home'); for (let step = 0; step < 3; step++) await page.keyboard.press('Shift+ArrowRight');
    assert.equal(await page.locator('#lifeSelectedQuote').textContent(), '첫 줄');
    await page.locator('#lifeSourceTopic').fill('키보드'); await page.locator('#lifeSourceExcerptSave').click(); await settle(page);
    const bundle = await R.bundle(page), record = bundle.records.find(item => item.topic === '키보드');
    assert.deepEqual(record.sourceRefs[0].locator, { start: 0, end: 3 }); assert.equal(record.text, '첫 줄');
    assert.equal(bundle.sourceVersions.find(version => version.id === ids[0].versionId).contentText, raw); assert.equal(bundle.sourceVersions.length, 1);
    await context.close();
  });
}

async function m5() {
  const DRAFTS = 'caeyeon_life_reader_drafts';
  await S.check('m5 an excerpt note that was not saved yet comes back after a reload, in this tab only', async () => {
    const { page, context } = await S.open({ width: 1440, height: 900 });
    const text = paragraphs(60), quote = '가-7번째 문단.';
    const ids = await R.seed(page, [{ title: '문서 가', text }, { title: '문서 나', text: '짧은 글.' }]);
    await R.openSource(page, ids[0].versionId);
    await page.evaluate(quote => { const node = document.querySelector('#lifeSourceText').firstChild, at = node.data.indexOf(quote), range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + quote.length); getSelection().removeAllRanges(); getSelection().addRange(range); }, quote);
    await R.pressAt(page, '#lifeExcerptToggle'); await page.locator('#lifeExcerptPanel').waitFor();
    assert.equal(await page.locator('#lifeSelectedQuote').textContent(), quote);
    await page.locator('#lifeSourceTopic').fill('초안 주제'); await page.locator('#lifeSourceNote').fill('아직 저장하지 않은 메모 🌱\n둘째 줄');
    const stored = JSON.parse(await page.evaluate(key => sessionStorage.getItem(key), DRAFTS));
    assert.equal(stored.workspaceId, await page.evaluate(() => HaedoLife.Shell.storage.getActive())); assert.equal(stored.owner, R.accounts.a.id);
    page.once('dialog', dialog => dialog.accept()); // the browser's own "leave?" question for unsaved input stays
    await reload(page);
    assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'source');
    assert.match(await page.locator('#lifeReaderNotice').textContent(), /저장하지 않은 발췌 메모가 있습니다/);
    assert.equal((await R.bundle(page)).records.length, 0, 'still not in the collection');
    await R.pressAt(page, '#lifeExcerptToggle'); await page.locator('#lifeExcerptPanel').waitFor();
    assert.equal(await page.locator('#lifeSourceTopic').inputValue(), '초안 주제'); assert.equal(await page.locator('#lifeSourceNote').inputValue(), '아직 저장하지 않은 메모 🌱\n둘째 줄');
    assert.equal(await page.locator('#lifeSelectedQuote').textContent(), quote, 'with the passage it was written for');
    // Saving it puts it in the collection and removes the tab copy.
    await page.locator('#lifeSourceExcerptSave').click(); await settle(page);
    const record = (await R.bundle(page)).records[0];
    assert.equal(record.text, quote); assert.equal(record.topic, '초안 주제'); assert.equal(record.note, '아직 저장하지 않은 메모 🌱\n둘째 줄');
    assert.deepEqual(record.sourceRefs[0].locator, { start: text.indexOf(quote), end: text.indexOf(quote) + quote.length });
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), DRAFTS), null);
    await reload(page);
    assert.equal(await page.locator('#lifeReaderNotice').isHidden(), true, 'nothing to give back after it was saved');
    await context.close();
  });
  await S.check('m5 the tab copy is never shown to another space or account, and is removed there', async () => {
    const { page, context } = await S.open({ width: 1440, height: 900 });
    const ids = await R.seed(page, [{ title: '문서 가', text: paragraphs(20) }]);
    await R.openSource(page, ids[0].versionId);
    await R.pressAt(page, '#lifeExcerptToggle'); await page.locator('#lifeSourceNote').fill('남의 눈에 보이면 안 되는 메모');
    const saved = await page.evaluate(key => sessionStorage.getItem(key), DRAFTS); assert(saved.includes('남의 눈에'));
    for (const [name, change] of [['another account', { owner: '00000000-0000-4000-8000-00000000000b' }], ['another space', { workspaceId: '00000000-0000-4000-8000-00000000000c' }]]) {
      // The same tab storage as that other owner or space would find it.
      await page.evaluate(({ key, saved, change }) => { window.addEventListener('beforeunload', event => event.stopImmediatePropagation(), true); sessionStorage.setItem(key, JSON.stringify({ ...JSON.parse(saved), ...change })); HaedoLife.Shell.storage.getActive(); }, { key: DRAFTS, saved, change });
      page.once('dialog', dialog => dialog.accept());
      await page.goto(R.base + '/index.html?section=records&view=sources'); await R.ready(page); await settle(page);
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), DRAFTS), null, name + ': the copy is removed, not read');
      await R.openSource(page, ids[0].versionId); await R.pressAt(page, '#lifeExcerptToggle');
      assert.equal(await page.locator('#lifeSourceNote').inputValue(), '', name + ': nothing is shown');
      await page.locator('#lifeSourceNote').fill('남의 눈에 보이면 안 되는 메모');
    }
    await context.close();
  });
  await S.check('m5 the import form keeps the last keys typed right before a reload', async () => {
    const { page, context } = await S.open({ width: 1440, height: 900, url: '/index.html?section=records&view=import' });
    await page.locator('#lifeImportTitle').waitFor();
    await page.locator('#lifeImportTitle').fill('방금 붙인 글'); await page.locator('#lifeImportText').fill('새로고침 직전에 친 마지막 문장.');
    await page.reload(); await R.ready(page); await settle(page); // at once: inside the 400ms the form waits before keeping its input
    const kept = await page.evaluate(async () => { const storage = HaedoLife.Shell.storage; return (await storage.listStages(await storage.getActive())).filter(stage => stage.kind !== 'writing' && stage.kind !== 'source-edit').map(stage => [stage.input.title, stage.input.text]); });
    assert.deepEqual(kept, [['방금 붙인 글', '새로고침 직전에 친 마지막 문장.']]);
    await context.close();
  });
}

async function main() {
  await S.start();
  try {
    await group('m1', m1);
    await group('m2', m2);
    await group('m3', m3);
    await group('m4', m4);
    await group('m5', m5);
  } finally { await S.finish(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

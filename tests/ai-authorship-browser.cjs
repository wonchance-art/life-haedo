/* AI authorship marks in the default writer (writing-ai-review 묶음 A).
 * Actual app, bundled SDK, IndexedDB and Quill in Chromium; synthetic Auth and
 * blog HTTP (FakeCloud). IME composition uses CDP Input.imeSetComposition and
 * OS writing tools are simulated with beforeinput insertReplacementText and
 * execCommand('insertText'). No Apple device, native IME or production claim. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4261';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { awaitCondition } = require('./helpers/await-condition.cjs');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, base, cloud } = require('./life-sync-browser.cjs');
const output = path.resolve(__dirname, '../.local/ai-authorship');
const report = { scope: 'Chromium/Linux, synthetic Auth/blog HTTP, CDP IME and synthetic beforeinput. Not Apple hardware, native IME or hosted SQL.',
  checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [] };

// In-page helpers (fixed local code, evaluated in the app page).
const editorState = page => page.evaluate(() => {
  const q = Quill.find(document.querySelector('.photo-quill'));
  return { ops: q.getContents().ops, text: q.getText(), spans: [...document.querySelectorAll('.ql-editor .photo-ai-text')].map(n => n.textContent) };
});
const aiRuns = ops => ops.filter(op => op.attributes?.author === 'ai').map(op => op.insert);
const setSelection = (page, index, length) => page.evaluate(([i, l]) => { const q = Quill.find(document.querySelector('.photo-quill')); q.focus(); q.setSelection(i, l, 'user'); }, [index, length]);
const indexOf = (page, needle) => page.evaluate(n => Quill.find(document.querySelector('.photo-quill')).getText().indexOf(n), needle);
const paste = (page, text) => page.evaluate(value => {
  const data = new DataTransfer(); data.setData('text/plain', value);
  document.querySelector('.ql-editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
}, text);
const status = page => page.locator('.photo-commandbar .photo-status-text').textContent();
async function stored(page) {
  return page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, ws = await s.getActive();
    return Promise.all((await s.listPhotoPosts(ws)).map(row => s.readPhotoPost(ws, row.id)));
  });
}
async function durable(page, predicate, label) {
  const deadline = Date.now() + 15000; let docs;
  do { docs = await stored(page); const hit = docs.find(predicate); if (hit) return hit; await new Promise(r => setTimeout(r, 50)); } while (Date.now() < deadline);
  assert.fail(label + ': ' + JSON.stringify(docs.map(d => ({ id: d.id, status: d.status, ops: d.ops }))).slice(0, 1500));
}
// Slow storage, deterministically: hold a readwrite transaction on the photo-post stores from
// a second connection, so the next save waits inside IndexedDB until release().
async function holdPhotoStores(page) {
  await page.evaluate(() => new Promise((started, failed) => {
    const request = indexedDB.open('life-tools-v1'); request.onerror = () => failed(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['bundles', 'meta'], 'readwrite'), meta = tx.objectStore('meta');
      window.__photoStoreHold = { released: false, done: false };
      const spin = () => { if (!window.__photoStoreHold.released) meta.get('__ai_authorship_hold__').onsuccess = spin; };
      tx.oncomplete = () => { db.close(); window.__photoStoreHold.done = true; }; spin(); started();
    };
  }));
  return { release: async () => { await page.evaluate(() => { window.__photoStoreHold.released = true; }); await page.waitForFunction(() => window.__photoStoreHold.done); } };
}
const sameOps = expected => doc => JSON.stringify(doc.ops) === JSON.stringify(expected);
async function settled(page) {
  // Owner text loses an inherited mark right after its change (a microtask)
  // and a composition right after it ends; this only lets the page catch up.
  await page.waitForTimeout(150);
}
const aiText = ops => aiRuns(ops).join('');
// Walk the undo (or redo) stack until `done`, checking every step: the AI text
// never grows, so no owner character is ever re-marked as AI text.
async function walk(page, key, expectedAi, done, label) {
  for (let step = 0; step < 40; step++) {
    const s = await editorState(page);
    assert.equal(aiText(s.ops), expectedAi, label + ' step ' + step + ': ' + JSON.stringify(s.ops));
    if (done(s)) return step;
    await page.keyboard.press(key);
  }
  assert.fail(label + ': did not reach the expected state');
}
// Quill history groups user changes made within 700 ms (history.delay). A
// person pausing before the next step starts a separate undo step.
const pause = page => page.waitForTimeout(800);

async function flow(browser, { label, viewport, hasTouch = false }) {
  const server = new FakeCloud();
  const context = await makeContext(browser, server, 'ai-' + label, accounts.a, { viewport, hasTouch });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if ([new URL(base).origin, cloud].includes(url.origin) || ['blob:', 'data:'].includes(url.protocol)) return route.fallback();
    report.external.push(url.origin); return route.abort();
  });
  context.on('page', page => {
    page.setDefaultTimeout(15000);
    page.on('console', e => { if (e.type() === 'error') report.consoleErrors.push({ label, text: e.text() }); });
    page.on('pageerror', e => report.pageErrors.push({ label, message: e.message }));
  });
  const page = await context.newPage();
  const check = async (name, run) => { console.log('START ' + label + ': ' + name); await run(); report.checks.push({ label, name, pass: true }); console.log('PASS ' + label + ': ' + name); };
  const shot = async name => { const file = label + '-' + name + '.png'; await page.screenshot({ path: path.join(output, file), fullPage: false }); report.visual.push(file); };
  try {
    await page.goto(base + '/index.html'); await ready(page); await settle(page);
    await page.locator('[data-home-destination="write"]:visible, #homeFirstWrite:visible').first().click();
    await page.locator('#photoTitle').waitFor(); await page.locator('.ql-editor').waitFor();
    // The control sits in the extra formats (서식) disclosure with italic, lists and quotes.
    const toggle = page.getByRole('button', { name: 'AI 글 표시', exact: true });
    const openFormats = async () => {
      if (!(await page.locator('.photo-format-options').evaluate(n => n.open))) await page.locator('.photo-format-options > summary').click();
      await toggle.waitFor();
    };
    const clickToggle = async () => { await openFormats(); await toggle.click(); };
    assert.equal(await toggle.isVisible(), false, 'closed until 서식 is opened');
    await openFormats();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    assert.equal(await toggle.getAttribute('title'), 'AI 글 표시 · 선택이 없으면 다음 붙여넣기');
    const box = await toggle.boundingBox(); assert(box.width >= 44 && box.height >= 44, 'the control keeps a 44px target');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no horizontal overflow');

    await page.locator('#photoTitle').fill('AI 표시 합성 글');
    await page.locator('.ql-editor').click();
    await page.keyboard.type('Mine first. ');
    await check('① a selection is marked as AI text, saved, and still marked after reopening', async () => {
      await paste(page, 'AI suggested sentence.');
      await page.keyboard.type(' Mine last.');
      let s = await editorState(page);
      assert.deepEqual(aiRuns(s.ops), [], 'a plain paste is the owner\'s text');
      const at = await indexOf(page, 'AI suggested sentence.');
      await setSelection(page, at, 'AI suggested sentence.'.length);
      await clickToggle();
      s = await editorState(page);
      assert.deepEqual(aiRuns(s.ops), ['AI suggested sentence.']);
      assert.deepEqual(s.spans, ['AI suggested sentence.']);
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true', 'the selection is all AI text');
      assert.equal(await status(page), 'AI 글로 표시했어요');
      const style = await page.locator('.ql-editor .photo-ai-text').evaluate(n => { const c = getComputedStyle(n); return { line: c.textDecorationLine, style: c.textDecorationStyle, color: c.color, background: c.backgroundColor }; });
      assert.equal(style.style, 'dotted'); assert.match(style.line, /underline/);
      await shot('marked');
      await durable(page, d => d.status === 'draft' && aiRuns(d.ops).join('') === 'AI suggested sentence.', 'autosaved mark');
      // The short note gives way to the save state once the autosave completes.
      await awaitCondition(page, () => document.querySelector('.photo-commandbar .photo-status-text').textContent === '자동 저장됨', null, { timeout: 5000, label: 'save state shown again after the note' });
    });
    await check('② owner typing inside AI text is the owner\'s; one undo removes it', async () => {
      const before = await editorState(page);
      const at = await indexOf(page, 'suggested');
      await setSelection(page, at, 0);
      await pause(page);
      await page.keyboard.type('XY ');
      await settled(page);
      const s = await editorState(page);
      assert.equal(s.text.includes('AI XY suggested sentence.'), true, s.text);
      assert.deepEqual(aiRuns(s.ops), ['AI ', 'suggested sentence.'], JSON.stringify(s.ops));
      await durable(page, sameOps(s.ops), 'autosaved owner edit');
      await page.keyboard.press('Control+z');
      const undone = await editorState(page);
      assert.deepEqual(undone.ops, before.ops, 'one undo removes the typed text and leaves the mark intact');
      await page.keyboard.press('Control+Shift+z');
      assert.deepEqual((await editorState(page)).ops, s.ops, 'redo restores the owner text as owner text');
    });
    // The DOM stays unsplit while a composition is open and the composed syllables
    // end as the owner's. This does not exercise the defensive imeActive() guard
    // on its own: no owner range is pending when this composition opens.
    await check('③ IME composition inside AI text leaves the AI span unsplit while composing, then the result is the owner\'s', async () => {
      const cdp = await context.newCDPSession(page);
      await page.evaluate(() => { window.__ime = { start: 0, end: 0 }; const root = document.querySelector('.ql-editor'); root.addEventListener('compositionstart', () => __ime.start++); root.addEventListener('compositionend', () => __ime.end++); });
      const at = await indexOf(page, 'sentence');
      await setSelection(page, at, 0);
      await cdp.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
      await cdp.send('Input.imeSetComposition', { text: '하', selectionStart: 1, selectionEnd: 1 });
      await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
      await page.waitForTimeout(400);
      const during = await page.evaluate(() => ({ ime: { ...__ime }, spans: [...document.querySelectorAll('.ql-editor .photo-ai-text')].map(n => n.textContent), status: document.querySelector('.photo-commandbar .photo-status-text').textContent }));
      assert.deepEqual(during.ime, { start: 1, end: 0 }, 'a real composition is open');
      assert(during.spans.some(text => text.includes('한sentence')), 'no reformat during composition: ' + JSON.stringify(during.spans));
      assert.equal(during.status, '한글 입력 중…');
      await cdp.send('Input.insertText', { text: '한' });
      await cdp.send('Input.imeSetComposition', { text: 'ㄱ', selectionStart: 1, selectionEnd: 1 });
      await cdp.send('Input.imeSetComposition', { text: '글', selectionStart: 1, selectionEnd: 1 });
      await cdp.send('Input.insertText', { text: '글' });
      await settled(page);
      assert.equal(await page.evaluate(() => __ime.end), 2, 'both syllables were composed');
      const s = await editorState(page);
      assert.equal(s.text.includes('XY suggested 한글sentence.'), true, s.text);
      assert.deepEqual(aiRuns(s.ops), ['AI ', 'suggested ', 'sentence.'], JSON.stringify(s.ops));
      await durable(page, sameOps(s.ops), 'autosaved composed text');
      await cdp.detach();
    });
    await check('⑨ owner typing that spans several undo steps stays the owner\'s through undo/redo', async () => {
      // 16 keys 90 ms apart: never idle, about 1.4 s, more than Quill's 700 ms grouping.
      const end = (await editorState(page)).text.length - 1;
      await setSelection(page, end, 0);
      await pause(page);
      await clickToggle();
      await paste(page, ' AIAIAIAIAI');
      await pause(page);
      await setSelection(page, (await indexOf(page, 'AIAIAIAIAI')) + 4, 0);
      await pause(page);
      const before = await editorState(page), ai = aiText(before.ops);
      await page.keyboard.type('ownerownerowner!', { delay: 90 });
      await settled(page);
      const typed = await editorState(page);
      assert.equal(typed.text.includes(' AIAIownerownerowner!AIAIAI'), true, typed.text);
      assert.equal(aiText(typed.ops), ai, 'typed characters are the owner\'s: ' + JSON.stringify(typed.ops));
      await durable(page, sameOps(typed.ops), 'autosaved multi-step typing');
      const undos = await walk(page, 'Control+z', ai, s => s.text === before.text, 'undo');
      assert(undos >= 2, 'the typing spanned several undo steps: ' + undos);
      assert.deepEqual((await editorState(page)).ops, before.ops);
      await walk(page, 'Control+Shift+z', ai, s => s.text === typed.text, 'redo');
      assert.deepEqual((await editorState(page)).ops, typed.ops, 'redo restores the owner text as owner text');
      await walk(page, 'Control+z', ai, s => s.text === before.text, 'second undo');
      await walk(page, 'Control+Shift+z', ai, s => s.text === typed.text, 'second redo');
    });
    await check('⑩ a Korean composition over several syllables (> 700 ms) stays the owner\'s through undo/redo', async () => {
      const cdp = await context.newCDPSession(page);
      await setSelection(page, (await indexOf(page, 'owner!AIAIAI')) + 'owner!A'.length, 0);
      await pause(page);
      const before = await editorState(page), ai = aiText(before.ops);
      const started = Date.now();
      // 11 composition steps x 140 ms guarantee the > 1400 ms precondition by the
      // waits alone (11 x 120 ms = 1320 ms only passed where CDP overhead added
      // the rest, and failed on the faster CI runner).
      for (const [steps, text] of [[['ㄱ', '가', '갈'], '갈'], [['ㅁ', '매'], '매'], [['ㄱ', '기'], '기'], [['ㅇ', '아'], '아'], [['ㄹ', '래'], '래']]) {
        for (const step of steps) { await cdp.send('Input.imeSetComposition', { text: step, selectionStart: 1, selectionEnd: 1 }); await page.waitForTimeout(140); }
        await cdp.send('Input.insertText', { text });
      }
      assert(Date.now() - started > 1400, 'the composition spans more than one undo grouping window');
      await settled(page);
      const typed = await editorState(page);
      assert.equal(typed.text.includes('owner!A갈매기아래IAIAI'), true, typed.text);
      assert.equal(aiText(typed.ops), ai, 'composed syllables are the owner\'s: ' + JSON.stringify(typed.ops));
      await durable(page, sameOps(typed.ops), 'autosaved multi-syllable composition');
      const undos = await walk(page, 'Control+z', ai, s => s.text === before.text, 'undo');
      assert(undos >= 2, 'the composition spanned several undo steps: ' + undos);
      await walk(page, 'Control+Shift+z', ai, s => s.text === typed.text, 'redo');
      assert.deepEqual((await editorState(page)).ops, typed.ops);
      await cdp.detach();
    });
    await check('⑪ a removal that lands just after the 700 ms grouping window still joins the input\'s undo step', async () => {
      await setSelection(page, (await indexOf(page, 'IAIAI\n')) + 2, 0);
      await pause(page);
      const before = await editorState(page), ai = aiText(before.ops);
      // Deterministic edge: the clock jumps 800 ms between Quill recording the
      // key and the mark removal that follows it in the same task.
      await page.evaluate(() => {
        const q = Quill.find(document.querySelector('.photo-quill')), real = Date.now.bind(Date);
        let skew = 0; Date.now = () => real() + skew;
        const once = () => { skew += 800; q.off('text-change', once); };
        q.on('text-change', once); window.__restoreNow = () => { Date.now = real; };
      });
      try {
        await page.keyboard.type('K');
        await settled(page);
        const typed = await editorState(page);
        assert.equal(aiText(typed.ops), ai, JSON.stringify(typed.ops));
        await page.keyboard.press('Control+z');
        const undone = await editorState(page);
        assert.deepEqual(undone.ops, before.ops, 'one undo removes the key; it is never re-marked as AI text first');
      } finally { await page.evaluate(() => __restoreNow()); }
    });
    await check('④ the armed paste is AI text once; a plain paste is the owner\'s; Esc disarms', async () => {
      const end = (await editorState(page)).text.length - 1;
      await setSelection(page, end, 0);
      await clickToggle();
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
      assert.equal(await status(page), 'AI 붙여넣기 대기');
      const announced = await page.locator('.photo-commandbar .photo-status').textContent();
      assert.match(announced, /다음 붙여넣기 한 번을 AI 글로 표시합니다\. AI 글 표시 버튼을 다시 누르면 취소합니다\./);
      const fits = await page.locator('.photo-commandbar .photo-status-text').evaluate(t => { const r = document.createRange(); r.selectNodeContents(t); return r.getBoundingClientRect().width <= t.parentElement.clientWidth + 1; });
      assert.equal(fits, true, 'the short waiting text fits the one-line status');
      // Pressing the control again cancels on any input method.
      await clickToggle();
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
      assert.equal(await status(page), 'AI 글 붙여넣기 대기를 껐어요');
      assert.doesNotMatch(await page.locator('.photo-commandbar .photo-status').textContent(), /다시 누르면 취소/);
      await clickToggle();
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
      await page.keyboard.press('Escape');
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
      assert.equal(await status(page), 'AI 글 붙여넣기 대기를 껐어요');
      // The Esc notice confirms a state change, not an edit: the save of an earlier edit that
      // lands after Esc (slow storage) leaves it on screen; the next edit clears it.
      const revision = Math.max(...(await stored(page)).map(d => d.revision)), hold = await holdPhotoStores(page);
      await setSelection(page, (await editorState(page)).text.length - 1, 0);
      await page.keyboard.type('Q'); await page.keyboard.press('Control+z');
      await clickToggle(); await page.keyboard.press('Escape');
      assert.equal(await status(page), 'AI 글 붙여넣기 대기를 껐어요');
      await hold.release(); await durable(page, d => d.revision > revision, 'the earlier edit saved after Esc');
      assert.equal(await status(page), 'AI 글 붙여넣기 대기를 껐어요');
      await setSelection(page, (await editorState(page)).text.length - 1, 0);
      await paste(page, ' Plain paste.');
      await clickToggle();
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
      await paste(page, ' Armed AI paste.');
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false', 'the armed state covers one paste');
      assert.equal(await status(page), '붙여넣은 글을 AI 글로 표시했어요');
      // The caret is at the end of the AI run: this paste inherits the mark
      // first and is settled as the owner's text.
      await paste(page, ' Second plain paste.');
      await settled(page);
      const s = await editorState(page);
      assert.deepEqual(aiRuns(s.ops).slice(-1), [' Armed AI paste.']);
      assert.equal(aiRuns(s.ops).some(text => /Plain|plain/.test(text)), false);
      await durable(page, sameOps(s.ops), 'autosaved pastes');
    });
    await check('⑤ unmarking and ⑥ undo of a mark change', async () => {
      const before = await editorState(page);
      const at = await indexOf(page, ' Armed AI paste.');
      await setSelection(page, at, ' Armed AI paste.'.length);
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
      await pause(page);
      await clickToggle();
      assert.equal(await status(page), 'AI 글 표시를 해제했어요');
      const after = await editorState(page);
      assert.equal(aiRuns(after.ops).includes(' Armed AI paste.'), false);
      assert.equal(after.text, before.text, 'unmarking never changes the text');
      await page.locator('.ql-editor').focus();
      await page.keyboard.press('Control+z');
      assert.deepEqual((await editorState(page)).ops, before.ops, 'undo restores the mark');
    });
    await check('⑦ OS writing-tool replacements keep autosave and undo, and are not guessed as AI text', async () => {
      const before = await editorState(page);
      const word = 'sentence.';
      const at = before.text.indexOf(word);
      await setSelection(page, at, word.length);
      await pause(page);
      // Apple Writing Tools / autocorrect: beforeinput insertReplacementText with a target range.
      const prevented = await page.evaluate(([start, length]) => {
        const q = Quill.find(document.querySelector('.photo-quill'));
        const [leaf, offset] = q.getLeaf(start + 1);
        const node = leaf.domNode, range = new StaticRange({ startContainer: node, startOffset: offset - 1, endContainer: node, endOffset: offset - 1 + length });
        const event = new InputEvent('beforeinput', { inputType: 'insertReplacementText', data: 'line.', targetRanges: [range], bubbles: true, cancelable: true });
        q.root.dispatchEvent(event); return event.defaultPrevented;
      }, [at, word.length]);
      assert.equal(prevented, true, 'Quill handled the replacement');
      await settled(page);
      let s = await editorState(page);
      assert.equal(s.text.includes('한글line.'), true, s.text);
      assert.equal(aiRuns(s.ops).includes('line.'), false, 'replacement text is not guessed as AI text');
      await durable(page, sameOps(s.ops), 'autosaved replacement');
      await page.keyboard.press('Control+z');
      assert.deepEqual((await editorState(page)).ops, before.ops, 'undo restores the replaced AI text with its mark');
      // A selection replaced through the editing command (spellcheck/autocomplete path).
      await setSelection(page, at, word.length);
      await pause(page);
      await page.evaluate(() => document.execCommand('insertText', false, 'words.'));
      await settled(page);
      s = await editorState(page);
      assert.equal(s.text.includes('한글words.'), true, s.text);
      assert.equal(aiRuns(s.ops).includes('words.'), false);
      await durable(page, sameOps(s.ops), 'autosaved command replacement');
      await page.keyboard.press('Control+z');
      assert.deepEqual((await editorState(page)).ops, before.ops);
    });
    let savedId;
    await check('① save, read with exactly the marked text shown, reopen with marks; ⑧ public copy has no mark', async () => {
      const expected = (await editorState(page)).ops;
      await page.getByRole('button', { name: '글 저장', exact: true }).click();
      await page.locator('.photo-article').waitFor();
      // Owner decision 2026-11-04: the owner's reading view shows exactly the marked text (the public copy never does).
      const markedPieces = expected.filter(op => typeof op.insert === 'string' && op.attributes?.author === 'ai').flatMap(op => op.insert.split('\n').filter(Boolean));
      assert.deepEqual(await page.locator('.photo-article .blog-ai-text').allTextContents(), markedPieces, 'reading renders exactly the marked text as AI text');
      assert.equal(await page.locator('.photo-article .photo-ai-text').count(), 0, 'the editor-only class is not reused in reading');
      const doc = await durable(page, d => d.status === 'saved', 'saved post');
      savedId = doc.id;
      assert.deepEqual(doc.ops, expected);
      const publicOps = await page.evaluate(async id => {
        const s = HaedoLife.Shell.storage, doc = await s.readPhotoPost(await s.getActive(), id);
        return HaedoLife.Blog.publicSnapshot(doc, { photoIds: [] }).ops;
      }, savedId);
      assert.equal(publicOps.some(op => op.attributes && 'author' in op.attributes), false);
      assert.equal(publicOps.map(op => op.insert).join(''), expected.map(op => op.insert).join(''));
      await page.locator('#photoServerStatus[data-state="synced"]').waitFor({ timeout: 30000 });
      const remote = [...server.posts.values()].find(row => row.id === savedId);
      assert.deepEqual(remote.data.ops, expected, 'the private server copy keeps the marks');
      await page.goto(base + '/index.html'); await ready(page); await settle(page);
      await page.locator('#homePosts[aria-busy="false"]').waitFor();
      await page.locator('#homePosts [data-photo-post-id="' + savedId + '"]').getByRole('button', { name: 'AI 표시 합성 글', exact: true }).first().click();
      await page.locator('.photo-article').waitFor();
      await page.getByRole('button', { name: '글 수정', exact: true }).click();
      await page.locator('.ql-editor .photo-ai-text').first().waitFor();
      assert.deepEqual((await editorState(page)).ops, expected);
      await shot('reopened');
    });
    if (label === 'desktop') await check('the HTML reading file carries no AI mark while the reading view shows every marked run', async () => {
      // Owner decision 2026-11-04: marks show in the owner's reading view; the exported HTML file is out of that scope.
      const title = 'HTML 내보내기 AI 표시 글';
      await page.evaluate(async title => {
        const s = HaedoLife.Shell.storage, P = HaedoLife.PhotoPost, C = HaedoLife.Core, ws = await s.getActive(), doc = P.create(C.id);
        doc.status = 'saved'; doc.title = title;
        doc.ops = [{ insert: '내 문장 ' }, { insert: '일반 AI 문장', attributes: { author: 'ai' } }, { insert: ' ' },
          { insert: '굵은 밑줄 AI 문장', attributes: { author: 'ai', bold: true, underline: true } }, { insert: ' ' },
          { insert: '링크 AI 문장', attributes: { author: 'ai', link: 'https://example.org/ai-mark' } }, { insert: '\n' },
          { insert: '제목 AI 문장', attributes: { author: 'ai' } }, { insert: '\n', attributes: { header: 1 } }];
        await s.savePhotoPost(ws, doc, 0);
      }, title);
      await page.goto(base + '/index.html'); await ready(page); await settle(page);
      await page.locator('#homePosts[aria-busy="false"]').waitFor();
      await page.locator('#homePosts').getByRole('button', { name: title, exact: true }).first().click();
      await page.locator('.photo-article').waitFor();
      const marked = ['일반 AI 문장', '굵은 밑줄 AI 문장', '링크 AI 문장', '제목 AI 문장'];
      assert.deepEqual(await page.locator('.photo-article .blog-ai-text').allTextContents(), marked, 'the reading view marks each run');
      const menu = page.locator('.photo-more');
      if (!await menu.evaluate(n => n.open)) await menu.locator(':scope > summary').click();
      const waiting = page.waitForEvent('download');
      await page.getByRole('button', { name: 'HTML 읽기 파일 받기', exact: true }).click();
      const html = await fs.readFile(await (await waiting).path(), 'utf8');
      for (const needle of ['blog-ai-text', 'author', 'ai-text']) assert.equal(html.includes(needle), false, 'the HTML file contains no ' + needle);
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      assert(text.includes('내 문장 일반 AI 문장 굵은 밑줄 AI 문장 링크 AI 문장'), 'the body text itself is unchanged');
      assert(text.includes('제목 AI 문장'), 'the heading text is unchanged');
      assert.equal((html.match(/<h[1-6][^>]*>\s*제목 AI 문장\s*<\/h[1-6]>/g) || []).length, 1, 'the heading keeps its heading element');
    });
    if (label === 'desktop') await check('two-device sync: the other device receives the exact marks', async () => {
      const other = await makeContext(browser, server, 'ai-' + label + '-b', accounts.a, { viewport });
      await other.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin) || ['blob:', 'data:'].includes(url.protocol)) return route.fallback(); report.external.push(url.origin); return route.abort(); });
      const b = await other.newPage();
      b.on('console', e => { if (e.type() === 'error') report.consoleErrors.push({ label: label + '-b', text: e.text() }); });
      b.on('pageerror', e => report.pageErrors.push({ label: label + '-b', message: e.message }));
      try {
        await b.goto(base + '/index.html'); await ready(b); await settle(b);
        await b.evaluate(() => dispatchEvent(new Event('online')));
        await awaitCondition(b, async id => {
          const s = HaedoLife.Shell.storage;
          for (const library of await s.listAccountLibraries()) for (const row of await s.listPhotoPosts(library.workspaceId)) if (row.id === id) return true;
          return false;
        }, savedId, { timeout: 30000, label: 'device B receives the post' });
        const received = await b.evaluate(async id => {
          const s = HaedoLife.Shell.storage;
          for (const library of await s.listAccountLibraries()) for (const row of await s.listPhotoPosts(library.workspaceId)) if (row.id === id) return (await s.readPhotoPost(library.workspaceId, id)).ops;
        }, savedId);
        const sent = [...server.posts.values()].find(row => row.id === savedId).data.ops;
        assert.deepEqual(received, sent);
        assert(aiRuns(received).length >= 3);
      } finally { await other.close(); }
    });
  } finally { await context.close(); }
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); report.node = process.version;
  try {
    await flow(browser, { label: 'desktop', viewport: { width: 1440, height: 1000 } });
    await flow(browser, { label: 'mobile', viewport: { width: 390, height: 844 }, hasTouch: true });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []);
    report.pass = true;
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
}
if (require.main === module) main().catch(e => { console.error(e.stack); process.exitCode = 1; });

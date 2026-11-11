/* Whatever the editor accepts is kept (2026-11-11 B1). Real app, synthetic
 * account, real IndexedDB/localStorage in Chromium. The IME steps use CDP
 * Input.imeSetComposition, not a native Korean keyboard; the clipboard steps
 * use synthetic ClipboardEvents and Chromium's own clipboard, not Word. */
'use strict';
const H = require('./helpers/writing-input.cjs'), { assert } = H;
const zip = require('../vendor/fflate/fflate.js');
const PARAGRAPH = '그리고 여기서부터 길게 쓴 문단이다. 이 문단은 문제 입력 뒤에 썼고 새로고침 뒤에도 남아야 한다. '.repeat(3);
const draftWith = (page, text) => H.stored(page, rows => rows.some(row => row.status === 'draft' && row.text.includes(text)), 'draft holding ' + JSON.stringify(text.slice(0, 20)));
async function reloaded(page) { await page.reload(); await page.locator('#photoTitle').waitFor(); await page.locator('.ql-editor').waitFor(); }
async function saveSucceeds(page) {
  await page.getByRole('button', { name: '글 저장', exact: true }).click();
  await page.locator('.photo-article').waitFor();
  assert.equal(await H.mode(page), 'read');
}
const recoveryKeys = page => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('haedo_life_post_recovery_v1:')));
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

H.run(__filename, {
  // A: "[ ] " at the start of a line used to become a checklist the post cannot hold.
  async 'checklist-typed'({ open }) {
    const { page } = await open();
    await H.home(page); await H.writer(page);
    await page.locator('#photoTitle').fill('주말 계획');
    await page.locator('.ql-editor').click();
    for (const line of ['이번 주말에 할 일.', '[ ] 장보기', '[x] 세탁소', '[] 청소']) { await page.keyboard.type(line); await page.keyboard.press('Enter'); }
    await page.keyboard.press('Enter');
    await page.keyboard.type(PARAGRAPH);
    await page.keyboard.press('Enter'); await page.keyboard.type('- 글머리'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    await page.keyboard.type('1. 번호');
    const ops = await H.contents(page);
    assert(!ops.some(op => ['checked', 'unchecked'].includes(op.attributes?.list)), 'no checklist line is created');
    assert.deepEqual(ops.filter(op => op.attributes?.list).map(op => op.attributes.list), ['bullet', 'ordered'], '"- " and "1. " still start lists');
    const text = await H.bodyText(page);
    for (const literal of ['[ ] 장보기', '[x] 세탁소', '[] 청소']) assert(text.includes(literal), literal + ' stays as typed');
    await draftWith(page, '번호');
    assert.equal((await H.status(page)).state, 'draft');
    await reloaded(page);
    const after = await H.bodyText(page);
    assert(after.includes(PARAGRAPH) && after.includes('[ ] 장보기') && after.includes('번호'), 'everything typed is back after a reload');
    await saveSucceeds(page);
  },
  // A (backstop): a checklist that reaches the document anyway is stored as a bullet list, the screen follows, and the writer is told.
  async 'checklist-normalized'({ open }) {
    const { page } = await open();
    await H.home(page); await H.writer(page);
    await page.locator('.ql-editor').click();
    await page.keyboard.type('장보기'); await page.keyboard.press('Enter');
    await H.quill(page, q => q.formatLine(0, 1, 'list', 'unchecked', 'user'));
    assert.equal((await H.contents(page)).find(op => op.attributes?.list)?.attributes.list, 'unchecked', 'the editor itself accepts a checklist');
    await page.keyboard.type(PARAGRAPH);
    const rows = await draftWith(page, PARAGRAPH);
    assert.deepEqual(rows[0].ops.filter(op => op.attributes?.list).map(op => op.attributes.list), ['bullet'], 'stored as the nearest supported list');
    await H.until(() => H.contents(page), ops => ops.some(op => op.attributes?.list === 'bullet') && !ops.some(op => op.attributes?.list === 'unchecked'), 'the screen shows what was stored');
    // Said on its own line; the save state beside it stays the real one.
    await H.until(() => H.status(page), value => value.note === '체크 목록은 글머리 목록으로 바꿨어요' && value.text === '자동 저장됨' && value.state === 'draft', 'the change is said in one line and the save state stays true');
    assert((await H.bodyText(page)).includes(PARAGRAPH), 'typed text is untouched by the alignment');
    // The caret stayed at the end of the paragraph: typing continues there.
    await page.keyboard.type(' 끝.');
    await draftWith(page, PARAGRAPH + ' 끝.');
    const archive = await H.download(page, () => H.menu(page, '사진 포함 백업'));
    const manifest = JSON.parse(zip.strFromU8(zip.unzipSync(new Uint8Array(archive))['manifest.json']));
    assert(manifest.ops.some(op => typeof op.insert === 'string' && op.insert.includes('끝.')), 'the backup holds the current input');
    await reloaded(page);
    assert((await H.bodyText(page)).includes(PARAGRAPH + ' 끝.'));
    await saveSucceeds(page);
  },
  // B: control characters (Word's manual line break is U+000B) in the body, the title and a caption.
  async 'control-characters'({ open }) {
    const { page, context } = await open();
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: H.base });
    await H.home(page); await H.writer(page);
    await page.locator('.ql-editor').click();
    await page.keyboard.type('먼저 쓴 문장. ');
    await H.pasteBody(page, { text: '첫째 줄\u000b둘째 줄\u0001\u007f\n다음 문단\uD83C' });
    assert.equal(await H.bodyText(page), '먼저 쓴 문장. 첫째 줄\n둘째 줄\n다음 문단\n', 'a manual line break becomes a line break; the rest is removed');
    // Chromium's own clipboard and a real Ctrl+V.
    await page.evaluate(() => navigator.clipboard.writeText('슬라이드 첫 줄\u000b슬라이드 둘째 줄'));
    await page.keyboard.press('Control+v');
    await H.until(() => H.bodyText(page), text => text.includes('슬라이드 첫 줄\n슬라이드 둘째 줄'), 'real paste is cleaned');
    await page.keyboard.type(' ' + PARAGRAPH);
    await draftWith(page, PARAGRAPH);
    // Title: a real paste and a synthetic one that carries line breaks.
    await page.evaluate(() => navigator.clipboard.writeText('제목\u001f조각\u000b둘째'));
    await page.locator('#photoTitle').click(); await page.keyboard.press('Control+v');
    await H.until(() => page.locator('#photoTitle').inputValue(), value => value === '제목조각 둘째', 'title paste is one clean line');
    await H.stored(page, rows => rows[0]?.title === '제목조각 둘째', 'title stored');
    // A caption with the same characters, set the way a paste into the field arrives.
    await page.locator('#photoFiles').setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: await H.jpeg(page) });
    await page.locator('.photo-block img').waitFor();
    await page.locator('.photo-block .photo-caption-text').click();
    await page.locator('[aria-label="사진 설명"]').evaluate(input => { input.focus(); input.value = '설명 첫 줄\u000b둘째\u0002'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await H.until(() => page.locator('[aria-label="사진 설명"]').inputValue(), value => value === '설명 첫 줄\n둘째', 'caption is cleaned in place');
    const rows = await H.stored(page, list => list[0]?.text.includes('설명 첫 줄\n둘째'), 'caption stored');
    assert(!UNSAFE.test(JSON.stringify(rows[0].ops).replace(/\\n/g, '')) && !UNSAFE.test(rows[0].title), 'nothing unsafe is stored');
    assert.notEqual((await H.status(page)).state, 'error');
    await reloaded(page);
    assert((await H.bodyText(page)).includes(PARAGRAPH), 'the paragraph written after the paste survives a reload');
    await saveSucceeds(page);
  },
  // B (backstop): characters that reach the document some other way are removed on store, on screen too.
  async 'control-characters-normalized'({ open }) {
    const { page } = await open();
    await H.home(page); await H.writer(page);
    await page.locator('.ql-editor').click();
    await page.keyboard.type('앞 문장.');
    await H.quill(page, q => q.insertText(q.getLength() - 1, ' 끼\u0001어\u000b든 글자', 'user'));
    await H.quill(page, q => q.setSelection(q.getLength() - 1, 0, 'silent'));
    await page.keyboard.type(' ' + PARAGRAPH);
    const rows = await draftWith(page, PARAGRAPH);
    assert(rows[0].text.includes('끼어\n든 글자'), 'stored clean');
    await H.until(() => H.bodyText(page), text => text.includes('끼어\n든 글자') && !UNSAFE.test(text.replace(/\n/g, '')), 'the screen shows what was stored');
    await H.until(() => H.status(page), value => value.note === '쓸 수 없는 문자를 뺐어요' && value.text === '자동 저장됨', 'the change is said in one line');
  },
  // C: the link box takes "naver.com" as https and refuses what is not an http(s) address.
  async 'links'({ open }) {
    const { page } = await open();
    await H.home(page); await H.writer(page);
    await page.locator('.ql-editor').click();
    await page.keyboard.type('여기 링크 naver 그리고 편지 mail 뒤 문장');
    const link = async (word, address) => {
      await H.quill(page, (q, word) => q.setSelection(q.getText().indexOf(word), word.length, 'user'), word);
      await page.locator('.photo-toolbar .ql-link').click();
      const box = page.locator('.ql-tooltip input[type=text]'); await box.waitFor({ state: 'visible' });
      await box.fill(address); await page.keyboard.press('Enter');
      return box;
    };
    await link('naver', 'naver.com');
    await H.until(() => H.contents(page), ops => ops.some(op => op.insert === 'naver' && op.attributes?.link === 'https://naver.com'), 'a scheme-less address becomes https');
    const box = await link('mail', 'mailto:a@example.org');
    assert.equal(await box.getAttribute('aria-invalid'), 'true', 'the box says the address is refused');
    assert(await box.isVisible(), 'the link box stays open for a correction');
    assert.equal((await H.status(page)).text, '링크는 http·https 주소만 넣을 수 있어요');
    assert(!(await H.contents(page)).some(op => /mailto/.test(op.attributes?.link || '')), 'the refused address never reaches the text');
    await box.fill('example.org/path'); await page.keyboard.press('Enter');
    await H.until(() => H.contents(page), ops => ops.some(op => op.insert === 'mail' && op.attributes?.link === 'https://example.org/path'), 'the corrected address is applied');
    // Backstop: an address the editor accepts through its API is stored without the link, and said.
    await H.quill(page, q => q.formatText(q.getText().indexOf('편지'), 2, 'link', 'tel:0101234', 'user'));
    await H.quill(page, q => q.setSelection(q.getLength() - 1, 0, 'user'));
    await page.locator('.ql-editor').click(); await page.keyboard.press('Control+End');
    await page.keyboard.type(' ' + PARAGRAPH);
    const rows = await draftWith(page, PARAGRAPH);
    assert.deepEqual(rows[0].ops.filter(op => op.attributes?.link).map(op => op.attributes.link), ['https://naver.com', 'https://example.org/path'], 'only http(s) links are stored');
    await H.until(() => H.status(page), value => value.note === '주소가 아닌 링크는 풀었어요' && value.text === '자동 저장됨', 'the removed link is said');
    await reloaded(page);
    assert((await H.bodyText(page)).includes(PARAGRAPH));
    await saveSucceeds(page);
  },
  // Same root: input that has no valid form (over 50,000 characters) is never stored invalid, never lost, and every exit still works.
  async 'over-limit'({ open }) {
    const dialogs = [];
    const { page, server } = await open({ page: { dialogs } });
    await H.home(page); await H.writer(page);
    await page.locator('#photoTitle').fill('긴 글');
    await page.locator('.ql-editor').click();
    await page.keyboard.type('처음 쓴 글. ');
    const first = await draftWith(page, '처음 쓴 글.');
    const chunk = '가나다라마바사아자차카타파하 열네 글자와 공백 문장입니다. '.repeat(40) + '\n';
    await H.pasteBody(page, { text: chunk.repeat(Math.ceil(52000 / chunk.length)) });
    await page.keyboard.type('맨 끝에 쓴 꼬리 문장.');
    const length = (await H.bodyText(page)).length;
    assert(length > 50000);
    const said = await H.until(() => H.status(page), value => value.state === 'error' && value.detail.includes('본문은 50,000자까지 쓸 수 있습니다') && value.detail.includes(length.toLocaleString('ko-KR')), 'the limit and the current length are said');
    assert.equal(said.text, '이 기기에만 임시 보관 중', 'where the input is kept is said');
    assert(/계정에 올리지 않고 이 기기에만 임시 보관/.test(said.detail));
    // 글 정보 states the same fact, not that the account will have it soon.
    await page.locator('.photo-privacy').click(); await page.locator('dialog.photo-info[open]').waitFor();
    const info = (await page.locator('dialog.photo-info').innerText()).replace(/\n+/g, ' | ');
    assert(info.includes('이 기기에만 임시 보관 중') && info.includes('한도를 넘어 계정에 올리지 않았습니다'), info);
    assert(!/곧 계정에 비공개로 올립니다|계정에 올림|계정에 다시 올리기/.test(info), info);
    await page.keyboard.press('Escape');
    // A photo cannot be kept on the side while the draft cannot be stored: adding one is refused and says so.
    await page.locator('#photoFiles').setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: await H.jpeg(page) });
    const refused = await H.until(() => H.status(page), value => value.text === '사진을 넣지 못했습니다', 'the photo that was not added is said');
    assert(refused.detail.startsWith('사진을 넣지 못했습니다. 본문은 50,000자까지 쓸 수 있습니다') && refused.state === 'error', refused.detail);
    assert.equal(await page.locator('.photo-block').count(), 0);
    const kept = await H.records(page);
    assert.equal(kept[0].text, first[0].text, 'nothing over the limit is stored (or synced)');
    const copies = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('haedo_life_post_recovery_v1:')).map(([key, value]) => ({ key, value: JSON.parse(value) })));
    assert.equal(copies.length, 1);
    assert(copies[0].key.endsWith(':' + kept[0].id), 'the device copy is keyed by workspace and draft');
    assert(copies[0].value.ops.map(op => op.insert).join('').includes('맨 끝에 쓴 꼬리 문장.'), 'the device copy holds all of the input');
    // Explicit save: refused with what to fix; the input stays.
    await page.getByRole('button', { name: '글 저장', exact: true }).click();
    await H.until(() => H.status(page), value => value.state === 'error' && value.text === '저장하지 못했습니다' && value.detail.startsWith('본문은 50,000자까지 쓸 수 있습니다') && value.detail.endsWith('줄여 주세요.'), 'save names what to fix');
    assert.equal(await H.mode(page), 'edit');
    // Files of the current input do not depend on validation.
    const archive = await H.download(page, () => page.getByRole('button', { name: '현재 입력 백업' }).click());
    const manifest = JSON.parse(zip.strFromU8(zip.unzipSync(new Uint8Array(archive))['manifest.json']));
    assert(manifest.ops.map(op => op.insert).join('').includes('맨 끝에 쓴 꼬리 문장.'), 'ZIP of the current input');
    const html = (await H.download(page, () => H.menu(page, 'HTML 읽기 파일 받기'))).toString('utf8');
    assert(html.includes('맨 끝에 쓴 꼬리 문장.') && html.includes('<h1>긴 글</h1>'), 'HTML reading file of the current input');
    // Closing works: the input waits on this device.
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    assert.equal(await page.locator('#photoTitle').count(), 0, 'the editor closes');
    assert.deepEqual(dialogs.filter(text => text.startsWith('beforeunload')), []);
    // The draft's upload finishes meanwhile; that raises its local revision without changing its content.
    await H.until(async () => [...server.posts.values()].filter(row => row.data.status === 'draft').length, count => count === 1, 'the stored draft is uploaded', 20000);
    await H.sleep(600);
    // Opening the draft again offers the kept input; the editor waits for the choice.
    await page.locator('#homeTab-drafts').click();
    await page.locator('.home-draft[data-draft-id="' + kept[0].id + '"] .home-draft-open').click();
    await page.locator('.photo-recovered').waitFor();
    assert.equal(await H.quill(page, q => q.isEnabled()), false, 'no typing over an undecided copy');
    // The band explains the locked editor: it has the focus, its first choice is described by its sentence, and it comes before the title.
    const band = await page.evaluate(() => {
      const bar = document.querySelector('.photo-recovered'), first = bar.querySelector('button'), text = bar.querySelector('.photo-recovered-text');
      return { focused: document.activeElement === first, name: first.textContent, described: first.getAttribute('aria-describedby') === text.id && !!text.id, labelled: bar.getAttribute('aria-labelledby') === text.id,
        role: text.getAttribute('role'), sentence: text.textContent, beforeTitle: !!(bar.compareDocumentPosition(document.querySelector('#photoTitle')) & Node.DOCUMENT_POSITION_FOLLOWING),
        titleLocked: document.querySelector('#photoTitle').readOnly };
    });
    assert.deepEqual({ ...band, sentence: band.sentence.startsWith('보관하지 못한 입력이 이 기기에 남아 있습니다') }, { focused: true, name: '복구', described: true, labelled: true, role: 'status', sentence: true, beforeTitle: true, titleLocked: true });
    assert(!band.sentence.includes('새 초안'), 'an unchanged draft is continued in place even though its revision number rose: ' + band.sentence);
    assert.equal(await H.bodyText(page), first[0].text);
    await page.getByRole('button', { name: '복구', exact: true }).click();
    await H.until(() => H.bodyText(page), text => text.length === length && text.includes('맨 끝에 쓴 꼬리 문장.'), 'the kept input is back');
    assert.equal(await page.locator('.photo-recovered').count(), 0);
    await H.until(() => H.status(page), value => value.state === 'error' && value.detail.includes('50,000자'), 'still over the limit, still said');
    // Reload in this state: no data is lost and the offer comes back.
    await reloaded(page);
    await page.locator('.photo-recovered').waitFor();
    await page.getByRole('button', { name: '복구', exact: true }).click();
    await H.until(() => H.bodyText(page), text => text.length === length, 'back again after a reload');
    // Shortening makes it storable: the draft is stored and the device copy is removed.
    await page.locator('.ql-editor').click(); await page.keyboard.press('Control+a'); await page.keyboard.type('줄인 본문입니다.');
    await draftWith(page, '줄인 본문입니다.');
    await H.until(() => recoveryKeys(page), keys => keys.length === 0, 'the device copy ends when the draft is stored');
    assert.equal((await H.status(page)).state, 'draft');
    await saveSucceeds(page);
  },
  // The same for a new post that never reached storage, and the 버리기 choice.
  async 'over-limit-new-post'({ open }) {
    const dialogs = [];
    const { page } = await open({ page: { dialogs } });
    await H.home(page); await H.writer(page);
    await page.locator('.ql-editor').click();
    const chunk = '한 번도 보관되지 않은 새 글의 긴 붙여넣기 문장입니다. '.repeat(40) + '\n';
    await H.pasteBody(page, { text: chunk.repeat(Math.ceil(51000 / chunk.length)) });
    await H.until(() => H.status(page), value => value.state === 'error' && value.detail.includes('50,000자'), 'said');
    assert.deepEqual(await H.records(page), [], 'no draft was stored');
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    await H.writer(page);
    await page.locator('.photo-recovered').waitFor();
    await H.until(() => page.evaluate(() => document.activeElement === document.querySelector('.photo-recovered button')), focused => focused, 'the band\'s first choice has the focus when 글쓰기 opens on a kept copy');
    assert((await page.locator('.photo-recovered-text').textContent()).includes('보관된 적 없는 새 글의 입력입니다'));
    assert.equal(await H.quill(page, q => q.isEnabled()), true, 'no draft is open for this copy to overwrite: the editor is not locked');
    await page.getByRole('button', { name: '새 초안으로 복구', exact: true }).click();
    await H.until(() => H.bodyText(page), text => text.length > 50000, 'the new post\'s input is offered when writing again');
    assert.deepEqual(await H.records(page), [], 'the empty new post was reused: no extra draft');
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    await H.writer(page);
    await page.locator('.photo-recovered').waitFor();
    await page.getByRole('button', { name: '버리기', exact: true }).click();
    await H.until(() => recoveryKeys(page), keys => keys.length === 0, 'discarded after confirmation');
    assert(dialogs.some(text => text.startsWith('confirm:이 기기에 남아 있는 입력을 버릴까요?')), 'discarding asks first');
    assert.equal(await H.quill(page, q => q.isEnabled()), true);
    assert.equal(await H.bodyText(page), '\n');
  },
  // Normalization never touches the document while an IME composition is open.
  async 'ime-composition'({ open }) {
    const { page, context } = await open();
    await H.home(page); await H.writer(page);
    await page.locator('.ql-editor').click();
    await page.keyboard.type('목록 줄'); await page.keyboard.press('Enter');
    await H.quill(page, q => q.formatLine(0, 1, 'list', 'checked', 'user'));
    await H.quill(page, q => q.setSelection(q.getLength() - 1, 0, 'silent'));
    const cdp = await context.newCDPSession(page);
    for (const text of ['ㅎ', '하', '한']) { await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length }); await H.sleep(40); }
    // Autosave runs under the open composition (300 ms idle, 2 s deadline) and stores the normalized document.
    await H.stored(page, rows => rows[0]?.ops.some(op => op.attributes?.list === 'bullet'), 'stored normalized while composing');
    await H.sleep(400);
    const during = await page.evaluate(() => { const q = Quill.find(document.querySelector('.ql-container')); return { composing: q.composition.isComposing, lists: q.getContents().ops.filter(op => op.attributes?.list).map(op => op.attributes.list), dom: document.querySelector('.ql-editor').innerText }; });
    assert.equal(during.composing, true, 'the composition is still open');
    assert.deepEqual(during.lists, ['checked'], 'the document is not rewritten under the composition');
    assert(during.dom.includes('한'), 'the composing syllable is on screen');
    await cdp.send('Input.insertText', { text: '한' });
    await page.keyboard.type('글');
    const rows = await draftWith(page, '한글');
    assert.equal(rows[0].text.split('한글').length, 2, 'the composed text is stored once');
    await H.until(() => H.contents(page), ops => ops.some(op => op.attributes?.list === 'bullet') && !ops.some(op => op.attributes?.list === 'checked'), 'aligned after the composition ended');
    assert((await H.bodyText(page)).endsWith('한글\n'), 'the caret and the composed text are intact');
  },
  // Contract: everything this Quill configuration can produce is storable after normalization. A newly enabled format fails here first.
  async 'editor-contract'({ open }) {
    const { page } = await open();
    await H.home(page); await H.writer(page);
    const registry = await H.quill(page, q => Object.keys(q.scroll.registry.types));
    const core = ['block', 'break', 'cursor', 'inline', 'scroll', 'text', 'list-container'];
    assert.deepEqual(registry.filter(name => !core.includes(name)).sort(), ['align', 'author', 'blockquote', 'bold', 'header', 'italic', 'link', 'list', 'photo', 'underline'],
      'the editor\'s formats changed: decide how each new one is stored (PhotoPost.normalize/validate) and extend this contract');
    await page.locator('#photoFiles').setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: await H.jpeg(page) });
    await page.locator('.photo-block img').waitFor();
    // 1. Every registered format with every value the editor accepts, alone and combined, through the editor's own API.
    const produced = await page.evaluate(() => {
      const q = Quill.find(document.querySelector('.ql-container')), P = HaedoLife.PhotoPost;
      const photos = [...document.querySelectorAll('.photo-block')].map(node => ({ id: node.dataset.photoId }));
      const values = {
        bold: [true], italic: [true], underline: [true], blockquote: [true], author: ['ai'],
        header: [1, 2, 3, 4, 5, 6], list: ['ordered', 'bullet', 'checked', 'unchecked'], align: ['center', 'right', 'justify'],
        link: ['https://example.org/a', 'http://example.org', 'example.org', 'mailto:a@example.org', 'tel:010', 'sms:010', '/relative', 'javascript:alert(1)'],
      };
      const inline = ['bold', 'italic', 'underline', 'author', 'link'], block = ['header', 'blockquote', 'list', 'align'];
      const base = q.getContents(), results = [];
      const judge = label => {
        const ops = q.getContents().ops, shown = JSON.stringify(ops);
        const normal = P.normalize({ ...P.create(() => 'contract'), photos, ops });
        // validate() also checks photo records; this contract is about the body, so the photo is described by id only.
        let error = null;
        try { P.validate({ ...normal.doc, photos: [], ops: normal.doc.ops.filter(op => typeof op.insert === 'string') }); if (normal.doc.ops.filter(op => typeof op.insert !== 'string').some(op => Object.keys(op.insert.photo).sort().join() !== 'alt,caption,id')) throw new Error('photo embed shape'); }
        catch (cause) { error = cause.message; }
        results.push({ label, shown, stored: JSON.stringify(normal.doc.ops), error, changes: normal.changes });
        q.setContents(base, 'silent');
      };
      const type = () => { q.insertText(0, '가나다 라마바\n둘째 줄\n', 'user'); };
      for (const [name, list] of Object.entries(values)) for (const value of list) {
        type();
        if (inline.includes(name)) q.formatText(1, 4, name, value, 'user'); else q.formatLine(0, 9, name, value, 'user');
        judge(name + '=' + JSON.stringify(value));
      }
      // Pairs: each block format value with each other block format and each inline format on top.
      for (const a of block) for (const av of values[a]) for (const b of [...block, ...inline]) {
        if (a === b) continue;
        for (const bv of values[b]) {
          type();
          q.formatLine(0, 9, a, av, 'user');
          if (inline.includes(b)) q.formatText(0, 6, b, bv, 'user'); else q.formatLine(8, 1, b, bv, 'user');
          judge(a + '=' + JSON.stringify(av) + ' + ' + b + '=' + JSON.stringify(bv));
        }
      }
      // All inline formats at once, over a list line and next to the photo.
      type();
      for (const name of inline) q.formatText(0, 12, name, name === 'link' ? 'example.org' : values[name][0], 'user');
      q.formatLine(0, 1, 'list', 'checked', 'user');
      judge('all inline formats');
      // Formats that are not registered are ignored by the editor (nothing to store).
      type();
      for (const [name, value] of [['strike', true], ['code', true], ['code-block', true], ['indent', 2], ['color', 'red'], ['background', '#ff0'], ['size', 'large'], ['font', 'serif'], ['script', 'sub'], ['direction', 'rtl'], ['table', 'row-1']]) { q.formatText(0, 3, name, value, 'user'); q.formatLine(0, 1, name, value, 'user'); }
      judge('unregistered formats');
      return results;
    });
    assert(produced.length > 150, 'the contract exercised the format combinations: ' + produced.length);
    assert.deepEqual(produced.filter(item => item.error).map(item => ({ label: item.label, error: item.error, shown: item.shown })), [], 'every producible body is storable after normalization');
    const formats = new Set(produced.flatMap(item => JSON.parse(item.shown).flatMap(op => Object.entries(op.attributes || {}).map(([key, value]) => key + '=' + JSON.stringify(value)))));
    for (const expected of ['list="checked"', 'list="unchecked"', 'header=6', 'link="mailto:a@example.org"', 'author="ai"', 'align="justify"']) assert(formats.has(expected), 'the editor produced ' + expected);
    assert(![...formats].some(item => /^(strike|code|indent|color|background|size|font|script|direction|table)/.test(item)), 'unregistered formats never reach the document');
    // What is supported is stored unchanged; only the unsupported is mapped.
    // (An address without a scheme is completed to https, which is not reported as a change.)
    const completed = produced.filter(item => item.shown.includes('"link":"example.org"'));
    assert(completed.length > 0 && completed.every(item => item.stored.includes('"link":"https://example.org"') && !item.stored.includes('"link":"example.org"')), 'scheme-less links are stored as https');
    const supported = produced.filter(item => !item.changes.length && !completed.includes(item));
    const canonical = text => JSON.stringify(JSON.parse(text), (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
    assert(supported.length > 20, 'supported combinations: ' + supported.length);
    assert.deepEqual(supported.filter(item => canonical(item.shown) !== canonical(item.stored)).map(item => [item.label, item.shown, item.stored]), [], 'supported formats are stored exactly as shown');
    // 2. The keyboard, the toolbar and paste, as a writer reaches them.
    await page.locator('.ql-editor').click(); await page.keyboard.press('Control+a'); await page.keyboard.press('Delete');
    for (const [prefix, word] of [['[ ] ', '가'], ['[x] ', '나'], ['[] ', '다'], ['- ', '라'], ['* ', '마'], ['1. ', '바']]) { await page.keyboard.type(prefix + word); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); }
    for (const key of ['b', 'i', 'u']) { await page.keyboard.press('Control+' + key); await page.keyboard.type('서식'); await page.keyboard.press('Control+' + key); }
    await page.keyboard.press('Enter');
    await page.keyboard.type('도구 줄'); await page.keyboard.press('Shift+Home');
    for (const control of ['.ql-bold', '.ql-italic', '.ql-underline', '.ql-blockquote', '.ql-list[value="bullet"]', '.ql-list[value="ordered"]', '.ql-align[value="center"]']) await page.locator('.photo-toolbar ' + control).evaluate(node => node.click());
    for (const value of ['1', '2', '']) await page.locator('.photo-toolbar select.ql-header').evaluate((node, value) => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); }, value);
    await page.keyboard.press('Control+End'); await page.keyboard.press('Enter');
    await H.pasteBody(page, { text: '붙여넣기\u000b둘째\ttab\r\n셋째\u0000' });
    const typed = await page.evaluate(() => { const q = Quill.find(document.querySelector('.ql-container')), P = HaedoLife.PhotoPost, ops = q.getContents().ops; const normal = P.normalize({ ...P.create(() => 'typed'), ops }); let error = null; try { P.validate(normal.doc); } catch (cause) { error = cause.message; } return { ops, error, changes: normal.changes }; });
    assert.equal(typed.error, null, 'what the keyboard, toolbar and paste produce is storable');
    assert.deepEqual(typed.changes, [], 'and needs no correction: ' + JSON.stringify(typed.ops));
    await H.stored(page, rows => rows[0]?.text.includes('붙여넣기\n둘째\ttab\n셋째'), 'and it is stored');
    assert.notEqual((await H.status(page)).state, 'error');
  },
  // A long error from storage does not become a five-line column in the phone's one-line status slot.
  async 'long-error-on-a-phone'({ open }) {
    const { page } = await open({ viewport: { width: 390, height: 844 }, options: { hasTouch: true, isMobile: true } });
    await H.home(page); await H.writer(page);
    await page.locator('.ql-editor').click(); await page.keyboard.type('처음 문장.');
    await draftWith(page, '처음 문장.');
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, ...rest) { if (this.name === 'meta' && String(value?.key).startsWith('photo-post:')) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return put.call(this, value, ...rest); };
    });
    await page.keyboard.type(' 보관되지 못할 문장.');
    const said = await H.until(() => H.status(page), value => value.state === 'error' && (value.text || '').length > 24, 'the storage error is shown in its own words');
    const box = await page.evaluate(() => {
      const line = document.querySelector('.photo-commandbar .photo-status').getBoundingClientRect(), bar = document.querySelector('.photo-commandbar').getBoundingClientRect(), save = document.querySelector('.photo-save').getBoundingClientRect();
      return { width: Math.round(line.width), height: Math.round(line.height), bar: Math.round(bar.width), below: line.top >= save.bottom - 1, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    assert(box.width > box.bar * 0.9 && box.height <= 48 && box.below && !box.overflow, 'a full-width line under the command row: ' + JSON.stringify(box) + ' ' + said.text);
    // The recovery actions are still there, and the input is intact.
    assert(await page.getByRole('button', { name: '다시 보관', exact: true }).isVisible());
    assert((await H.bodyText(page)).includes('보관되지 못할 문장.'));
  },
  // The sticky tools grow by an error line while the writer is in the body with the page scrolled. The page stays
  // where it was (the browser's scroll anchoring would scroll it and slide the title behind the tools), and the
  // offset that keeps the caret below the tools follows their real height.
  async 'tools-growing-keep-the-page-in-place'({ open }) {
    const { page } = await open({ viewport: { width: 390, height: 844 }, options: { hasTouch: true, isMobile: true } });
    await H.home(page); await H.writer(page);
    await page.locator('#photoTitle').fill('상한에 걸린 글의 제목');
    await page.locator('.ql-editor').click();
    await H.pasteBody(page, { text: Array.from({ length: 40 }, (_, i) => (i + 1) + '번째 문단입니다. 본문을 길게 채우는 문장.').join('\n') });
    await H.stored(page, rows => rows.length === 1 && rows[0].text.includes('40번째'), 'stored');
    const measure = () => page.evaluate(() => {
      const title = document.querySelector('#photoTitle').getBoundingClientRect(), tools = document.querySelector('.photo-editor-tools').getBoundingClientRect();
      const first = [...document.querySelectorAll('.ql-editor > *')].find(node => node.getBoundingClientRect().bottom > tools.bottom);
      return { scrollY: Math.round(scrollY), tools: Math.round(tools.height), titleHidden: Math.max(0, Math.round(Math.min(title.bottom, tools.bottom) - Math.max(title.top, tools.top))),
        firstLine: first.textContent, firstBelowTools: Math.round(first.getBoundingClientRect().top - tools.bottom),
        offset: getComputedStyle(document.documentElement).scrollPaddingTop, variable: document.documentElement.style.getPropertyValue('--photo-tools-height') };
    });
    // Scrolled a little (the title is partly under the tools, as any scrolled content is) with the caret in a visible line.
    await page.evaluate(() => {
      scrollTo({ top: 30, behavior: 'instant' });
      const q = Quill.find(document.querySelector('.ql-container')), tools = document.querySelector('.photo-editor-tools').getBoundingClientRect().bottom;
      const line = [...document.querySelectorAll('.ql-editor > *')].find(node => node.getBoundingClientRect().top > tools + 160);
      q.setSelection(q.getIndex(Quill.find(line)) + 3, 0, 'silent');
    });
    const before = await measure();
    assert.equal(before.scrollY, 30);
    assert.equal(before.variable, before.tools + 'px', 'the tools\' height is published for the scroll offsets');
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, ...rest) { if (this.name === 'meta' && String(value?.key).startsWith('photo-post:')) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return put.call(this, value, ...rest); };
    });
    await page.keyboard.type('가');
    await H.until(() => H.status(page), value => value.state === 'error', 'the long error line appears');
    const after = await H.until(measure, value => value.tools > before.tools + 40 && value.variable === value.tools + 'px', 'the tools grew and their height was published again');
    assert.equal(after.scrollY, before.scrollY, 'the page is not scrolled by the tools growing: ' + JSON.stringify({ before, after }));
    assert.equal(after.titleHidden, before.titleHidden, 'no more of the title goes behind the tools');
    assert.equal(after.firstLine, before.firstLine, 'the same line is first under the tools');
    assert.equal(after.firstBelowTools, before.firstBelowTools);
    assert.equal(parseFloat(after.offset), Math.max(72, after.tools + 12), 'the caret offset follows the tools\' real height: ' + after.offset);
    assert((await H.bodyText(page)).includes('가'), 'the input is intact');
  },
  // 3rd review MINOR-A: while the store keeps refusing, every autosave attempt used to take the error line away
  // ("자동 저장 중…") and bring it back, so the line being typed jumped by its height (56px at 1440, 100px at 390,
  // also while composing). The refusal stays said until a store succeeds: the caret holds its place on screen.
  async 'a-lasting-store-error-holds-the-caret-in-place'({ open }) {
    for (const [width, height, options] of [[1440, 1000, {}], [390, 844, { hasTouch: true, isMobile: true }]]) {
      const { page, context } = await open({ viewport: { width, height }, options });
      await H.home(page); await H.writer(page);
      await page.locator('#photoTitle').fill('계속 저장을 거부당하는 글');
      await page.locator('.ql-editor').click();
      await H.pasteBody(page, { text: Array.from({ length: 40 }, (_, i) => '문단 ' + i + ' 가나다라마바사아자차카타파하.').join('\n') });
      await H.stored(page, rows => rows.length === 1 && rows[0].text.includes('문단 39'), 'stored');
      // A line in the upper part of the view, the title partly scrolled away (as in the review's measure), and
      // far enough below the tools that keeping the caret clear of the grown tools does not scroll.
      await page.evaluate(() => {
        scrollTo({ top: 120, behavior: 'instant' });
        const q = Quill.find(document.querySelector('.ql-container')), tools = document.querySelector('.photo-editor-tools').getBoundingClientRect().bottom;
        const line = [...document.querySelectorAll('.ql-editor > *')].find(node => node.getBoundingClientRect().top > tools + 160);
        q.setSelection(q.getIndex(Quill.find(line)) + Quill.find(line).length() - 1, 0, 'silent');
      });
      await page.evaluate(() => {
        window.__refused = 0;
        const put = window.__put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, ...rest) { if (this.name === 'meta' && String(value?.key).startsWith('photo-post:')) { window.__refused++; throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); } return put.call(this, value, ...rest); };
      });
      const caret = () => page.evaluate(() => {
        const range = getSelection().getRangeAt(0), rect = range.getBoundingClientRect();
        const node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
        const tools = document.querySelector('.photo-editor-tools').getBoundingClientRect();
        // The line being typed in (its block: a wrap inside it is not a move) and the caret itself.
        return { line: Math.round(node.closest('.ql-editor > *').getBoundingClientRect().top), top: Math.round(rect.height ? rect.top : node.getBoundingClientRect().top), tools: Math.round(tools.height), scrollY: Math.round(scrollY),
          state: document.querySelector('.photo-status')?.dataset.state, text: document.querySelector('.photo-status-text')?.textContent };
      });
      await page.keyboard.type('가');
      await H.until(() => H.status(page), value => value.state === 'error', width + ': the store refuses');
      await H.sleep(300);
      const first = await caret(), refusedBefore = await page.evaluate(() => window.__refused), seen = [first];
      // Four more attempts, each measured right after the key (the attempt is pending) and after it failed again.
      for (const key of ['나', '다', '라', '마']) {
        await page.keyboard.type(key);
        seen.push({ ...(await caret()), at: key + ' typed' });
        await H.sleep(600);
        seen.push({ ...(await caret()), at: key + ' refused' });
      }
      // A composition, and its commit, while the store still refuses.
      const cdp = await context.newCDPSession(page);
      for (const text of ['ㅎ', '하', '한', '한ㄱ', '한그', '한글']) { await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length }); await H.sleep(40); }
      seen.push({ ...(await caret()), at: 'composing' });
      await H.sleep(1200);
      seen.push({ ...(await caret()), at: 'still composing' });
      await cdp.send('Input.insertText', { text: '한글' });
      seen.push({ ...(await caret()), at: 'committed' });
      await H.sleep(900);
      seen.push({ ...(await caret()), at: 'committed and refused' });
      // The caret moved only along its line (a wrap at most): not by the error line's height.
      const tops = seen.map(item => item.top);
      assert(Math.max(...tops) - Math.min(...tops) < 40, 'the caret holds its place on screen: ' + width + ': ' + JSON.stringify(seen));
      const report = width + ': ' + JSON.stringify(seen);
      assert(await page.evaluate(() => window.__refused) >= refusedBefore + 5, 'every input was another store attempt: ' + report);
      const lines = seen.map(item => item.line);
      assert(Math.max(...lines) - Math.min(...lines) <= 2, 'the line being typed holds its place on screen: ' + report);
      assert(seen.every(item => item.tools === first.tools && item.scrollY === first.scrollY), 'the tools keep their height and the page its scroll: ' + report);
      assert(seen.every(item => item.state === 'error' && item.text === first.text), 'the refusal stays said: ' + report);
      assert((await H.bodyText(page)).includes('가나다라마한글'), 'the input is intact');
      // The store accepts again: the next attempt stores it and the error goes.
      await page.evaluate(() => { IDBObjectStore.prototype.put = window.__put; });
      await page.keyboard.type('.');
      await H.until(() => H.status(page), value => value.text === '자동 저장됨', width + ': stored once the store accepts');
      await H.stored(page, rows => rows[0].text.includes('가나다라마한글.'), 'all of it is stored');
      await context.close();
    }
  },
});

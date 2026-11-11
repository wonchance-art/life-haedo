/* Smaller writing defects found by the 2026-11-11 review (m3–m8): the photo
 * limit, partial photo failures, text+image clipboards, a draft's account
 * state, input after the last autosave, a read view that follows changes, and
 * addresses kept from before an edit. Real app, synthetic account and server,
 * real IndexedDB/localStorage in Chromium; two devices are two browser
 * contexts sharing one synthetic server, not live sync. */
'use strict';
const H = require('./helpers/writing-input.cjs'), { assert } = H;
const { session: accountSession } = require('./life-sync-browser.cjs');
const { ready, settle } = require('./unified-home-browser.cjs');
const draftWith = (page, text) => H.stored(page, rows => rows.some(row => row.status === 'draft' && row.text.includes(text)), 'draft holding ' + JSON.stringify(text.slice(0, 20)));
const blocks = page => page.locator('.photo-block').count();
const blockIds = page => page.evaluate(() => [...document.querySelectorAll('.photo-block')].map(node => node.dataset.photoId));
const recoveryCopies = page => page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('haedo_life_post_recovery_v1:')).map(([key, value]) => ({ key, value: JSON.parse(value) })));
async function savedPost(page, title, body) {
  await H.writer(page);
  await page.locator('#photoTitle').fill(title);
  await page.locator('.ql-editor').click(); await page.keyboard.type(body);
  await page.getByRole('button', { name: '글 저장', exact: true }).click();
  await page.locator('.photo-article').waitFor();
  return (await H.stored(page, list => list.length === 1 && list[0].status === 'saved', 'the post is saved'))[0];
}
const info = async page => {
  await page.locator('.photo-privacy').click(); await page.locator('dialog.photo-info[open]').waitFor();
  const text = (await page.locator('dialog.photo-info').innerText()).replace(/\n+/g, ' | ');
  return text;
};
const focusWindow = page => page.evaluate(() => dispatchEvent(new Event('focus')));

H.run(__filename, {
  // m3: the 20-photo limit counts the photos the body uses, not ones already taken out.
  async 'photo-limit-counts-used-photos'({ open }) {
    const { page } = await open();
    await H.home(page); await H.writer(page);
    const files = [];
    for (let i = 0; i < 20; i++) files.push({ name: 'p' + i + '.jpg', mimeType: 'image/jpeg', buffer: await H.jpeg(page, 64 + i, 48, '#' + (0x335577 + i * 0x050301).toString(16)) });
    await page.locator('#photoFiles').setInputFiles(files);
    await H.until(() => blocks(page), count => count === 20, '20 photos in the body', 60000);
    await H.stored(page, rows => rows[0]?.photos === 20, '20 photos stored');
    const extra = { name: 'extra.jpg', mimeType: 'image/jpeg', buffer: await H.jpeg(page, 90, 60, '#aa3344') };
    await page.locator('#photoFiles').setInputFiles(extra);
    await H.until(() => H.status(page), value => value.state === 'error' && value.text.includes('사진은 20장까지'), 'the 21st photo is refused');
    assert.equal(await blocks(page), 20);
    // Take one out, then add another: 20 used photos again.
    const first = (await blockIds(page))[0];
    await page.locator('.photo-block .photo-select').first().click();
    await page.locator('.photo-inspector').waitFor({ state: 'visible' });
    await page.locator('.photo-settings > summary').click();
    await page.getByRole('button', { name: '사진 빼기', exact: true }).click();
    await H.until(() => blocks(page), count => count === 19, 'one photo taken out');
    await page.locator('#photoFiles').setInputFiles(extra);
    await H.until(() => blocks(page), count => count === 20, 'a photo fits again after one was taken out');
    assert.notEqual((await H.status(page)).state, 'error');
    const rows = await H.stored(page, list => list[0]?.photos === 20 && !list[0].ops.some(op => op.insert?.photo?.id === first), 'stored with the 20 used photos only');
    assert.equal(rows[0].ops.filter(op => op.insert?.photo).length, 20);
    // The photo taken out is still there for undo.
    await page.getByRole('button', { name: '실행 취소', exact: true }).click();
    await H.until(() => blocks(page), count => count === 19, 'undo the addition');
    await page.getByRole('button', { name: '실행 취소', exact: true }).click();
    await H.until(() => blockIds(page), ids => ids.length === 20 && ids[0] === first, 'undo brings the removed photo back');
    assert(await page.locator('.photo-block img').first().evaluate(image => image.complete && image.naturalWidth > 0), 'with its picture');
    await H.stored(page, list => list[0]?.photos === 20 && list[0].ops.some(op => op.insert?.photo?.id === first), 'and it is stored again');
    await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor();
  },
  // m5: one unusable file no longer refuses the photos that are fine.
  async 'photos-partial-failure'({ open }) {
    const { page } = await open();
    await H.home(page); await H.writer(page);
    const good = async (name, color) => ({ name, mimeType: 'image/jpeg', buffer: await H.jpeg(page, 120, 90, color) });
    await page.locator('#photoFiles').setInputFiles([await good('첫째.jpg', '#446688'), { name: '메모.txt', mimeType: 'text/plain', buffer: Buffer.from('사진이 아님') },
      await good('둘째.jpg', '#884466'), { name: '가짜.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('JPEG가 아닌 내용') }]);
    await H.until(() => blocks(page), count => count === 2, 'the two usable photos are inserted');
    const said = await H.until(() => H.status(page), value => value.state === 'error', 'the failure is said');
    assert.equal(said.text, '사진 2장을 넣지 못했습니다');
    assert(said.detail.includes('메모.txt') && said.detail.includes('가짜.jpg') && said.detail.startsWith('사진 4장 중 2장'), 'the files that failed are named: ' + said.detail);
    assert(!said.detail.includes('첫째.jpg') && !said.detail.includes('둘째.jpg'));
    const rows = await H.stored(page, list => list[0]?.photos === 2, 'the usable photos are stored');
    assert.deepEqual(await page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(), d = await s.readPhotoPost(w, (await s.listPhotoPosts(w))[0].id); return d.ops.filter(op => op.insert?.photo).map(op => d.photos.find(p => p.id === op.insert.photo.id).name); }), ['첫째.jpg', '둘째.jpg'], 'in the order chosen');
    assert.equal(rows.length, 1);
    // A single unusable file says why, as before.
    await page.locator('#photoFiles').setInputFiles({ name: '메모.txt', mimeType: 'text/plain', buffer: Buffer.from('사진이 아님') });
    await H.until(() => H.status(page), value => value.state === 'error' && value.text.startsWith('JPEG·PNG·WebP·HEIC 사진을 골라 주세요'), 'single failure keeps its reason');
    assert.equal(await blocks(page), 2);
  },
  // m6: a clipboard with text, its rich form and a picture of it (Word, slides) pastes the text;
  // a file copied in a file manager, whose only text is its name, is still the photo.
  async 'paste-text-with-image'({ open }) {
    const { page } = await open();
    await H.home(page); await H.writer(page);
    await page.locator('.ql-editor').click();
    await H.pasteBody(page, { text: '워드에서 복사한 문단입니다.', html: '<p>워드에서 복사한 <b>문단</b>입니다.</p>', image: true });
    await H.until(() => H.bodyText(page), text => text === '워드에서 복사한 문단입니다.\n', 'the text is pasted');
    assert.equal(await blocks(page), 0, 'not its picture');
    await draftWith(page, '워드에서 복사한 문단입니다.');
    // A file and its name (what a file manager puts on the clipboard): the photo, not the name.
    await H.pasteBody(page, { text: 'IMG_1234.png', image: 'IMG_1234.png' });
    await H.until(() => blocks(page), count => count === 1, 'a copied file is a photo');
    assert(!(await H.bodyText(page)).includes('IMG_1234'), 'its name is not pasted as text: ' + JSON.stringify(await H.bodyText(page)));
    await H.stored(page, rows => rows[0]?.photos === 1, 'stored');
    // A picture alone (a screen capture) is a photo; so is one beside rich markup without text (an image copied on a web page).
    await H.pasteBody(page, { text: ' \n', html: '<img src="https://example.org/a.png">', image: true });
    await H.until(() => blocks(page), count => count === 2, 'a picture with no text is a photo');
    await H.stored(page, rows => rows[0]?.photos === 2, 'stored');
    // Text alone is text, as always.
    await page.locator('.ql-editor').click(); await page.keyboard.press('Control+End');
    await H.pasteBody(page, { text: '글자만 있는 붙여넣기.' });
    await draftWith(page, '글자만 있는 붙여넣기.');
  },
  // m7: a draft says whether it reached the account, in the same words as a saved post.
  async 'draft-account-state'({ open }) {
    const net = { down: false };
    const { page, context, server } = await open({ page: { offline: () => true } });
    await context.route(H.cloud + '/**', route => net.down ? route.abort('internetdisconnected') : route.fallback());
    await H.home(page);
    // The connection drops after sign-in, before anything is written.
    net.down = true;
    await H.writer(page);
    await page.locator('#photoTitle').fill('연결 없이 쓰는 초안');
    await page.locator('.ql-editor').click(); await page.keyboard.type('연결 없이 쓴 문장.');
    await draftWith(page, '연결 없이 쓴 문장.');
    assert.equal((await H.status(page)).text, '자동 저장됨', 'this device stored it');
    await H.until(() => page.locator('.photo-privacy').getAttribute('data-state'), state => state === 'problem', 'the top line shows the upload problem', 20000);
    assert((await page.locator('.photo-privacy').innerText()).includes('올리기 실패'));
    const offline = await info(page);
    assert(offline.includes('자동 저장됨 · 계정에 올리지 못함'), offline);
    assert(!/계정에 비공개로 자동 보관되어/.test(offline), 'no claim that the account has it: ' + offline);
    assert.equal(server.posts.size, 0);
    // Connection back: the retry beside the state uploads it and the state follows.
    net.down = false;
    await page.locator('dialog.photo-info').getByRole('button', { name: '계정에 다시 올리기', exact: true }).click();
    await H.until(() => page.locator('dialog.photo-info').innerText(), text => text.includes('자동 저장됨 · 계정에 올림'), 'uploaded after the retry', 20000);
    assert.equal([...server.posts.values()].filter(row => row.data.status === 'draft').length, 1);
    await page.keyboard.press('Escape');
    await H.until(() => page.locator('.photo-privacy').getAttribute('data-state'), state => state !== 'problem', 'the problem mark is gone');
    // A later change is "waiting" until it is uploaded, then "uploaded" again without a reload.
    await page.locator('.ql-editor').click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' 이어 쓴 문장.');
    await draftWith(page, '이어 쓴 문장.');
    const waiting = await info(page);
    assert(waiting.includes('자동 저장됨 · 계정에 올리기 대기'), waiting);
    // The first seconds of waiting are the normal upload delay: no retry is offered yet.
    assert(!waiting.includes('계정에 다시 올리기'), 'no retry while the upload is simply due: ' + waiting);
    await H.until(() => page.locator('dialog.photo-info').innerText(), text => text.includes('자동 저장됨 · 계정에 올림'), 'the open sheet follows the upload', 20000);
  },
  // m8: input typed after the last autosave survives the page closing, and belongs to its account.
  async 'pagehide-recovery'({ open }) {
    const dialogs = [];
    const { page, context } = await open({ page: { dialogs } });
    // The page dies before the store commits: draft writes abort while armed (per page load).
    await context.addInitScript(() => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, ...rest) { const result = original.call(this, value, ...rest); if (window.__dying && this.name === 'meta' && value?.key?.startsWith('photo-post:')) this.transaction.abort(); return result; };
    });
    await H.home(page); await H.writer(page);
    await page.locator('#photoTitle').fill('닫히기 직전의 글');
    await page.locator('.ql-editor').click(); await page.keyboard.type('보관된 앞부분.');
    const before = await draftWith(page, '보관된 앞부분.');
    await H.until(() => recoveryCopies(page), copies => copies.length === 0, 'nothing is kept on the side while autosave works');
    await page.evaluate(() => { window.__dying = true; });
    await page.keyboard.type(' 마지막 자동 저장 뒤에 친 열일곱 자쯤.');
    await page.reload();
    await page.locator('#photoTitle').waitFor(); await page.locator('.photo-recovered').waitFor();
    assert.equal((await H.records(page))[0].text, before[0].text, 'the store never received the last input');
    assert.equal(await H.bodyText(page), '보관된 앞부분.\n', 'the stored draft is shown first');
    assert((await page.locator('.photo-recovered').innerText()).includes('보관하지 못한 입력이 이 기기에 남아 있습니다'));
    await page.getByRole('button', { name: '복구', exact: true }).click();
    await H.until(() => H.bodyText(page), text => text === '보관된 앞부분. 마지막 자동 저장 뒤에 친 열일곱 자쯤.\n', 'the last input is back');
    await draftWith(page, '마지막 자동 저장 뒤에 친 열일곱 자쯤.');
    await H.until(() => recoveryCopies(page), copies => copies.length === 0, 'the device copy ends once the draft holds it');
    // A syllable still being composed when the page is hidden is in the copy too.
    await page.evaluate(() => { window.__dying = true; });
    await page.locator('.ql-editor').click(); await page.keyboard.press('Control+End');
    const cdp = await context.newCDPSession(page);
    for (const text of ['ㄲ', '끄', '끝']) { await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length }); await H.sleep(40); }
    // The tab is hidden (app switch on a phone): reported by the page itself here, as the autosave check does.
    await page.evaluate(() => {
      for (const [name, value] of [['visibilityState', 'hidden'], ['hidden', true]]) Object.defineProperty(document, name, { get: () => value, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const composing = await recoveryCopies(page);
    assert.equal(composing.length, 1);
    assert(composing[0].value.ops.map(op => typeof op.insert === 'string' ? op.insert : '').join('').includes('열일곱 자쯤.끝'), 'the composing text is kept: ' + JSON.stringify(composing[0].value.ops));
    assert.equal(await page.evaluate(() => Quill.find(document.querySelector('.ql-container')).composition.isComposing), true, 'the composition itself is not ended or altered');
    await page.evaluate(() => { delete document.visibilityState; delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await cdp.send('Input.insertText', { text: '끝' });
    // Another account in the same browser never sees it.
    const key = composing[0].key, draftId = before[0].id;
    await page.evaluate(() => { window.__dying = false; });
    await page.evaluate(async value => { await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, accountSession(H.accounts.b));
    await page.waitForFunction(id => HaedoLife.Shell.storage?.account?.userId === id, H.accounts.b.id);
    await ready(page); await settle(page);
    assert(!key.includes(H.accounts.b.id) && key.includes(H.accounts.a.id), 'the copy is keyed by its account: ' + key);
    assert.equal(await page.evaluate(({ a, draftId }) => { const api = HaedoLife.PhotoPost.recovery(localStorage, HaedoLife.Shell.storage.account.userId); const mine = Object.keys(localStorage).filter(key => key.startsWith('haedo_life_post_recovery_v1:')).map(key => key.split(':')); return mine.filter(parts => api.read(parts[2], parts[3])).length; }, { a: H.accounts.a.id, draftId }), 0, 'reading as the other account finds nothing');
    await page.goto(H.base + '/index.html'); await ready(page); await settle(page); await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    await H.writer(page);
    assert.equal(await page.locator('.photo-recovered').count(), 0, 'no offer for another account\'s input');
    assert.equal(await H.bodyText(page), '\n');
  },
  // m4: the read view follows a change made in another tab (the saved revision takes a new id there).
  async 'read-view-follows-another-tab'({ open, problems, name }) {
    const { page: a, context } = await open();
    // What this device has recorded about replaced posts at the moment a saved post is written.
    await context.addInitScript(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, ...rest) {
        if (this.name === 'meta' && String(value?.key).startsWith('photo-post:') && value.value?.status === 'saved')
          (window.__movedAtSave ||= []).push(Object.keys(localStorage).filter(key => key.startsWith('haedo_life_post_moved_v1:')).map(key => localStorage.getItem(key)).join('|'));
        return put.call(this, value, ...rest);
      };
    });
    await H.home(a);
    // A post long enough to be read part of the way down.
    await H.writer(a);
    await a.locator('#photoTitle').fill('두 탭에서 연 글');
    await a.locator('.ql-editor').click();
    await H.pasteBody(a, { text: Array.from({ length: 80 }, (_, i) => (i + 1) + '번째 문단입니다. 읽던 자리를 확인하는 문장.').join('\n') + '\n원래 본문.' });
    await a.getByRole('button', { name: '글 저장', exact: true }).click(); await a.locator('.photo-article').waitFor();
    const post = (await H.stored(a, list => list.length === 1 && list[0].status === 'saved', 'the post is saved'))[0];
    // The reader is part of the way down, with the focus on a control of the view.
    const place = await a.evaluate(() => {
      scrollTo({ top: 1800, behavior: 'instant' });
      document.querySelector('.photo-read-return button').focus({ preventScroll: true });
      const first = [...document.querySelectorAll('.photo-article > *')].find(node => node.getBoundingClientRect().bottom > 0);
      return { scrollY, first: first.textContent, top: Math.round(first.getBoundingClientRect().top) };
    });
    assert(place.scrollY > 1000, 'the view is scrolled: ' + JSON.stringify(place));
    const b = await H.newPage(context, problems, name);
    await b.goto(H.base + '/index.html?view=page&blog=photo.' + post.id); await b.locator('.photo-article').waitFor();
    await b.getByRole('button', { name: '글 수정', exact: true }).click(); await b.locator('#photoTitle').waitFor();
    await b.locator('.ql-editor').click(); await b.keyboard.press('Control+End'); await b.keyboard.type(' 다른 탭에서 고친 문장.');
    await b.getByRole('button', { name: '글 저장', exact: true }).click(); await b.locator('.photo-article').waitFor();
    const next = (await H.stored(b, list => list.length === 1 && list[0].text.includes('다른 탭에서 고친 문장.'), 'saved in the other tab'))[0];
    assert.notEqual(next.id, post.id);
    // The other tab hears of the change the moment it commits, so where the post went is recorded before that.
    assert((await b.evaluate(() => window.__movedAtSave || [])).some(text => text.includes('"' + post.id + '":"' + next.id + '"')), 'the replacement is recorded before the save is written');
    await H.until(() => a.locator('.photo-article').innerText(), text => text.includes('다른 탭에서 고친 문장.'), 'the first tab shows the new content without a reload');
    // Only the content changed: the same block is at the same height and the focus is on the same control.
    const kept = await a.evaluate(() => {
      const first = [...document.querySelectorAll('.photo-article > *')].find(node => node.getBoundingClientRect().bottom > 0);
      return { scrollY, first: first.textContent, top: Math.round(first.getBoundingClientRect().top), focus: document.activeElement?.textContent };
    });
    assert.equal(kept.first, place.first, 'the block being read is still the first on screen');
    assert(Math.abs(kept.top - place.top) <= 2 && Math.abs(kept.scrollY - place.scrollY) <= 40, 'the reading position is kept: ' + JSON.stringify({ place, kept }));
    assert.equal(kept.focus, '내 글로 돌아가기', 'the focus stays on the same control');
    await H.until(async () => a.url(), url => url.includes('blog=photo.' + next.id), 'and names the post that took its place');
    assert.equal(await H.mode(a), 'read');
    // An open editor is never replaced: unsaved input stays when the post changes elsewhere.
    await a.getByRole('button', { name: '글 수정', exact: true }).click(); await a.locator('#photoTitle').waitFor();
    await a.locator('.ql-editor').click(); await a.keyboard.press('Control+End'); await a.keyboard.type(' 첫 탭의 미저장 입력');
    await b.getByRole('button', { name: '글 수정', exact: true }).click(); await b.locator('#photoTitle').waitFor();
    await b.locator('.ql-editor').click(); await b.keyboard.press('Control+End'); await b.keyboard.type(' 또 고침.');
    await b.getByRole('button', { name: '글 저장', exact: true }).click(); await b.locator('.photo-article').waitFor();
    await H.stored(b, list => list.some(row => row.status === 'saved' && row.text.includes('또 고침.')), 'saved again in the other tab');
    await H.sleep(1500);
    assert.equal(await H.mode(a), 'edit', 'the editor stays');
    assert((await H.bodyText(a)).endsWith('첫 탭의 미저장 입력\n') && !(await H.bodyText(a)).includes('또 고침.'), 'with its own input, not the other tab\'s');
  },
  // m4: the read view follows a change that arrives from another device.
  async 'read-view-follows-another-device'({ open }) {
    const server = new H.FakeCloud();
    const { page: a } = await open({ server, device: 'wi-device-a' });
    const { page: b } = await open({ server, device: 'wi-device-b', viewport: { width: 820, height: 1180 } });
    await H.home(a); await H.home(b);
    await savedPost(a, '두 기기 저장 글', '원래 본문.');
    await a.locator('#photoServerStatus[data-state="synced"]').waitFor({ timeout: 20000 });
    await b.bringToFront(); await focusWindow(b);
    await H.until(() => b.locator('.home-post').count(), count => count === 1, 'the post arrives on the other device', 45000);
    await b.locator('.home-post .home-post-open').first().click(); await b.locator('.photo-article').waitFor();
    await b.getByRole('button', { name: '글 수정', exact: true }).click(); await b.locator('#photoTitle').waitFor();
    await b.locator('.ql-editor').click(); await b.keyboard.press('Control+End'); await b.keyboard.type(' 다른 기기에서 고친 문장.');
    await b.getByRole('button', { name: '글 저장', exact: true }).click(); await b.locator('.photo-article').waitFor();
    await b.locator('#photoServerStatus[data-state="synced"]').waitFor({ timeout: 20000 });
    await a.bringToFront(); await focusWindow(a);
    await H.until(() => a.locator('.photo-article').innerText(), text => text.includes('다른 기기에서 고친 문장.'), 'the reading device shows the new content without a reload', 45000);
    await H.until(() => a.locator('#photoServerStatus').innerText(), text => text === '저장됨 · 계정에 올림', 'with the state of what is shown', 20000);
    assert.equal(await H.mode(a), 'read');
  },
  // m4: an address kept from before an edit opens the post that took its place; an unknown one opens the list with a notice, never an empty editor.
  async 'stale-post-address'({ open }) {
    const { page } = await open();
    await H.home(page);
    const post = await savedPost(page, '주소가 남은 글', '원래 본문.');
    await page.getByRole('button', { name: '글 수정', exact: true }).click(); await page.locator('#photoTitle').waitFor();
    await page.locator('.ql-editor').click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' 고침.');
    await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor();
    const next = (await H.stored(page, list => list.length === 1 && list[0].text.includes('고침.'), 'saved'))[0];
    assert.notEqual(next.id, post.id);
    await page.goto(H.base + '/index.html?view=page&blog=photo.' + post.id);
    await page.locator('.photo-article').waitFor();
    assert((await page.locator('.photo-article').innerText()).includes('원래 본문. 고침.'), 'the old address opens the revised post');
    assert.equal(await page.locator('#photoTitle').count(), 0);
    await H.until(async () => page.url(), url => url.includes('blog=photo.' + next.id), 'the address is corrected');
    // An address that names nothing.
    await page.goto(H.base + '/index.html?view=page&blog=photo.no-such-post-0001');
    await ready(page); await settle(page);
    await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    assert.equal(await page.locator('#photoTitle').count(), 0, 'no empty editor for an address that names nothing');
    assert.equal((await H.records(page)).length, 1, 'and no new draft');
    await H.until(() => page.evaluate(() => document.body.innerText), text => text.includes('글을 찾지 못했습니다'), 'one line says why the list is shown');
    assert(!page.url().includes('no-such-post'), 'the address no longer names the missing post: ' + page.url());
    // 글쓰기 reloaded before its first save is still the new post.
    await H.writer(page);
    await page.reload(); await page.locator('#photoTitle').waitFor();
    assert.equal(await H.bodyText(page), '\n');
  },
  // m4: two tabs hold the same revision. One saves it; the other's save is refused. The record of where the
  // post went is the first tab's truth and stays (the refused tab used to take it back).
  async 'moved-record-survives-a-refused-save'({ open, problems, name }) {
    const { page: a, context } = await open({ page: { offline: () => false } });
    await H.home(a);
    const post = await savedPost(a, '두 탭이 같이 고친 글', '원래 본문.');
    await a.getByRole('button', { name: '글 수정', exact: true }).click(); await a.locator('#photoTitle').waitFor();
    await a.locator('.ql-editor').click(); await a.keyboard.press('Control+End'); await a.keyboard.type(' 첫 탭에서 고침.');
    const buffer = (await H.stored(a, list => list.some(row => row.status === 'draft' && row.text.includes('첫 탭에서 고침.')), 'the revision is stored')).find(row => row.status === 'draft');
    const b = await H.newPage(context, problems, name);
    await b.goto(H.base + '/index.html?view=page&blog=photo.' + post.id); await b.locator('.photo-article').waitFor();
    await b.getByRole('button', { name: '글 수정', exact: true }).click(); await b.locator('#photoTitle').waitFor();
    assert((await H.bodyText(b)).includes('첫 탭에서 고침.'), 'the second tab holds the same revision');
    await a.getByRole('button', { name: '글 저장', exact: true }).click(); await a.locator('.photo-article').waitFor();
    await H.stored(a, list => list.length === 1 && list[0].status === 'saved' && list[0].id === buffer.id, 'the first tab saved it');
    const record = page => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('haedo_life_post_moved_v1:')).map(key => localStorage.getItem(key)).join('|'));
    assert((await record(a)).includes('"' + post.id + '":"' + buffer.id + '"'));
    await b.getByRole('button', { name: '글 저장', exact: true }).click();
    await H.until(() => H.status(b), value => value.state === 'error', 'the second tab\'s save is refused');
    assert.equal(await H.mode(b), 'edit');
    await H.sleep(500);
    assert((await record(b)).includes('"' + post.id + '":"' + buffer.id + '"'), 'the record of the save that happened is kept');
    const c = await H.newPage(context, problems, name);
    await c.goto(H.base + '/index.html?view=page&blog=photo.' + post.id); await c.locator('.photo-article').waitFor();
    assert((await c.locator('.photo-article').innerText()).includes('첫 탭에서 고침.'), 'the old address still opens the revised post');
  },
  // m4: when only the stored revision moves (a finished upload writes the post again), the read view does not redraw;
  // its actions use the revision that is stored now.
  async 'read-view-stays-when-only-the-revision-moves'({ open }) {
    const dialogs = [];
    const { page } = await open({ page: { dialogs } });
    await H.home(page);
    const post = await savedPost(page, '그대로인 글', '바뀌지 않는 본문.');
    await page.locator('#photoServerStatus[data-state="synced"]').waitFor({ timeout: 20000 });
    await page.evaluate(() => { window.__article = document.querySelector('.photo-article'); });
    const said = await page.locator('.photo-status').textContent();
    assert.equal(said, '비공개 글을 저장했어요');
    const moved = await page.evaluate(async id => { const s = HaedoLife.Shell.storage, w = await s.getActive(), d = await s.readPhotoPost(w, id); return (await s.savePhotoPost(w, d, d.revision)).revision; }, post.id);
    assert(moved > post.revision);
    await H.sleep(700);
    assert.equal(await page.evaluate(() => document.querySelector('.photo-article') === window.__article), true, 'the view is not redrawn');
    assert.equal(await page.locator('.photo-status').textContent(), said, 'what it said stays');
    await H.until(() => page.locator('#photoServerStatus').getAttribute('data-state'), state => ['synced', 'pending', 'saving'].includes(state), 'the account state is read for the revision stored now');
    // Its actions act on what is stored now: deleting is not refused as "changed elsewhere".
    await H.menu(page, '삭제');
    await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    assert.deepEqual(await H.records(page), []);
    assert(dialogs.some(text => text.startsWith('confirm:')));
  },
});

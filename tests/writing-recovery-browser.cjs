/* A device copy never overwrites what was stored after it was taken (2026-11-11
 * review MAJOR-1), and a copy is removed only by the writer's choice: copies of
 * drafts that were deleted or saved elsewhere are shown every time until then
 * (review MAJOR-2). Real app, synthetic account and server, real IndexedDB and
 * localStorage in Chromium; two devices are two browser contexts sharing one
 * synthetic server, and "another device changed it" inside one context is a
 * write through the app's own storage. */
'use strict';
const H = require('./helpers/writing-input.cjs'), { assert } = H;
const draftWith = (page, text) => H.stored(page, rows => rows.some(row => row.status === 'draft' && row.text.includes(text)), 'draft holding ' + JSON.stringify(text.slice(0, 20)));
const copies = page => page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('haedo_life_post_recovery_v1:')).map(([key, value]) => ({ key, ...JSON.parse(value) })));
const focusWindow = page => page.evaluate(() => dispatchEvent(new Event('focus')));
// The page dies before a draft write commits: draft writes abort while `__dying` is set (per page load).
const dying = context => context.addInitScript(() => {
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, ...rest) { const result = put.call(this, value, ...rest); if (window.__dying && this.name === 'meta' && String(value?.key).startsWith('photo-post:') && value.value?.status === 'draft') this.transaction.abort(); return result; };
});
// The tab is hidden: what the editor holds is written to the device copy.
const hide = page => page.evaluate(() => {
  for (const [name, value] of [['visibilityState', 'hidden'], ['hidden', true]]) Object.defineProperty(document, name, { get: () => value, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
async function savedPost(page, title, body) {
  await H.writer(page);
  await page.locator('#photoTitle').fill(title);
  await page.locator('.ql-editor').click(); await page.keyboard.type(body);
  await page.getByRole('button', { name: '글 저장', exact: true }).click();
  await page.locator('.photo-article').waitFor();
  return (await H.stored(page, list => list.some(row => row.status === 'saved' && row.title === title), 'the post is saved')).find(row => row.title === title);
}
const revise = async page => { await page.getByRole('button', { name: '글 수정', exact: true }).click(); await page.locator('#photoTitle').waitFor(); await page.locator('.ql-editor').waitFor(); };
const band = page => page.evaluate(() => { const bar = document.querySelector('.photo-recovered'); return bar ? { text: bar.querySelector('.photo-recovered-text').textContent, buttons: [...bar.querySelectorAll('button')].map(node => node.textContent) } : null; });
const openDraft = async (page, id) => { await page.locator('#homeTab-drafts').click(); await page.locator('.home-draft[data-draft-id="' + id + '"] .home-draft-open').click(); await page.locator('#photoTitle').waitFor(); };
const LONG = (() => { const chunk = '보관할 수 없을 만큼 긴 붙여넣기 문장입니다. '.repeat(40) + '\n'; return chunk.repeat(Math.ceil(51000 / chunk.length)); })();

H.run(__filename, {
  // MAJOR-1: input of a revision that never reached storage, and the post was then revised and saved on another device.
  async 'copy-of-a-post-changed-on-another-device'({ open, problems, name }) {
    const server = new H.FakeCloud();
    const a = await open({ server, device: 'wr-device-a' }), b = await open({ server, device: 'wr-device-b', viewport: { width: 820, height: 1180 } });
    await dying(a.context);
    const A = a.page, B = b.page;
    await H.home(A); await H.home(B);
    await A.bringToFront();
    const post = await savedPost(A, '두 기기 글', '원래 본문.');
    await A.locator('#photoServerStatus[data-state="synced"]').waitFor({ timeout: 30000 });
    await revise(A);
    await A.evaluate(() => { window.__dying = true; });
    await A.locator('.ql-editor').click(); await A.keyboard.press('Control+End'); await A.keyboard.type(' A에서 쓰다 만 문장');
    await A.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    const kept = await copies(A);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].replaces.id, post.id, 'the copy is of a revision of the post');
    assert.equal(typeof kept[0].base, 'string', 'and records what the post held then');
    await A.close({ runBeforeUnload: false });
    // The other device revises and saves the post.
    await B.bringToFront(); await focusWindow(B);
    await H.until(() => B.locator('.home-post').count(), count => count === 1, 'the post arrives on the other device', 45000);
    await B.locator('.home-post .home-post-open').first().click(); await B.locator('.photo-article').waitFor();
    await revise(B);
    await B.locator('.ql-editor').click(); await B.keyboard.press('Control+End'); await B.keyboard.type(' B에서 고쳐 저장한 문장.');
    await B.getByRole('button', { name: '글 저장', exact: true }).click(); await B.locator('.photo-article').waitFor();
    await B.locator('#photoServerStatus[data-state="synced"]').waitFor({ timeout: 30000 });
    // The first device comes back and receives that version.
    const A2 = await H.newPage(a.context, problems, name);
    await H.home(A2); await focusWindow(A2);
    await H.until(() => H.records(A2), rows => rows.some(row => row.status === 'saved' && row.text.includes('B에서 고쳐 저장한 문장.')), 'the saved change arrives', 45000);
    await H.home(A2);
    await A2.locator('.home-post .home-post-open').first().click(); await A2.locator('.photo-article').waitFor();
    await revise(A2);
    await A2.locator('.photo-recovered').waitFor();
    const offered = await band(A2);
    assert(offered.text.includes('이 글은 그 뒤에 바뀌어 새 초안으로 복구합니다'), 'the band says the post changed since: ' + offered.text);
    assert.deepEqual(offered.buttons, ['새 초안으로 복구', '버리기']);
    await H.until(() => A2.evaluate(() => document.activeElement === document.querySelector('.photo-recovered button')), focused => focused, 'the band\'s first choice has the focus when 글 수정 opens on a kept copy');
    assert((await H.bodyText(A2)).includes('B에서 고쳐 저장한 문장.'), 'the editor shows the post as it is now');
    await A2.getByRole('button', { name: '새 초안으로 복구', exact: true }).click();
    await H.until(() => H.bodyText(A2), text => text === '원래 본문. A에서 쓰다 만 문장\n', 'the kept input is in the editor');
    const rows = await H.stored(A2, list => list.some(row => row.status === 'draft' && row.text.includes('A에서 쓰다 만 문장')), 'stored as a draft of its own');
    const draft = rows.find(row => row.status === 'draft'), saved = rows.find(row => row.status === 'saved');
    assert.equal(draft.replaces, null, 'the copy does not revise the post any more');
    assert(saved.text.includes('B에서 고쳐 저장한 문장.'), 'the post still holds the other device\'s sentence');
    // Saving the restored input cannot remove the other device's sentence either.
    await A2.getByRole('button', { name: '글 저장', exact: true }).click(); await A2.locator('.photo-article').waitFor();
    const final = await H.stored(A2, list => list.length === 2 && list.every(row => row.status === 'saved'), 'both are saved posts');
    assert(final.some(row => row.text.includes('B에서 고쳐 저장한 문장.') && !row.text.includes('A에서 쓰다 만')), 'the other device\'s sentence survives');
    assert(final.some(row => row.text.includes('A에서 쓰다 만 문장') && !row.text.includes('B에서 고쳐')), 'and this device\'s sentence is in its own post');
    await H.until(() => copies(A2), list => list.length === 0, 'the copy ends once its input is stored');
  },
  // The same judgement for a stored draft, by content and never by revision number; and a copy from before the fingerprint existed.
  async 'copy-of-a-draft-changed-or-not'({ open }) {
    const { page, context } = await open();
    await dying(context);
    await H.home(page); await H.writer(page);
    await page.locator('#photoTitle').fill('바뀌는 초안');
    await page.locator('.ql-editor').click(); await page.keyboard.type('초안의 원래 내용.');
    const id = (await draftWith(page, '초안의 원래 내용.'))[0].id;
    const lose = async text => {
      await page.evaluate(() => { window.__dying = true; });
      await page.locator('.ql-editor').click(); await page.keyboard.press('Control+End'); await page.keyboard.type(text);
      await hide(page);
      await H.home(page);
    };
    const rewrite = change => page.evaluate(async ({ id, change }) => { const s = HaedoLife.Shell.storage, w = await s.getActive(), d = await s.readPhotoPost(w, id); if (change) d.ops = [{ insert: change + '\n' }]; return (await s.savePhotoPost(w, d, d.revision)).revision; }, { id, change });
    // 1. The draft is written again with the same content (as a finished upload does): its revision rises, the copy still continues it.
    await lose(' 첫 미보관 입력');
    const before = (await H.records(page))[0].revision;
    assert(await rewrite(null) > before);
    await openDraft(page, id);
    await page.locator('.photo-recovered').waitFor();
    assert.deepEqual((await band(page)).buttons, ['복구', '버리기']);
    assert(!(await band(page)).text.includes('새 초안'));
    await page.getByRole('button', { name: '복구', exact: true }).click();
    await draftWith(page, '초안의 원래 내용. 첫 미보관 입력');
    assert.equal((await H.records(page)).length, 1, 'restored in place');
    await H.until(() => copies(page), list => list.length === 0, 'copy done');
    // 2. The draft's content changes elsewhere after the copy is taken: both are kept.
    await lose(' 둘째 미보관 입력');
    await rewrite('다른 기기에서 바꾼 내용.');
    await openDraft(page, id);
    await page.locator('.photo-recovered').waitFor();
    assert((await band(page)).text.includes('이 초안은 그 뒤에 바뀌어 새 초안으로 복구합니다'), (await band(page)).text);
    assert.deepEqual((await band(page)).buttons, ['새 초안으로 복구', '버리기']);
    await page.getByRole('button', { name: '새 초안으로 복구', exact: true }).click();
    const rows = await H.stored(page, list => list.length === 2 && list.some(row => row.text.includes('둘째 미보관 입력')), 'the copy is a second draft');
    assert.equal(rows.find(row => row.id === id).text, '다른 기기에서 바꾼 내용.\n', 'the changed draft is untouched');
    const second = rows.find(row => row.id !== id);
    assert(second.text.startsWith('초안의 원래 내용. 첫 미보관 입력 둘째 미보관 입력') && second.replaces === null);
    await H.until(() => copies(page), list => list.length === 0, 'copy done');
    // 3. A copy written before copies recorded what was stored cannot be judged: it never goes over a stored draft.
    await lose(' 셋째 미보관 입력');
    await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('haedo_life_post_recovery_v1:')) { const copy = JSON.parse(localStorage.getItem(key)); delete copy.base; localStorage.setItem(key, JSON.stringify(copy)); } });
    await openDraft(page, second.id);
    await page.locator('.photo-recovered').waitFor();
    const old = await band(page);
    assert.deepEqual(old.buttons, ['새 초안으로 복구', '버리기']);
    assert(old.text.endsWith('새 초안으로 복구합니다') && !old.text.includes('그 뒤에 바뀌어'), old.text);
    await page.getByRole('button', { name: '새 초안으로 복구', exact: true }).click();
    const all = await H.stored(page, list => list.length === 3 && list.some(row => row.text.includes('셋째 미보관 입력')), 'a third draft');
    assert(!all.find(row => row.id === second.id).text.includes('셋째'), 'the stored draft is untouched');
  },
  // Copies whose drafts were deleted elsewhere are shown every time 글쓰기 opens, one at a time with how many more
  // wait, until the writer chooses. Nothing else removes them: not a second look, not the clock.
  async 'copies-of-drafts-deleted-elsewhere'({ open }) {
    const dialogs = [];
    const { page } = await open({ page: { dialogs } });
    await H.home(page);
    for (const title of ['지워질 초안 하나', '지워질 초안 둘']) {
      await H.writer(page);
      await page.locator('#photoTitle').fill(title);
      await page.locator('.ql-editor').click(); await page.keyboard.type(title + '의 본문.');
      await draftWith(page, title + '의 본문.');
      await H.pasteBody(page, { text: LONG });
      await H.until(() => H.status(page), value => value.state === 'error' && value.detail.includes('50,000자'), 'kept on this device only');
      await page.getByRole('button', { name: '닫기', exact: true }).click(); await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    }
    assert.equal((await copies(page)).length, 2);
    // Deleted the way another device's deletion removes them (this device's editor was not asked).
    await page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(); for (const row of await s.listPhotoPosts(w)) await s.deletePhotoPost(w, row.id, row.revision); });
    const look = async () => {
      await H.home(page); await H.writer(page);
      await page.locator('.photo-recovered').waitFor();
      return band(page);
    };
    // The writer looks three times without choosing (the first time the page is simply reloaded).
    for (const time of ['first', 'second', 'third']) {
      const offered = await look();
      assert(offered.text.startsWith('보관하지 못한 입력이 이 기기에 남아 있습니다'), time + ': ' + offered.text);
      assert(offered.text.includes('지운 초안이나 글의 입력입니다') && offered.text.includes('새 초안으로 복구합니다') && offered.text.endsWith('외 1건'), time + ': ' + offered.text);
      assert(!/30일|지웁니다/.test(offered.text), 'no deadline is stated because there is none: ' + offered.text);
      assert.deepEqual(offered.buttons, ['새 초안으로 복구', '버리기']);
      assert.equal(await H.quill(page, q => q.isEnabled()), true, time + ': the editor is not locked for a copy that restores as its own draft');
      assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.photo-recovered button')), true, time + ': the band has the focus');
      assert.equal((await copies(page)).length, 2, time + ': both copies are still there');
      assert.equal((await copies(page)).some(copy => 'askedAt' in copy), false, 'no "already asked" note is written');
    }
    // The device clock moves a year ahead: nothing is removed by time.
    await H.home(page);
    await page.evaluate(() => { const real = Date.now; Date.now = () => real() + 366 * 86400000; });
    await H.writer(page);
    await page.locator('.photo-recovered').waitFor();
    assert.equal((await copies(page)).length, 2, 'a year later both copies are still there');
    // An "already asked" note left by the earlier version changes nothing either.
    await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('haedo_life_post_recovery_v1:')) { const copy = JSON.parse(localStorage.getItem(key)); copy.askedAt = '2020-01-01T00:00:00.000Z'; localStorage.setItem(key, JSON.stringify(copy)); } });
    assert((await look()).text.endsWith('외 1건'));
    assert.equal((await copies(page)).length, 2);
    // Choosing moves to the next one; the editor and what is typed in it stay as they are.
    await page.locator('.ql-editor').click(); await page.keyboard.type('띠가 있어도 쓰던 글.');
    await page.getByRole('button', { name: '버리기', exact: true }).click();
    await H.until(() => copies(page), list => list.length === 1, 'one copy discarded after confirmation');
    const next = await band(page);
    assert(next && !next.text.includes('외 '), 'the last one is shown without a count: ' + JSON.stringify(next));
    assert.equal(await H.bodyText(page), '띠가 있어도 쓰던 글.\n');
    await page.getByRole('button', { name: '버리기', exact: true }).click();
    await H.until(() => copies(page), list => list.length === 0, 'the other one discarded');
    assert.equal(await band(page), null);
    assert.equal(dialogs.filter(text => text.startsWith('confirm:이 기기에 남아 있는 입력을 버릴까요?')).length, 2);
    await draftWith(page, '띠가 있어도 쓰던 글.');
  },
  // Restoring such a copy makes a separate draft, after what the editor holds is stored first.
  async 'copy-of-a-deleted-draft-restored'({ open }) {
    const { page } = await open();
    await H.home(page); await H.writer(page);
    await page.locator('.ql-editor').click(); await page.keyboard.type('지워질 초안의 본문.');
    await draftWith(page, '지워질 초안의 본문.');
    // Input the draft never received (its writes abort from here on), kept when the tab was hidden; then the draft is deleted elsewhere.
    await page.evaluate(() => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (value, ...rest) { const result = put.call(this, value, ...rest); if (this.name === 'meta' && String(value?.key).startsWith('photo-post:')) this.transaction.abort(); return result; }; });
    await page.keyboard.type(' 지워진 뒤에도 남은 입력.');
    await hide(page);
    await H.home(page);
    await page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(); for (const row of await s.listPhotoPosts(w)) await s.deletePhotoPost(w, row.id, row.revision); });
    await H.home(page); await H.writer(page);
    await page.locator('.photo-recovered').waitFor();
    // The writer has started something else in the editor meanwhile.
    await page.locator('#photoTitle').fill('지금 쓰던 글');
    await page.locator('.ql-editor').click(); await page.keyboard.type('복구 전에 쓰던 문장');
    await page.getByRole('button', { name: '새 초안으로 복구', exact: true }).click();
    await H.until(() => H.bodyText(page), text => text === '지워질 초안의 본문. 지워진 뒤에도 남은 입력.\n', 'the kept input is in the editor');
    const rows = await H.stored(page, list => list.length === 2 && list.some(row => row.text.includes('지워진 뒤에도 남은 입력.')), 'both are stored drafts');
    assert(rows.some(row => row.title === '지금 쓰던 글' && row.text === '복구 전에 쓰던 문장\n' && row.status === 'draft'), 'what the editor held was stored first');
    assert.deepEqual(rows.find(row => row.text.includes('지워진 뒤에도')).replaces, null, 'the restored copy is a draft of its own');
    await H.until(() => copies(page), list => list.length === 0, 'copy done');
    assert.equal(await band(page), null);
  },
  // A draft with a device copy is saved as a post from another device (same id). The copy is shown by 글쓰기 and by
  // 글 수정 of that post, and restores as a separate draft: the saved post is not overwritten.
  async 'copy-of-a-draft-saved-on-another-device'({ open }) {
    const { page, context } = await open();
    await dying(context);
    await H.home(page); await H.writer(page);
    await page.locator('#photoTitle').fill('다른 기기에서 저장될 초안');
    await page.locator('.ql-editor').click(); await page.keyboard.type('보관된 앞부분.');
    const id = (await draftWith(page, '보관된 앞부분.'))[0].id;
    await page.evaluate(() => { window.__dying = true; });
    await page.keyboard.type(' 올리지 못한 뒷부분.');
    await hide(page);
    await H.home(page);
    // The other device saves the draft as a post, as its 글 저장 does: the same id, now a saved post.
    const saveElsewhere = body => page.evaluate(async ({ id, body }) => { const s = HaedoLife.Shell.storage, w = await s.getActive(), d = await s.readPhotoPost(w, id); d.status = 'saved'; if (body) d.ops = [{ insert: body + '\n' }]; d.updatedAt = new Date().toISOString(); await s.savePhotoPost(w, d, d.revision); }, { id, body });
    await saveElsewhere(null);
    await H.home(page);
    assert.deepEqual((await H.records(page)).map(row => [row.id, row.status]), [[id, 'saved']]);
    assert.equal((await copies(page)).length, 1);
    // 글쓰기 shows it.
    await H.writer(page);
    await page.locator('.photo-recovered').waitFor();
    const onCompose = await band(page);
    assert(onCompose.text.includes('저장한 글이 된 초안의 입력입니다') && onCompose.text.includes('새 초안으로 복구합니다'), onCompose.text);
    assert.deepEqual(onCompose.buttons, ['새 초안으로 복구', '버리기']);
    await page.getByRole('button', { name: '닫기', exact: true }).click(); await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    // 글 수정 of that post shows it too, without locking the revision.
    await page.locator('.home-post .home-post-open').first().click(); await page.locator('.photo-article').waitFor();
    await revise(page);
    await page.locator('.photo-recovered').waitFor();
    const onRevise = await band(page);
    assert(onRevise.text.includes('저장한 글이 된 초안의 입력입니다'), onRevise.text);
    assert.deepEqual(onRevise.buttons, ['새 초안으로 복구', '버리기']);
    assert.equal(await H.quill(page, q => q.isEnabled()), true);
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.photo-recovered button')), true, 'the band has the focus');
    await page.getByRole('button', { name: '새 초안으로 복구', exact: true }).click();
    await H.until(() => H.bodyText(page), text => text === '보관된 앞부분. 올리지 못한 뒷부분.\n', 'the kept input is in the editor');
    const rows = await H.stored(page, list => list.length === 2 && list.some(row => row.status === 'draft' && row.text.includes('올리지 못한 뒷부분.')), 'stored as a draft of its own');
    assert.deepEqual(rows.find(row => row.status === 'draft').replaces, null, 'it does not revise the saved post');
    assert.equal(rows.find(row => row.id === id).text, '보관된 앞부분.\n', 'the saved post is untouched');
    assert.equal(rows.find(row => row.id === id).status, 'saved');
    await H.until(() => copies(page), list => list.length === 0, 'copy done');
    // When the other device saved exactly the kept input, nothing is left to offer.
    await page.getByRole('button', { name: '닫기', exact: true }).click(); await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    const second = (await H.records(page)).find(row => row.status === 'draft').id;
    await page.locator('#homeTab-drafts').click(); await page.locator('.home-draft[data-draft-id="' + second + '"] .home-draft-open').click(); await page.locator('#photoTitle').waitFor();
    await page.evaluate(() => { window.__dying = true; });
    await page.locator('.ql-editor').click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' 덧.');
    await hide(page);
    await H.home(page);
    await page.evaluate(async id => { const s = HaedoLife.Shell.storage, w = await s.getActive(), d = await s.readPhotoPost(w, id); d.status = 'saved'; d.ops = [{ insert: '보관된 앞부분. 올리지 못한 뒷부분. 덧.\n' }]; await s.savePhotoPost(w, d, d.revision); }, second);
    await H.home(page); await H.writer(page);
    await H.sleep(500);
    assert.equal(await band(page), null, 'the saved post already holds that input');
    assert.equal((await copies(page)).length, 0);
  },
  // A copy made by hand (사본으로 이어 쓰기, the same store as the former 현재 입력을 새 초안으로 보관) stores the input
  // under a new id. Input typed after that and lost with the page still continues that new draft: its copy restores
  // in place. 2026-11-12 (account sync review M2/M3): the other tab's change to the same draft is no conflict here any
  // more; this tab, with nothing unsaved, reads it and goes on from it.
  async 'copy-after-keeping-input-as-a-new-draft'({ open, problems, name }) {
    const { page, context } = await open();
    await dying(context);
    await H.home(page); await H.writer(page);
    await page.locator('#photoTitle').fill('두 탭 초안');
    await page.locator('.ql-editor').click(); await page.keyboard.type('처음 보관한 문장.');
    const [first] = await draftWith(page, '처음 보관한 문장.');
    const other = await H.newPage(context, problems, name);
    await other.goto(page.url()); await other.locator('.ql-editor').waitFor();
    await other.locator('.ql-editor').click(); await other.keyboard.press('Control+End'); await other.keyboard.type(' 다른 탭에서 덧붙임.');
    await draftWith(other, '다른 탭에서 덧붙임.');
    await page.bringToFront();
    await H.until(() => H.bodyText(page), text => text.includes('다른 탭에서 덧붙임.'), 'this tab reads the other tab\'s change');
    await page.locator('.ql-editor').click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' 이 탭에서 계속 쓴 문장.');
    await draftWith(page, '다른 탭에서 덧붙임. 이 탭에서 계속 쓴 문장.');
    assert.notEqual((await H.status(page)).state, 'error');
    await H.menu(page, '사본으로 이어 쓰기');
    const kept = (await H.stored(page, list => list.length === 2 && list.some(row => row.id !== first.id && row.text.includes('이 탭에서 계속 쓴 문장.')), 'the input is a new draft')).find(row => row.id !== first.id);
    await H.until(() => H.status(page), value => value.text === '자동 저장됨', 'settled');
    await page.evaluate(() => { window.__dying = true; });
    await page.locator('.ql-editor').click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' 새 초안에서 잃은 입력');
    await hide(page);
    const copy = (await copies(page)).find(item => item.id === kept.id);
    assert(copy, 'the lost input is kept under the new draft');
    assert.equal(copy.base, await page.evaluate(async id => { const s = HaedoLife.Shell.storage, w = await s.getActive(); return HaedoLife.PhotoPost.contentHash(await s.readPhotoPost(w, id)); }, kept.id), 'the copy records what the new draft holds, not what the conflicted one held');
    await page.close({ runBeforeUnload: false });
    const again = await H.newPage(context, problems, name);
    await H.home(again);
    await openDraft(again, kept.id);
    await again.locator('.photo-recovered').waitFor();
    assert.deepEqual((await band(again)).buttons, ['복구', '버리기'], 'it continues the new draft: ' + (await band(again)).text);
    await again.getByRole('button', { name: '복구', exact: true }).click();
    await H.stored(again, list => list.length === 2 && list.some(row => row.id === kept.id && row.text.includes('새 초안에서 잃은 입력')), 'restored in place');
  },
  // 글쓰기 reuses an empty draft left in storage. Input lost with the page continues that draft too.
  async 'copy-of-a-reused-empty-draft'({ open }) {
    const { page, context } = await open();
    await dying(context);
    await H.home(page);
    const id = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(); return (await s.savePhotoPost(w, HaedoLife.PhotoPost.create(HaedoLife.Core.id), 0)).id; });
    await H.home(page); await H.writer(page);
    await page.evaluate(() => { window.__dying = true; });
    await page.locator('.ql-editor').click(); await page.keyboard.type('빈 초안에 쓰다 잃은 입력');
    await hide(page);
    const copy = (await copies(page))[0];
    assert.equal(copy.id, id, 'the empty draft was reused');
    assert.equal(copy.base, await page.evaluate(async id => { const s = HaedoLife.Shell.storage, w = await s.getActive(); return HaedoLife.PhotoPost.contentHash(await s.readPhotoPost(w, id)); }, id), 'the copy records what the empty draft holds');
    await H.home(page); await H.writer(page);
    await page.locator('.photo-recovered').waitFor();
    assert.deepEqual((await band(page)).buttons, ['복구', '버리기'], (await band(page)).text);
    assert.equal(await H.quill(page, q => q.isEnabled()), false, 'a copy of the open draft is decided before typing over it');
    await page.getByRole('button', { name: '복구', exact: true }).click();
    const rows = await draftWith(page, '빈 초안에 쓰다 잃은 입력');
    assert.deepEqual(rows.map(row => row.id), [id], 'restored into the same draft');
  },
  // A draft hidden on another device has nothing to open in place: its copy is offered by 글쓰기 and restores as a
  // draft of its own; the hidden draft is untouched. 3rd review MINOR-C: input typed while the restore waits for
  // the hidden draft's photos is kept with what the editor held (it used to vanish with the swap).
  async 'copy-of-a-hidden-draft'({ open }) {
    const { page, context } = await open();
    await dying(context);
    await H.home(page); await H.writer(page);
    await page.locator('#photoTitle').fill('숨겨질 초안');
    await page.locator('.ql-editor').click(); await page.keyboard.type('숨기기 전에 보관된 문장.');
    const id = (await draftWith(page, '숨기기 전에 보관된 문장.'))[0].id;
    await page.evaluate(() => { window.__dying = true; });
    await page.keyboard.type(' 보관되지 못한 문장.');
    await hide(page);
    await page.reload(); await H.home(page);
    // Hidden the way another device's 숨기기 arrives: the same draft, archived.
    await page.evaluate(async id => { const s = HaedoLife.Shell.storage, w = await s.getActive(), d = await s.readPhotoPost(w, id); d.archived = true; await s.savePhotoPost(w, d, d.revision); }, id);
    assert.deepEqual((await H.records(page)).map(row => [row.id, row.status, row.archived]), [[id, 'draft', true]]);
    assert.equal((await copies(page)).length, 1);
    await H.home(page); await H.writer(page);
    await page.locator('.photo-recovered').waitFor();
    const offered = await band(page);
    assert(offered.text.includes('숨긴 초안의 입력입니다') && offered.text.includes('새 초안으로 복구합니다'), offered.text);
    assert.deepEqual(offered.buttons, ['새 초안으로 복구', '버리기']);
    assert.equal(await H.quill(page, q => q.isEnabled()), true, 'the editor is not locked');
    // The writer has started another text; the instant the restore reads the hidden draft, one more word arrives.
    await page.locator('#photoTitle').fill('지금 쓰던 글');
    await page.locator('.ql-editor').click(); await page.keyboard.type('지금 쓰던 문장.');
    await H.stored(page, rows => rows.some(row => row.title === '지금 쓰던 글' && row.text === '지금 쓰던 문장.\n'), 'the current text is stored');
    await page.evaluate(id => {
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (key, ...rest) {
        if (String(key) === 'photo-post:' + id || String(key).startsWith('photo-post:') && String(key).endsWith(id)) {
          IDBObjectStore.prototype.get = get;
          const q = Quill.find(document.querySelector('.ql-container'));
          q.insertText(q.getLength() - 1, ' 복구를 누른 직후 입력', 'user');
          window.__typedWhileRestoring = true;
        }
        return get.call(this, key, ...rest);
      };
    }, id);
    await page.getByRole('button', { name: '새 초안으로 복구', exact: true }).click();
    await H.until(() => H.bodyText(page), text => text === '숨기기 전에 보관된 문장. 보관되지 못한 문장.\n', 'the kept input is in the editor');
    assert.equal(await page.evaluate(() => window.__typedWhileRestoring), true, 'the word arrived while the restore waited');
    const rows = await H.stored(page, list => list.length === 3 && list.some(row => row.text.includes('보관되지 못한 문장.') && row.id !== id), 'a draft of its own');
    assert.equal(rows.find(row => row.title === '지금 쓰던 글')?.text, '지금 쓰던 문장. 복구를 누른 직후 입력\n', 'the word typed while restoring is kept with what the editor held');
    const hidden = rows.find(row => row.id === id);
    assert.deepEqual([hidden.status, hidden.archived, hidden.text], ['draft', true, '숨기기 전에 보관된 문장.\n'], 'the hidden draft is untouched');
    assert.equal(rows.find(row => row.id !== id && row.text.includes('보관되지 못한')).replaces, null);
    await H.until(() => copies(page), list => list.length === 0, 'copy done');
  },
  // 3rd review MINOR-D: restoring when this device cannot write the new draft's copy (storage full) and the store
  // also refuses. The original copy stays until the restored input is kept somewhere: closing the tab loses nothing.
  async 'restoring-when-this-device-cannot-keep-a-copy'({ open, problems, name }) {
    const { page, context } = await open();
    await dying(context);
    await H.home(page);
    const full = target => target.evaluate(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) { if (String(key).startsWith('haedo_life_post_recovery_v1:')) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return setItem.call(this, key, value); };
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, ...rest) { const result = put.call(this, value, ...rest); if (this.name === 'meta' && String(value?.key).startsWith('photo-post:')) this.transaction.abort(); return result; };
    });
    const kill = async target => { await target.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))); await target.close({ runBeforeUnload: false }); };
    // 1. A copy with no draft (deleted elsewhere), restored from 글쓰기's band.
    await H.writer(page);
    await page.locator('.ql-editor').click(); await page.keyboard.type('지워질 초안의 본문.');
    await draftWith(page, '지워질 초안의 본문.');
    await page.evaluate(() => { window.__dying = true; });
    await page.keyboard.type(' 남은 입력 하나.');
    await hide(page);
    await page.reload(); await H.home(page);
    await page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(); for (const row of await s.listPhotoPosts(w)) await s.deletePhotoPost(w, row.id, row.revision); });
    const [gone] = await copies(page);
    await H.home(page); await H.writer(page);
    await page.locator('.photo-recovered').waitFor();
    await full(page);
    await page.getByRole('button', { name: '새 초안으로 복구', exact: true }).click();
    await H.until(() => H.bodyText(page), text => text === '지워질 초안의 본문. 남은 입력 하나.\n', 'the kept input is in the editor');
    await H.until(() => H.status(page), value => value.state === 'error', 'the store refuses');
    assert.deepEqual((await copies(page)).map(copy => [copy.id, copy.savedAt]), [[gone.id, gone.savedAt]], 'the original copy stays: nothing else holds the input');
    await kill(page);
    let next = await H.newPage(context, problems, name);
    await H.home(next); await H.writer(next);
    await next.locator('.photo-recovered').waitFor();
    assert((await band(next)).text.includes('지운 초안이나 글의 입력입니다'), 'offered again after the tab closed');
    // The device accepts again: the restored draft is stored and the original copy goes with that.
    await next.getByRole('button', { name: '새 초안으로 복구', exact: true }).click();
    const restored = (await draftWith(next, '남은 입력 하나.')).find(row => row.text.includes('남은 입력 하나.'));
    await H.until(() => copies(next), list => list.length === 0, 'copy done once the draft is stored');
    // 2. The same for a copy of a draft changed elsewhere, restored from the draft's own band (새 초안으로 복구).
    await next.evaluate(() => { window.__dying = true; });
    await next.locator('.ql-editor').click(); await next.keyboard.press('Control+End'); await next.keyboard.type(' 남은 입력 둘.');
    await hide(next);
    await next.reload(); await H.home(next);
    await next.evaluate(async id => { const s = HaedoLife.Shell.storage, w = await s.getActive(), d = await s.readPhotoPost(w, id); d.ops = [{ insert: '다른 기기에서 바꾼 내용.\n' }]; await s.savePhotoPost(w, d, d.revision); }, restored.id);
    const [changed] = await copies(next);
    assert.equal(changed.id, restored.id);
    await openDraft(next, restored.id);
    await next.locator('.photo-recovered').waitFor();
    assert.deepEqual((await band(next)).buttons, ['새 초안으로 복구', '버리기']);
    await full(next);
    await next.getByRole('button', { name: '새 초안으로 복구', exact: true }).click();
    await H.until(() => H.bodyText(next), text => text.endsWith('남은 입력 둘.\n'), 'the kept input is in the editor');
    await H.until(() => H.status(next), value => value.state === 'error', 'the store refuses');
    assert.deepEqual((await copies(next)).map(copy => [copy.id, copy.savedAt]), [[changed.id, changed.savedAt]], 'the original copy stays');
    await kill(next);
    next = await H.newPage(context, problems, name);
    await H.home(next);
    await openDraft(next, restored.id);
    await next.locator('.photo-recovered').waitFor();
    assert.deepEqual((await band(next)).buttons, ['새 초안으로 복구', '버리기'], 'offered again after the tab closed');
    assert.equal((await H.records(next)).find(row => row.id === restored.id).text, '다른 기기에서 바꾼 내용.\n', 'the changed draft is untouched');
  },
  // 4th review (검사 공백 storedHandedOver): the restored draft's own device copy could not be written (storage full)
  // but the store works. The original copy is handed over and goes with the restored draft's first store, in this
  // same page (not by a later copy write or another page).
  async 'a-handed-over-copy-goes-with-the-first-store'({ open }) {
    const { page, context } = await open();
    await dying(context);
    await H.home(page); await H.writer(page);
    await page.locator('.ql-editor').click(); await page.keyboard.type('넘겨줄 초안의 본문.');
    await draftWith(page, '넘겨줄 초안의 본문.');
    await page.evaluate(() => { window.__dying = true; });
    await page.keyboard.type(' 남은 입력.');
    await hide(page);
    await page.reload(); await H.home(page);
    await page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(); for (const row of await s.listPhotoPosts(w)) await s.deletePhotoPost(w, row.id, row.revision); });
    const [gone] = await copies(page);
    await H.writer(page);
    await page.locator('.photo-recovered').waitFor();
    // Copies cannot be written; the store can. Writes of the original copy are counted: it must not be written again.
    await page.evaluate(() => {
      const setItem = Storage.prototype.setItem;
      window.__copyWrites = 0;
      Storage.prototype.setItem = function (key, value) { if (String(key).startsWith('haedo_life_post_recovery_v1:')) { window.__copyWrites++; throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); } return setItem.call(this, key, value); };
    });
    await page.getByRole('button', { name: '새 초안으로 복구', exact: true }).click();
    await H.until(() => H.bodyText(page), text => text === '넘겨줄 초안의 본문. 남은 입력.\n', 'the kept input is in the editor');
    assert.ok(await page.evaluate(() => window.__copyWrites) >= 1, 'the restored draft\'s own copy could not be written');
    const rows = await draftWith(page, '남은 입력.');
    assert.equal(rows.length, 1); assert.notEqual(rows[0].id, gone.id, 'a draft of its own');
    await H.until(() => copies(page), list => list.length === 0, 'the original copy goes with that first store');
    assert.notEqual((await H.status(page)).state, 'error');
  },
  // 4th review MINOR (사진 일시 실패 안내 문구): reading the photos of the post a copy's draft became fails for now.
  // Nothing is restored and the copy stays with its photo places; "not on this device" is never said; a retry restores the photo.
  async 'a-photo-read-that-fails-for-now-restores-nothing'({ open }) {
    const { page, context } = await open();
    await dying(context);
    await H.home(page); await H.writer(page);
    await page.locator('#photoTitle').fill('사진 있는 초안');
    await page.locator('#photoFiles').setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: await H.jpeg(page) });
    await page.locator('.photo-block img').waitFor();
    await page.locator('.ql-editor').click(); await page.keyboard.press('Control+End'); await page.keyboard.type('사진 아래 문장.');
    const id = (await draftWith(page, '사진 아래 문장.'))[0].id;
    await page.evaluate(() => { window.__dying = true; });
    await page.keyboard.type(' 보관되지 못한 문장.');
    await hide(page);
    await page.reload(); await H.home(page);
    await page.evaluate(async id => { const s = HaedoLife.Shell.storage, w = await s.getActive(), d = await s.readPhotoPost(w, id); d.archived = true; await s.savePhotoPost(w, d, d.revision); }, id);
    const [kept] = await copies(page);
    assert.equal(kept.ops.filter(op => op.insert?.photo).length, 1, 'the copy holds the photo place');
    await H.writer(page);
    await page.locator('.photo-recovered').waitFor();
    // The next read of that draft fails once (a transient storage error).
    await page.evaluate(id => {
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (key, ...rest) {
        if (String(key).startsWith('photo-post:') && String(key).endsWith(':' + id)) { IDBObjectStore.prototype.get = get; throw new DOMException('Busy for now.', 'UnknownError'); }
        return get.call(this, key, ...rest);
      };
    }, id);
    await page.getByRole('button', { name: '새 초안으로 복구', exact: true }).click();
    await H.until(() => H.status(page), value => value.state === 'error', 'the restore says it did not happen');
    const said = (await H.status(page)).text;
    assert.match(said, /사진을 읽지 못해 복구하지 않았습니다/); assert.doesNotMatch(said, /남아 있지 않아요/);
    assert.deepEqual((await copies(page)).map(copy => [copy.id, copy.savedAt]), [[kept.id, kept.savedAt]], 'the copy stays, photo place and all');
    assert.equal((await H.records(page)).length, 1, 'no draft without its photo was made');
    assert.ok(await page.locator('.photo-recovered').count(), 'still offered');
    await page.getByRole('button', { name: '새 초안으로 복구', exact: true }).click();
    await H.until(() => H.bodyText(page), text => text.includes('보관되지 못한 문장.'), 'restored on the retry');
    assert.equal(await page.locator('.ql-editor .photo-block img').count(), 1, 'with its photo');
    assert.doesNotMatch((await H.status(page)).text || '', /남아 있지 않아요/);
    await H.stored(page, list => list.some(row => row.id !== id && row.photos === 1 && row.text.includes('보관되지 못한 문장.')), 'a draft of its own with the photo');
  },
  // settleDraft's fingerprint (keyHash) of the saved post, on the path that reaches it with the editor still open:
  // another screen asks the editor to leave (flush), the revision buffer that holds what the post holds is removed,
  // and the move does not happen. Input lost after that still continues the post: its copy restores in place.
  async 'copy-after-a-settled-revision-buffer'({ open, problems, name }) {
    const { page, context } = await open();
    await dying(context);
    // The editor instance the workbench creates (its `flush` is what other screens call before moving on).
    await context.addInitScript(() => {
      let life;
      Object.defineProperty(window, 'HaedoLife', { configurable: true, get() { return life; }, set(value) {
        life = value;
        if (!value || value.__captured) return;
        value.__captured = true;
        let ui;
        Object.defineProperty(value, 'PhotoPostUI', { configurable: true, enumerable: true, get() { return ui; }, set(given) { ui = { ...given, create: (...args) => (window.__photoPostUI = given.create(...args)) }; } });
      } });
    });
    await H.home(page);
    const post = await savedPost(page, '정리되는 수정 버퍼', '저장한 본문 문장.');
    await revise(page);
    await page.locator('.ql-editor').click(); await page.keyboard.press('Control+End'); await page.keyboard.type('x');
    await H.stored(page, rows => rows.some(row => row.status === 'draft' && row.replaces?.id === post.id && row.text.includes('문장.x')), 'the revision buffer is stored');
    await page.keyboard.press('Backspace');
    await H.stored(page, rows => rows.some(row => row.status === 'draft' && row.replaces?.id === post.id && row.revision >= 2 && !row.text.includes('문장.x')), 'the buffer holds what the post holds');
    assert.equal(await page.evaluate(() => window.__photoPostUI.flush()), true, 'leaving removes the buffer');
    assert.deepEqual((await H.records(page)).map(row => row.id), [post.id]);
    assert.equal(await H.mode(page), 'edit', 'the move did not happen: the editor is still open');
    await page.evaluate(() => { window.__dying = true; });
    await page.locator('.ql-editor').click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' 버퍼 정리 뒤 잃은 입력');
    await hide(page);
    const [copy] = await copies(page);
    assert.equal(copy?.replaces?.id, post.id);
    assert.equal(copy.base, await page.evaluate(async id => { const s = HaedoLife.Shell.storage, w = await s.getActive(); return HaedoLife.PhotoPost.contentHash(await s.readPhotoPost(w, id)); }, post.id), 'the copy records what the post holds');
    await page.close({ runBeforeUnload: false });
    const again = await H.newPage(context, problems, name);
    await H.home(again);
    await again.locator('.home-post .home-post-open').first().click(); await again.locator('.photo-article').waitFor();
    await revise(again);
    await again.locator('.photo-recovered').waitFor();
    assert.deepEqual((await band(again)).buttons, ['복구', '버리기'], 'it continues the post: ' + (await band(again)).text);
    await again.getByRole('button', { name: '복구', exact: true }).click();
    await H.until(() => H.bodyText(again), text => text === '저장한 본문 문장. 버퍼 정리 뒤 잃은 입력\n', 'restored in place');
  },
  // Deleting a draft or a post in this app removes its device copies with it.
  async 'copies-leave-with-what-is-deleted-here'({ open }) {
    const dialogs = [];
    const { page, context } = await open({ page: { dialogs } });
    await dying(context);
    await H.home(page); await H.writer(page);
    await page.locator('#photoTitle').fill('지울 초안');
    await page.locator('.ql-editor').click(); await page.keyboard.type('지울 초안의 본문.');
    await draftWith(page, '지울 초안의 본문.');
    await H.pasteBody(page, { text: LONG });
    await H.until(() => H.status(page), value => value.state === 'error' && value.detail.includes('50,000자'), 'kept on this device only');
    assert.equal((await copies(page)).length, 1);
    await H.menu(page, '초안 삭제');
    await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    assert.deepEqual(await H.records(page), []);
    assert.deepEqual(await copies(page), [], '초안 삭제 removes the copy');
    await H.writer(page);
    assert.equal(await band(page), null, 'nothing is offered for the deleted draft');
    await page.getByRole('button', { name: '닫기', exact: true }).click(); await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    // A saved post with input of a revision that never reached storage; the post is then deleted from its read view.
    const post = await savedPost(page, '지울 글', '지울 글의 본문.');
    await revise(page);
    await page.evaluate(() => { window.__dying = true; });
    await page.locator('.ql-editor').click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' 보관되지 못한 수정');
    await hide(page);
    assert.equal((await copies(page))[0]?.replaces?.id, post.id);
    await page.reload(); await page.locator('.photo-article').waitFor();
    assert.equal((await copies(page)).length, 1);
    await H.menu(page, '삭제');
    await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    assert.deepEqual(await H.records(page), []);
    assert.deepEqual(await copies(page), [], '삭제 removes the copies of revisions of the post');
    assert(dialogs.some(text => text.startsWith('confirm:')));
  },
});

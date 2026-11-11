/* A device copy never overwrites what was stored after it was taken (2026-11-11
 * review MAJOR-1), and copies of drafts that no longer exist are settled by a
 * stated rule. Real app, synthetic account and server, real IndexedDB and
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
  // A copy whose draft was deleted elsewhere is offered once, as a new draft, and says when it will be removed.
  async 'copy-of-a-draft-deleted-elsewhere'({ open }) {
    const { page } = await open();
    await H.home(page); await H.writer(page);
    await page.locator('#photoTitle').fill('지워질 초안');
    await page.locator('.ql-editor').click(); await page.keyboard.type('지워질 초안의 본문.');
    await draftWith(page, '지워질 초안의 본문.');
    await H.pasteBody(page, { text: LONG });
    await H.until(() => H.status(page), value => value.state === 'error' && value.detail.includes('50,000자'), 'kept on this device only');
    await page.getByRole('button', { name: '닫기', exact: true }).click(); await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    // Deleted the way another device's deletion removes it (this device's editor was not asked).
    await page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(); for (const row of await s.listPhotoPosts(w)) await s.deletePhotoPost(w, row.id, row.revision); });
    await H.home(page); await H.writer(page);
    await page.locator('.photo-recovered').waitFor();
    const offered = await band(page);
    assert(offered.text.includes('지운 초안의 입력이라 새 초안으로 복구합니다') && offered.text.includes('지금 고르지 않으면 30일 뒤 지웁니다'), offered.text);
    assert.deepEqual(offered.buttons, ['새 초안으로 복구', '버리기']);
    assert.equal(typeof (await copies(page))[0].askedAt, 'string', 'the offer is noted');
    // Left undecided: it is not offered again and the editor is not locked again, but it is not removed yet.
    await page.getByRole('button', { name: '닫기', exact: true }).click(); await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    await H.writer(page);
    assert.equal(await band(page), null, 'asked once');
    assert.equal(await H.quill(page, q => q.isEnabled()), true);
    assert.equal((await copies(page)).length, 1, 'kept for now');
    await page.getByRole('button', { name: '닫기', exact: true }).click(); await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    // 29 days after the offer it is still there; after 30 it is removed, as the offer said.
    const age = days => page.evaluate(days => { for (const key of Object.keys(localStorage)) if (key.startsWith('haedo_life_post_recovery_v1:')) { const copy = JSON.parse(localStorage.getItem(key)); copy.askedAt = new Date(Date.now() - days * 86400000).toISOString(); localStorage.setItem(key, JSON.stringify(copy)); } }, days);
    await age(29); await H.writer(page);
    assert.equal((await copies(page)).length, 1);
    await page.getByRole('button', { name: '닫기', exact: true }).click(); await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    await age(31); await H.writer(page);
    assert.equal((await copies(page)).length, 0, 'removed 30 days after it was offered');
    assert.equal(await band(page), null);
  },
  // Choosing to restore such a copy makes a new draft of it.
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
    await page.getByRole('button', { name: '새 초안으로 복구', exact: true }).click();
    const rows = await draftWith(page, '지워진 뒤에도 남은 입력.');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, '지워질 초안의 본문. 지워진 뒤에도 남은 입력.\n');
    await H.until(() => copies(page), list => list.length === 0, 'copy done');
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

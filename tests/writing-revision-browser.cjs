/* Revising a saved post uses an editing buffer, not a kept copy (2026-11-11 M2):
 * nothing is stored until something changes, an unchanged or empty buffer is
 * removed on leaving (from the account too), and the editor can discard it.
 * Real app, synthetic account and server, real IndexedDB in Chromium. */
'use strict';
const H = require('./helpers/writing-input.cjs'), { assert } = H;
async function savedPost(page, title, body) {
  await H.writer(page);
  await page.locator('#photoTitle').fill(title);
  await page.locator('.ql-editor').click(); await page.keyboard.type(body);
  await page.getByRole('button', { name: '글 저장', exact: true }).click();
  await page.locator('.photo-article').waitFor();
  const rows = await H.stored(page, list => list.length === 1 && list[0].status === 'saved', 'the post is saved');
  return rows[0];
}
const revise = async page => { await page.getByRole('button', { name: '글 수정', exact: true }).click(); await page.locator('#photoTitle').waitFor(); await page.locator('.ql-editor').waitFor(); };
const close = async page => { await page.getByRole('button', { name: '닫기', exact: true }).click(); await page.locator('#homeComposition[aria-busy="false"]').waitFor(); };
const homeDrafts = page => page.evaluate(() => ({
  strip: !!document.querySelector('.home-resume') && !document.querySelector('.home-resume').hidden,
  tab: document.querySelector('#homeTab-drafts')?.textContent ?? null,
  posts: document.querySelectorAll('.home-post').length,
}));
const serverDrafts = server => [...server.posts.values()].filter(row => row.data.status === 'draft');
const menuItems = async page => { await page.locator('.photo-more > summary').click(); const names = await page.locator('.photo-more-menu button').allTextContents(); await page.keyboard.press('Escape'); return names; };

H.run(__filename, {
  // 2a: opening 수정 and closing it leaves no draft on this device or in the account.
  async 'revise-without-change-stores-nothing'({ open }) {
    const { page, server } = await open();
    await H.home(page);
    const post = await savedPost(page, '저장한 글', '원래 본문입니다.');
    await revise(page);
    assert.equal((await H.status(page)).text, '바꾼 내용 없음');
    assert(page.url().includes('blog=photo.' + post.id), 'the address still names the saved post: ' + page.url());
    await H.sleep(2600); // past the autosave deadline
    assert.deepEqual((await H.records(page)).map(row => [row.id, row.status]), [[post.id, 'saved']], 'no draft is stored for an unchanged revision');
    // A reload in this state shows the saved post, not an empty editor.
    await page.reload(); await page.locator('.photo-article').waitFor();
    assert((await page.locator('.photo-article').innerText()).includes('원래 본문입니다.'));
    await revise(page);
    await close(page);
    assert.deepEqual(await homeDrafts(page), { strip: false, tab: '초안', posts: 1 });
    await H.sleep(6500); // past the 5 s draft upload delay
    assert.deepEqual(serverDrafts(server), [], 'nothing reached the account');
    assert.deepEqual((await H.records(page)).map(row => row.status), ['saved']);
  },
  // 2a: a revision changed and changed back is removed on leaving, from the account too.
  async 'revise-back-to-original-is-removed'({ open }) {
    const { page, server } = await open();
    await H.home(page);
    const post = await savedPost(page, '저장한 글', '원래 본문입니다.');
    await revise(page);
    await page.locator('.ql-editor').click(); await page.keyboard.press('Control+End'); await page.keyboard.type('덧');
    const rows = await H.stored(page, list => list.some(row => row.status === 'draft' && row.replaces?.id === post.id && row.text.includes('덧')), 'the first change stores the buffer');
    const buffer = rows.find(row => row.status === 'draft');
    await H.until(async () => page.url(), url => url.includes('blog=photo.' + buffer.id), 'the address names the stored buffer');
    await H.until(async () => serverDrafts(server).length, count => count === 1, 'the changed revision is kept in the account', 20000);
    await page.keyboard.press('Backspace');
    await H.stored(page, list => list.some(row => row.status === 'draft' && !row.text.includes('덧')), 'stored again without the change');
    await close(page);
    await H.stored(page, list => list.length === 1 && list[0].id === post.id && list[0].status === 'saved', 'the unchanged buffer is removed on leaving');
    assert.deepEqual(await homeDrafts(page), { strip: false, tab: '초안', posts: 1 });
    await H.until(async () => serverDrafts(server).length, count => count === 0, 'and removed from the account', 20000);
    assert.equal([...server.posts.values()].filter(row => row.data.status === 'saved').length, 1, 'the saved post stays in the account');
  },
  // A changed revision is still kept, reopened and saved as before.
  async 'revise-with-change-is-kept'({ open }) {
    const { page } = await open();
    await H.home(page);
    const post = await savedPost(page, '저장한 글', '원래 본문입니다.');
    await revise(page);
    await page.locator('.ql-editor').click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' 고친 문장.');
    await H.stored(page, list => list.some(row => row.status === 'draft' && row.text.includes('고친 문장.')), 'buffer stored');
    await close(page);
    assert.equal((await H.records(page)).length, 2, 'a changed revision stays');
    const drafts = await homeDrafts(page);
    assert.deepEqual([drafts.strip, drafts.tab], [true, '초안 1']);
    await page.locator('.home-post .home-post-open').first().click(); await page.locator('.photo-article').waitFor();
    await revise(page);
    assert((await H.bodyText(page)).includes('고친 문장.'), 'the kept revision is reopened');
    await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor();
    const rows = await H.stored(page, list => list.length === 1 && list[0].status === 'saved', 'saved over the original');
    assert(rows[0].text.includes('원래 본문입니다. 고친 문장.'));
    assert.notEqual(rows[0].id, post.id, 'the id scheme is unchanged: a saved revision takes a new id');
  },
  // 2a: 수정 취소 discards the buffer after a confirmation; a failed removal keeps the input.
  async 'revise-cancel'({ open }) {
    const dialogs = []; let answer = false;
    const { page, context } = await open({ page: { dialogs, accept: dialog => answer ? dialog.accept() : dialog.dismiss() } });
    await context.addInitScript(() => {
      const original = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function (key, ...rest) { const result = original.call(this, key, ...rest); if (window.__failDelete && this.name === 'meta' && String(key).startsWith('photo-post:')) this.transaction.abort(); return result; };
    });
    await H.home(page);
    const post = await savedPost(page, '저장한 글', '원래 본문입니다.');
    await revise(page);
    await page.locator('.ql-editor').click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' 버릴 문장.');
    await H.stored(page, list => list.some(row => row.status === 'draft' && row.text.includes('버릴 문장.')), 'buffer stored');
    assert.deepEqual(await menuItems(page), ['사진 포함 백업', 'HTML 읽기 파일 받기', '사본으로 이어 쓰기', '초안 다시 저장', '새 글로 저장', '수정 취소', '내 입력을 새 초안으로 보관']);
    // Declined: nothing changes.
    await H.menu(page, '수정 취소');
    await H.until(async () => dialogs.length, count => count === 1, 'asked first');
    assert.equal(dialogs[0], 'confirm:수정한 내용을 버릴까요? 저장한 글은 그대로 남습니다.');
    assert.equal(await H.mode(page), 'edit');
    assert.equal((await H.records(page)).length, 2);
    // The removal fails: the input stays in the editor and nothing is lost.
    answer = true;
    await page.evaluate(() => { window.__failDelete = true; });
    await H.menu(page, '수정 취소');
    await H.until(() => H.status(page), value => value.state === 'error', 'the failure is said');
    assert.equal(await H.mode(page), 'edit');
    assert((await H.bodyText(page)).includes('버릴 문장.'), 'the input is still in the editor');
    assert.equal((await H.records(page)).length, 2, 'and still stored');
    await page.evaluate(() => { window.__failDelete = false; });
    await H.menu(page, '수정 취소');
    await page.locator('.photo-article').waitFor();
    assert((await page.locator('.photo-article').innerText()).includes('원래 본문입니다.'), 'back on the saved post');
    assert(!(await page.locator('.photo-article').innerText()).includes('버릴 문장.'));
    assert.deepEqual((await H.records(page)).map(row => [row.id, row.status, row.text]), [[post.id, 'saved', '원래 본문입니다.\n']]);
  },
  // 2a: 초안 삭제 for a new draft.
  async 'new-draft-delete'({ open }) {
    const dialogs = [];
    const { page, server } = await open({ page: { dialogs } });
    await H.home(page); await H.writer(page);
    await page.locator('#photoTitle').fill('지울 초안');
    await page.locator('.ql-editor').click(); await page.keyboard.type('지울 본문.');
    await H.stored(page, list => list.length === 1 && list[0].text.includes('지울 본문.'), 'draft stored');
    await H.until(async () => serverDrafts(server).length, count => count === 1, 'draft uploaded', 20000);
    const names = await menuItems(page);
    assert(names.includes('초안 삭제') && names.includes('목록에서 숨기기') && !names.includes('수정 취소'), names.join());
    await H.menu(page, '초안 삭제');
    await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    assert.equal(dialogs[0], 'confirm:이 초안을 삭제할까요? 로그인한 모든 기기에서 함께 삭제됩니다.');
    assert.deepEqual(await H.records(page), []);
    assert.deepEqual(await homeDrafts(page), { strip: false, tab: '초안', posts: 0 });
    await H.until(async () => serverDrafts(server).length, count => count === 0, 'removed from the account', 20000);
  },
  // 2c: a draft emptied and closed is not kept, and a leftover empty draft is not offered on the home.
  async 'empty-draft'({ open }) {
    const { page } = await open();
    await H.home(page); await H.writer(page);
    await page.locator('#photoTitle').fill('잠깐');
    await page.locator('.ql-editor').click(); await page.keyboard.type('임시로 쓴 글');
    await H.stored(page, list => list.length === 1 && list[0].text.includes('임시로 쓴 글'), 'draft stored');
    await page.keyboard.press('Control+a'); await page.keyboard.press('Delete');
    await page.locator('#photoTitle').fill('');
    await H.stored(page, list => list.length === 1 && !list[0].text.trim() && !list[0].title, 'stored empty');
    await close(page);
    assert.deepEqual(await H.records(page), [], 'the empty draft is removed on closing');
    assert.deepEqual(await homeDrafts(page), { strip: false, tab: '초안', posts: 0 });
    // An empty draft left by an earlier version (or another device) is not a row.
    await page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(); await s.savePhotoPost(w, HaedoLife.PhotoPost.create(HaedoLife.Core.id), 0); });
    await H.home(page);
    assert.equal((await H.records(page)).length, 1);
    assert.deepEqual(await homeDrafts(page), { strip: false, tab: '초안', posts: 0 });
    // 글쓰기 reuses it instead of adding another.
    await H.writer(page);
    await page.locator('.ql-editor').click(); await page.keyboard.type('이어서 쓴 글');
    const rows = await H.stored(page, list => list.some(row => row.text.includes('이어서 쓴 글')), 'stored');
    assert.equal(rows.length, 1);
    await close(page);
    assert.deepEqual(await homeDrafts(page), { strip: true, tab: '초안 1', posts: 0 });
  },
  // 2b: 목록에서 숨기기 acts on the saved post from its read view; a revision does not offer it.
  async 'hide-belongs-to-the-saved-post'({ open }) {
    const { page } = await open();
    await H.home(page);
    const post = await savedPost(page, '숨길 글', '본문입니다.');
    await revise(page);
    const names = await menuItems(page);
    assert(!names.includes('목록에서 숨기기'), 'a revision cannot hide its editing copy: ' + names.join());
    await close(page);
    await page.locator('.home-post .home-post-open').first().click(); await page.locator('.photo-article').waitFor();
    await H.menu(page, '목록에서 숨기기');
    const rows = await H.stored(page, list => list.length === 1 && list[0].archived === true, 'the saved post itself is hidden');
    assert.deepEqual([rows[0].id, rows[0].status], [post.id, 'saved']);
  },
});

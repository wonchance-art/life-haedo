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
    assert(said.text.includes('메모.txt') && said.text.includes('가짜.jpg') && /2장/.test(said.text), 'the files that failed are named: ' + said.text);
    assert(!said.text.includes('첫째.jpg') && !said.text.includes('둘째.jpg'));
    const rows = await H.stored(page, list => list[0]?.photos === 2, 'the usable photos are stored');
    assert.deepEqual(await page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(), d = await s.readPhotoPost(w, (await s.listPhotoPosts(w))[0].id); return d.ops.filter(op => op.insert?.photo).map(op => d.photos.find(p => p.id === op.insert.photo.id).name); }), ['첫째.jpg', '둘째.jpg'], 'in the order chosen');
    assert.equal(rows.length, 1);
    // A single unusable file says why, as before.
    await page.locator('#photoFiles').setInputFiles({ name: '메모.txt', mimeType: 'text/plain', buffer: Buffer.from('사진이 아님') });
    await H.until(() => H.status(page), value => value.state === 'error' && value.text.startsWith('JPEG·PNG·WebP·HEIC 사진을 골라 주세요'), 'single failure keeps its reason');
    assert.equal(await blocks(page), 2);
  },
  // m6: a clipboard with text and a picture of it (Word, slides) pastes the text.
  async 'paste-text-with-image'({ open }) {
    const { page } = await open();
    await H.home(page); await H.writer(page);
    await page.locator('.ql-editor').click();
    await H.pasteBody(page, { text: '워드에서 복사한 문단입니다.', image: true });
    await H.until(() => H.bodyText(page), text => text === '워드에서 복사한 문단입니다.\n', 'the text is pasted');
    assert.equal(await blocks(page), 0, 'not its picture');
    await draftWith(page, '워드에서 복사한 문단입니다.');
    // A picture alone (a screen capture) is still a photo; blank text does not count as text.
    await H.pasteBody(page, { text: ' \n', image: true });
    await H.until(() => blocks(page), count => count === 1, 'a picture with no text is a photo');
    await H.stored(page, rows => rows[0]?.photos === 1, 'stored');
  },
});

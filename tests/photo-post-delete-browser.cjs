/* Deleting a post from its read view (2026-11-04 owner request: the delete
 * control was only in 글 공개·보관). Real app/IndexedDB/BlogSync against the
 * intercepted fake account cloud; anonymous Auth only, no production account or DB.
 * The read view calls the same BlogSync.deletePost as 글 공개·보관; the server
 * request is asserted here and the real-SQL other-device deletion is covered by
 * blog-completion-browser (PostgreSQL).
 * BASE_URL=http://127.0.0.1:4173 node tests/photo-post-delete-browser.cjs */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { ShareCloud } = require('./life-share-browser.cjs');
const { playwright, ready, makeContext, observe } = require('./unified-home-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const report = { checks: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [] };
const DONE = '글을 삭제했습니다. 다른 기기에서도 삭제됩니다.';

async function seed(page) {
  return page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, m = HaedoLife.PhotoPost, workspaceId = await s.getActive(), ids = [];
    for (const [i, title] of ['지울 산책 기록', '남겨 둘 오후 기록'].entries()) {
      const doc = m.create(c.id, `2026-10-${17 - i}T00:00:00.000Z`);
      doc.title = title; doc.status = 'saved'; doc.ops = [{ insert: '익명의 한글 기록 ' + i + ' 🌱\n' }];
      await s.savePhotoPost(workspaceId, doc, 0); ids.push(doc.id);
    }
    return { workspaceId, ids };
  });
}
const posts = page => page.evaluate(async () => {
  const s = HaedoLife.Shell.storage, w = await s.getActive();
  return (await s.listPhotoPosts(w)).map(row => row.id);
});
async function openPost(page, id) {
  await page.locator(`#homePosts [data-photo-post-id="${id}"] .home-post-open`).click();
  await page.locator('.photo-article').waitFor();
}
async function deleteControl(page) {
  const more = page.locator('.photo-read-actions .photo-more');
  if (!await more.evaluate(node => node.open)) await more.locator(':scope > summary').click();
  const control = page.locator('.photo-read-actions .photo-more-menu').getByRole('button', { name: '삭제', exact: true });
  await control.waitFor();
  return control;
}
const until = async (read, label, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (!(await read())) { if (Date.now() > end) throw new Error('Timed out: ' + label); await new Promise(done => setTimeout(done, 100)); }
};

async function main() {
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, viewport, run, { start = '/index.html', seeded = true } = {}) {
    const server = new ShareCloud(), context = await makeContext(browser, server, 'post-delete-' + report.checks.length, accounts.a, { viewport, hasTouch: true });
    const deletes = [];
    context.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === '/rest/v1/rpc/life_blog_delete' && request.method() === 'POST') deletes.push(request.postDataJSON().p_post_id);
    });
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push(url.origin); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(15000); observe(page, report, name);
    try {
      await page.goto(base + start); await ready(page);
      let refs = null;
      if (seeded) { await page.locator('#homePosts[aria-busy="false"]').waitFor(); refs = await seed(page); await page.reload(); await ready(page); await page.locator('#homePosts[aria-busy="false"]').waitFor(); }
      await run({ page, refs, deletes });
      report.checks.push({ name, pass: true }); console.log('PASS ' + name);
    } catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
    finally { await context.close(); }
  }
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await check(`${viewport.width}: the read view's more menu deletes the post after confirmation, on the server too, and returns to the schedule list`, viewport, async ({ page, refs, deletes }) => {
        const [target, kept] = refs.ids;
        await openPost(page, target);
        // Delete an account-synced post, so the deletion has to reach the server and the other devices.
        await page.locator('#photoServerStatus[data-state="synced"]').waitFor();
        let control = await deleteControl(page);
        const metrics = await page.evaluate(inspect);
        assert.equal(metrics.horizontalOverflow, false);
        for (const key of ['smallTargets', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], key);

        // Cancelling keeps the post and the read view.
        let message = '';
        page.once('dialog', dialog => { message = dialog.message(); dialog.dismiss(); });
        await control.click();
        assert.equal(message, '“지울 산책 기록”을 삭제할까요? 로그인한 모든 기기에서 함께 삭제됩니다.');
        await page.locator('.photo-article').waitFor();
        assert.deepEqual((await posts(page)).sort(), [...refs.ids].sort());
        assert.deepEqual(deletes, []);

        // Confirming deletes only this post, also on the server, and leaves the read view.
        control = await deleteControl(page);
        page.once('dialog', dialog => dialog.accept());
        await control.click();
        await page.locator('#homePosts[aria-busy="false"]').waitFor();
        await page.waitForFunction(id => !document.querySelector(`#homePosts [data-photo-post-id="${id}"]`), target);
        assert.equal(await page.locator('.photo-article').count(), 0);
        assert.equal(await page.locator(`#homePosts [data-photo-post-id="${kept}"]`).count(), 1, 'the other post stays in the list');
        assert.deepEqual(await posts(page), [kept]);
        await until(() => deletes.length > 0, 'server deletion request');
        assert.equal(deletes.length, 1, 'one server deletion');
        await page.waitForFunction(() => document.activeElement?.matches('h1.life-page-title'));
        assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '일정');
        assert.equal((await page.locator('#lifeSaveStatus').textContent()).trim(), DONE);

        // A reload shows the same list: the deletion was stored, not only hidden.
        await page.reload(); await ready(page); await page.locator('#homePosts[aria-busy="false"]').waitFor();
        assert.equal(await page.locator(`#homePosts [data-photo-post-id="${target}"]`).count(), 0);
        assert.deepEqual(await posts(page), [kept]);
      });
    }
    await check('a post changed in another tab is not deleted from a stale read view', { width: 1440, height: 1000 }, async ({ page, refs, deletes }) => {
      const [target] = refs.ids;
      await openPost(page, target);
      const control = await deleteControl(page);
      await page.evaluate(async id => {
        const s = HaedoLife.Shell.storage, w = await s.getActive(), doc = await s.readPhotoPost(w, id);
        doc.title = '다른 탭에서 고친 제목'; await s.savePhotoPost(w, doc, doc.revision);
      }, target);
      report.expectedErrors++;
      page.once('dialog', dialog => dialog.accept());
      await control.click();
      await page.waitForFunction(text => document.querySelector('.photo-status')?.textContent === text,
        '다른 탭이나 기기에서 글이 바뀌어 삭제하지 않았습니다. 글을 다시 연 뒤 삭제해 주세요.');
      assert((await posts(page)).includes(target), 'the changed post is kept');
      assert.deepEqual(deletes, []);
    });
    await check('a post written from 9칸 구성 and deleted from its read view returns to 9칸 and forgets its draft receipt', { width: 1440, height: 1000 }, async ({ page, deletes }) => {
      const kept = await page.evaluate(async () => {
        const s = HaedoLife.Shell.storage, c = HaedoLife.Core, w = await s.getActive();
        const item = (title, creator, type) => ({ ...HaedoLife.NineBoard.snapshot({ type, title, creator, url: '' }), reason: '익명 이유' });
        const nine = await s.readNineBoard(w); nine.format = 'life-nine-board-v2';
        nine.boards.push({ id: 'delete_board', title: '다시 고른 아홉 가지', intro: '', areas: [
          { id: 'delete_area', title: '책과 음악', note: '', items: [item('천천히 읽은 책', '익명 저자', 'book'), item('같이 걷는 노래', '익명 음악가', 'music')] }] });
        await s.saveNineBoard(w, nine, nine.revision);
        const doc = HaedoLife.PhotoPost.create(c.id); doc.title = '남겨 둘 9칸 밖 글'; doc.status = 'saved'; doc.ops = [{ insert: '그대로 남는 글\n' }];
        await s.savePhotoPost(w, doc, 0); return doc.id;
      });
      await page.reload(); await ready(page);
      await page.getByRole('button', { name: '9칸 구성', exact: true }).click(); await page.locator('.nb-status').waitFor();
      await page.locator('.nb-area-nav [data-area-id="delete_area"]').click();
      await page.locator('.nb-files > summary').click(); await page.locator('#nbImageArea').selectOption('delete_area');
      await page.locator('#nbComposeReviewOpen').click(); await page.locator('#nbComposeReview[data-state=ready]').waitFor();
      await page.locator('#nbComposeCreate').click(); await page.locator('#photoTitle').waitFor();
      await page.waitForFunction(() => document.querySelector('.photo-posts')?.getAttribute('aria-busy') === 'false');
      await page.locator('.ql-editor').focus(); await page.keyboard.insertText('본문 ');
      await page.locator('.photo-status').filter({ hasText: '자동 저장됨' }).waitFor();
      await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-read-heading').waitFor();
      await page.locator('#photoServerStatus[data-state="synced"]').waitFor();
      assert.equal(await page.getByRole('button', { name: '9칸 구성으로 돌아가기', exact: true }).count(), 1);
      const control = await deleteControl(page);
      page.once('dialog', dialog => dialog.accept());
      await control.click();
      // Back in 9칸 like its back control, with no receipt pointing at the deleted post.
      await page.locator('.nb-status').waitFor();
      assert.equal(await page.locator('.photo-article').count(), 0);
      assert.equal(await page.locator('#nbComposeOpen').count(), 0, 'the 보관된 초안 열기 receipt is gone');
      await page.waitForFunction(() => document.activeElement && document.activeElement !== document.body);
      await until(() => deletes.length > 0, 'server deletion request'); assert.equal(deletes.length, 1);
      assert.equal((await page.locator('#lifeSaveStatus').textContent()).trim(), DONE);
      assert.deepEqual(await posts(page), [kept], 'only the 9칸 post was deleted');
    }, { start: '/index.html?section=records&view=page', seeded: false });
  } finally { await browser.close(); }
  const failed = report.checks.filter(check => !check.pass).length;
  console.log(JSON.stringify({ passed: report.checks.length - failed, failed, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length }));
  if (failed || report.pageErrors.length || report.external.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });

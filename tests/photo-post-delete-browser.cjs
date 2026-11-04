/* Deleting a post from its read view (2026-11-04 owner request: the delete
 * control was only in 글 공개·보관). Real app/IndexedDB, anonymous intercepted
 * Auth only; no production credentials, account or remote DB.
 * The read view calls the same BlogSync.deletePost as 글 공개·보관, whose server
 * and other-device deletion is covered by blog-completion-browser (PostgreSQL).
 * BASE_URL=http://127.0.0.1:4173 node tests/photo-post-delete-browser.cjs */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { ShareCloud } = require('./life-share-browser.cjs');
const { playwright, ready, makeContext, observe } = require('./unified-home-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const report = { checks: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [] };

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

async function main() {
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, viewport, run) {
    const server = new ShareCloud(), context = await makeContext(browser, server, 'post-delete-' + report.checks.length, accounts.a, { viewport, hasTouch: true });
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push(url.origin); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
    try {
      await page.goto(base + '/index.html'); await ready(page); await page.locator('#homePosts[aria-busy="false"]').waitFor();
      const refs = await seed(page); await page.reload(); await ready(page); await page.locator('#homePosts[aria-busy="false"]').waitFor();
      await run({ page, refs });
      report.checks.push({ name, pass: true }); console.log('PASS ' + name);
    } catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
    finally { await context.close(); }
  }
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await check(`${viewport.width}: the read view's more menu deletes the post after confirmation and returns to the schedule list`, viewport, async ({ page, refs }) => {
        const [target, kept] = refs.ids;
        await openPost(page, target);
        let control = await deleteControl(page);
        const metrics = await page.evaluate(inspect);
        assert.equal(metrics.horizontalOverflow, false);
        for (const key of ['smallTargets', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], key);

        // Cancelling keeps the post and the read view.
        let message = '';
        page.once('dialog', dialog => { message = dialog.message(); dialog.dismiss(); });
        await control.click();
        assert.match(message, /“지울 산책 기록”을 삭제할까요\? 로그인한 모든 기기에서 함께 삭제됩니다\./);
        await page.locator('.photo-article').waitFor();
        assert.deepEqual((await posts(page)).sort(), [...refs.ids].sort());

        // Confirming deletes only this post and leaves the read view.
        control = await deleteControl(page);
        page.once('dialog', dialog => dialog.accept());
        await control.click();
        await page.locator('#homePosts[aria-busy="false"]').waitFor();
        await page.waitForFunction(id => !document.querySelector(`#homePosts [data-photo-post-id="${id}"]`), target);
        assert.equal(await page.locator('.photo-article').count(), 0);
        assert.equal(await page.locator(`#homePosts [data-photo-post-id="${kept}"]`).count(), 1, 'the other post stays in the list');
        assert.deepEqual(await posts(page), [kept]);
        await page.waitForFunction(() => document.activeElement && document.activeElement !== document.body);

        // A reload shows the same list: the deletion was stored, not only hidden.
        await page.reload(); await ready(page); await page.locator('#homePosts[aria-busy="false"]').waitFor();
        assert.equal(await page.locator(`#homePosts [data-photo-post-id="${target}"]`).count(), 0);
        assert.deepEqual(await posts(page), [kept]);
      });
    }
    await check('a post changed in another tab is not deleted from a stale read view', { width: 1440, height: 1000 }, async ({ page, refs }) => {
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
      await page.waitForFunction(() => /바뀌었습니다/.test(document.querySelector('.photo-status')?.textContent || ''));
      assert((await posts(page)).includes(target), 'the changed post is kept');
    });
  } finally { await browser.close(); }
  const failed = report.checks.filter(check => !check.pass).length;
  console.log(JSON.stringify({ passed: report.checks.length - failed, failed, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length }));
  if (failed || report.pageErrors.length || report.external.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });

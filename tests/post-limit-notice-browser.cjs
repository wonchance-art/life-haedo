/* The 200 posts-and-drafts cap, said before it refuses (2026-11-12): the home list (일정, 내 글) shows
 * how many are left from 190 on, and at the cap how many to delete with buttons to the 초안 tab and to
 * the recovery copies kept there; the cap itself (storage photo_post_limit) is unchanged. A deletion
 * the server refused because the post is public is said on the list until 확인. Actual app, IndexedDB
 * and the tests' FakeCloud with synthetic Auth; anonymous posts; 1440px and 390px viewports (a
 * simulation, not Apple hardware).
 *   python3 scripts/dev-server.py --port 4862 &
 *   BASE_URL=http://127.0.0.1:4862 CHROMIUM_PATH=... PW_MODULE_PATH=... node tests/post-limit-notice-browser.cjs
 * Screenshots and report: .local/post-limit-notice/. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4862';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, ready, makeContext, observe, nav } = require('./unified-home-browser.cjs');
const out = path.resolve(__dirname, '../.local/post-limit-notice');
const report = { scope: 'Actual app and IndexedDB, FakeCloud, synthetic Auth, anonymous posts; viewport simulation, not Apple hardware', checks: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [], screenshots: [] };
const homeReady = page => page.waitForFunction(() => document.querySelector('#homePosts')?.getAttribute('aria-busy') === 'false' && !document.querySelector('.home-loading'));
async function openHome(page) { await page.goto(base + '/index.html'); await ready(page); await page.locator('.life-home').waitFor(); await homeReady(page); }

// `saved` saved posts, `drafts` drafts (the first `copies` of them are recovery copies), in the open library.
async function seed(page, { saved = 0, drafts = 0, copies = 0 }) {
  return page.evaluate(async ({ saved, drafts, copies }) => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, m = HaedoLife.PhotoPost, ws = await s.getActive();
    const prefix = HaedoLife.BlogSync.CONFLICT_PREFIX;
    for (let index = 0; index < saved + drafts; index++) {
      const doc = m.create(c.id, new Date(Date.UTC(2026, 9, 1) + index * 60000).toISOString()), draft = index >= saved;
      doc.status = draft ? 'draft' : 'saved';
      doc.title = draft && index - saved < copies ? prefix + '익명 초안 ' + index : (draft ? '익명 초안 ' : '익명 글 ') + index;
      doc.ops = [{ insert: '익명 본문 ' + index + '\n' }];
      await s.savePhotoPost(ws, doc, 0);
    }
    return { ws, count: (await s.listPhotoPosts(ws)).length };
  }, { saved, drafts, copies });
}
const notice = page => page.locator('#homePostList .home-limit:not(.home-delete-refused)');
async function shot(page, name) {
  const file = path.join(out, name + '.png'); await page.screenshot({ path: file, fullPage: false }); report.screenshots.push(file);
}
// A new post started here is refused at the cap, as before this change.
async function newPost(page) {
  return page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, m = HaedoLife.PhotoPost, doc = m.create(HaedoLife.Core.id); doc.title = '한도 확인 새 글'; doc.ops = [{ insert: '본문\n' }];
    try { await s.savePhotoPost(await s.getActive(), doc, 0); return 'stored'; } catch (error) { return error.code; }
  });
}

async function main() {
  await fs.rm(out, { recursive: true, force: true }); await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  async function check(name, run, options = {}) {
    const server = new FakeCloud(), context = await makeContext(browser, server, 'limit-' + report.checks.length, accounts.a, options), page = await context.newPage();
    page.setDefaultTimeout(15000); observe(page, report, name);
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push(url.origin); return route.abort('blockedbyclient'); });
    try { await run(page); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    for (const [width, height] of [[1440, 1000], [390, 844]]) {
      await check(`${width}px: nothing below 190; from 190 the count left; at the cap how many to delete and where`, async page => {
        await openHome(page);
        assert.equal((await seed(page, { saved: 185, drafts: 4 })).count, 189);
        // A 첨부 글 draft (page composer) is not counted by the cap, even with the copies' words in it.
        await page.evaluate(async () => {
          const s = HaedoLife.Shell.storage, w = await s.getActive(), value = await s.readPageDrafts(w), draft = HaedoLife.PagePosts.draft([], HaedoLife.Core.id(), new Date().toISOString());
          draft.body = '첨부 글 초안 · 복구 사본이라는 낱말이 든 메모'; value.posts.push(draft); await s.savePageDrafts(w, value, value.revision);
        });
        await openHome(page); // the list reads 첨부 글 drafts when it opens
        assert.equal(await notice(page).count(), 0, 'below 190: no line');
        await seed(page, { drafts: 1 }); await page.waitForFunction(() => document.querySelector('#homePostList .home-limit'));
        assert.equal(await notice(page).getAttribute('data-home-limit'), 'near');
        assert.equal((await notice(page).locator('.life-meta').innerText()).trim(), '글·초안 190/200개 · 10개 더 저장할 수 있어요.');
        await shot(page, `near-${width}`);
        // 초안 보기 goes to the drafts the cap counts (no 첨부 글 draft); 모든 초안 보기 shows every draft again.
        await notice(page).getByRole('button', { name: '초안 보기', exact: true }).click();
        await page.locator('#homeTab-drafts[aria-selected="true"]').waitFor();
        await page.waitForFunction(() => document.querySelectorAll('#homePostList .home-draft').length === 5);
        assert.deepEqual([...new Set(await page.locator('#homePostList .home-draft').evaluateAll(nodes => nodes.map(node => node.dataset.draftKind)))], ['photo-draft']);
        assert.deepEqual(await notice(page).getByRole('button').allInnerTexts(), ['모든 초안 보기']);
        await notice(page).getByRole('button', { name: '모든 초안 보기', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('#homePostList .home-draft').length === 6);
        assert.equal(await page.locator('#homePostList .home-draft[data-draft-kind="plain-draft"]').count(), 1);
        assert.deepEqual(await notice(page).getByRole('button').allInnerTexts(), ['초안 보기']);
        await page.locator('#homeTab-posts').click(); await page.locator('#homeTab-posts[aria-selected="true"]').waitFor();
        // 199: one left, then the cap with two recovery copies among the drafts.
        await seed(page, { drafts: 7 }); await seed(page, { drafts: 2, copies: 2 });
        await page.waitForFunction(() => document.querySelector('#homePostList .home-limit .life-meta')?.textContent.includes('199/200'));
        assert.equal((await notice(page).locator('.life-meta').innerText()).trim(), '글·초안 199/200개 · 1개 더 저장할 수 있어요.');
        await seed(page, { drafts: 1 });
        await page.waitForFunction(() => document.querySelector('#homePostList .home-limit')?.dataset.homeLimit === 'full');
        assert.equal((await notice(page).locator('.life-meta').innerText()).trim(), '글·초안 200/200개 · 새 글을 저장하려면 쓰지 않는 초안이나 복구 사본을 1개 지워 주세요.');
        assert.deepEqual(await notice(page).getByRole('button').allInnerTexts(), ['초안 보기', '복구 사본 2개 보기']);
        assert.equal(await newPost(page), 'photo_post_limit', 'the cap is unchanged');
        const box = await notice(page).boundingBox(), viewport = page.viewportSize();
        assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1, 'the line fits the width');
        for (const button of await notice(page).getByRole('button').all()) assert.ok((await button.boundingBox()).height >= 44, 'buttons are at least 44px high');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal scroll');
        await shot(page, `full-${width}`);
        // The recovery copies, with the keyboard.
        await notice(page).getByRole('button', { name: '복구 사본 2개 보기', exact: true }).focus(); await page.keyboard.press('Enter');
        await page.locator('#homeTab-drafts[aria-selected="true"]').waitFor();
        await page.waitForFunction(() => document.querySelectorAll('#homePostList .home-draft').length === 2);
        assert.deepEqual((await page.locator('#homePostList .home-draft strong').allInnerTexts()).map(text => text.startsWith('복구 사본 · ')), [true, true]);
        assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('home-draft-open')), true, 'focus moves to the first copy');
        assert.equal(await page.locator('#homePostSearch').inputValue(), '복구 사본');
        assert.equal(await page.locator('#homePostList .home-draft[data-draft-kind="plain-draft"]').count(), 0, 'the 첨부 글 draft with the same words is not one of them');
        assert.deepEqual(await notice(page).getByRole('button').allInnerTexts(), ['초안 보기', '모든 초안 보기']);
        await shot(page, `copies-${width}`);
        // Deleting one makes room again.
        await page.evaluate(async () => {
          const s = HaedoLife.Shell.storage, ws = await s.getActive(), row = (await s.listPhotoPosts(ws)).find(item => item.title.startsWith(HaedoLife.BlogSync.CONFLICT_PREFIX));
          await s.deletePhotoPost(ws, row.id, row.revision);
        });
        await page.waitForFunction(() => document.querySelector('#homePostList .home-limit')?.dataset.homeLimit === 'near');
        assert.equal(await newPost(page), 'stored');
      }, { viewport: { width, height }, ...(width < 760 ? { hasTouch: true, isMobile: true } : {}) });
    }
    await check('a deletion the server refused (public there) is said on the list until 확인', async page => {
      await page.addInitScript(() => {
        // The refusal reaches screens as a BlogSync event (blog-sync.js deleteRemote); a test wrapper
        // hands this list's listener the event the server's refusal produces.
        let wrapped = null;
        Object.defineProperty(window, '__refuse', { value: (event) => { for (const listener of window.__blogListeners || []) listener(event); } });
        document.addEventListener('DOMContentLoaded', () => {
          const life = window.HaedoLife, original = life?.BlogSync; if (!original || wrapped) return;
          wrapped = Object.freeze({ ...original, forStorage(storage) { const real = original.forStorage(storage); if (!real) return real;
            return { ...real, subscribe(listener) { (window.__blogListeners ||= []).push(listener); return real.subscribe(listener); } }; } });
          life.BlogSync = wrapped;
        });
      });
      await openHome(page); const { ws } = await seed(page, { saved: 3 });
      await page.waitForFunction(() => document.querySelectorAll('#homePostList .home-post').length === 3);
      assert.ok(await page.evaluate(() => (window.__blogListeners || []).length > 0), 'the list listens to BlogSync');
      await page.evaluate(id => window.__refuse({ type: 'delete_refused', reason: 'published', workspaceId: crypto.randomUUID(), remoteId: crypto.randomUUID() }), ws);
      await page.waitForTimeout(100);
      assert.equal(await page.locator('.home-delete-refused').count(), 0, 'another library: not this list');
      await page.evaluate(id => window.__refuse({ type: 'delete_refused', reason: 'published', workspaceId: id, remoteId: crypto.randomUUID() }), ws);
      await page.locator('.home-delete-refused').waitFor();
      assert.equal((await page.locator('.home-delete-refused .life-meta').innerText()).trim(), '공개 중인 글이라 서버에서 삭제하지 않았어요. 다음 동기화에서 이 글을 다시 받아요. 공개를 철회한 뒤 삭제해 주세요.');
      assert.match(await page.locator('#homePosts [role="status"][aria-live="polite"]').innerText(), /공개를 철회한 뒤 삭제해 주세요/);
      await shot(page, 'delete-refused-820'); await page.setViewportSize({ width: 390, height: 844 }); await shot(page, 'delete-refused-390');
      await page.locator('#homeTab-drafts').click(); await page.locator('#homeTab-drafts[aria-selected="true"]').waitFor();
      assert.equal(await page.locator('.home-delete-refused').count(), 1, 'kept across tabs until acknowledged');
      await page.locator('.home-delete-refused').getByRole('button', { name: '확인', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.home-delete-refused'));
    });
  } finally {
    await browser.close();
    report.pass = report.checks.length > 0 && report.checks.every(item => item.pass) && !report.consoleErrors.length && !report.pageErrors.length && !report.external.length;
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ pass: report.pass, checks: report.checks.map(item => [item.name, item.pass]), consoleErrors: report.consoleErrors, pageErrors: report.pageErrors, external: report.external }, null, 2));
    if (!report.pass) process.exitCode = 1;
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

/* Libraries above 200 posts and drafts on the home list (일정, 내 글). Rule change (owner decision 10,
 * 2026-11-16): there is no cap, so no line counts toward one. Until then (2026-11-12) the list said from
 * 190 on how many were left and at 200 how many to delete, with buttons to the drafts and the recovery
 * copies, and storage refused the 201st post (these checks asserted that line and photo_post_limit).
 * Now: 250 rows are listed with no such line and the 251st post is stored; a tab of the earlier version
 * (haedo-v220: storage.js, home.js and schedule-ui.js of c76e693 served to that tab only) on the same
 * device lists every post, refuses its own new post with its own message and changes nothing, and its
 * edit reaches this version. A deletion the server refused because the post is public is said on the
 * list until 확인. Actual app, IndexedDB and the tests' FakeCloud with synthetic Auth; anonymous posts;
 * 1440px and 390px viewports (a simulation, not Apple hardware).
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
const { previousFile } = require('./helpers/post-index-previous.cjs');
const out = path.resolve(__dirname, '../.local/post-limit-notice');
const report = { scope: 'Actual app and IndexedDB, FakeCloud, synthetic Auth, anonymous posts; viewport simulation, not Apple hardware', checks: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [], screenshots: [] };
const homeReady = page => page.waitForFunction(() => document.querySelector('#homePosts')?.getAttribute('aria-busy') === 'false' && !document.querySelector('.home-loading'));
async function openHome(page) { await page.goto(base + '/index.html'); await ready(page); await page.locator('.life-home').waitFor(); await homeReady(page); }

// `saved` saved posts, `drafts` drafts (the first `copies` of them are recovery copies), in the open library.
// `wordy`: that many of the plain drafts have the copies' words in their text (not in a copy's title).
async function seed(page, { saved = 0, drafts = 0, copies = 0, wordy = 0 }) {
  return page.evaluate(async ({ saved, drafts, copies, wordy }) => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, m = HaedoLife.PhotoPost, ws = await s.getActive();
    const prefix = HaedoLife.BlogSync.CONFLICT_PREFIX;
    for (let index = 0; index < saved + drafts; index++) {
      const doc = m.create(c.id, new Date(Date.UTC(2026, 9, 1) + index * 60000).toISOString()), draft = index >= saved;
      doc.status = draft ? 'draft' : 'saved';
      doc.title = draft && index - saved < copies ? prefix + '익명 초안 ' + index : (draft ? '익명 초안 ' : '익명 글 ') + index;
      const plain = draft && index - saved >= copies, words = plain && index - saved - copies < wordy;
      doc.ops = [{ insert: (words ? '복구 사본이라는 낱말이 든 익명 본문 ' : '익명 본문 ') + index + '\n' }];
      await s.savePhotoPost(ws, doc, 0);
    }
    return { ws, count: (await s.listPhotoPosts(ws)).length };
  }, { saved, drafts, copies, wordy });
}
const notice = page => page.locator('#homePostList .home-limit:not(.home-delete-refused)');
async function shot(page, name) {
  const file = path.join(out, name + '.png'); await page.screenshot({ path: file, fullPage: false }); report.screenshots.push(file);
}
// A new saved post started here: 'stored', or the refusal's code and message.
async function newPost(page, title = '한도 확인 새 글') {
  return page.evaluate(async title => {
    const s = HaedoLife.Shell.storage, m = HaedoLife.PhotoPost, doc = m.create(HaedoLife.Core.id); doc.title = title; doc.status = 'saved'; doc.ops = [{ insert: '본문\n' }];
    try { await s.savePhotoPost(await s.getActive(), doc, 0); return 'stored'; } catch (error) { return error.code + ': ' + error.message; }
  }, title);
}
const feedback = page => page.locator('#homePosts [role="status"][aria-live="polite"]').innerText().then(text => text.trim());
const docCount = page => page.evaluate(async () => { const s = HaedoLife.Shell.storage; return (await s.listPhotoPosts(await s.getActive())).length; });
// The earlier version's post-list files, served to one tab only.
const PREVIOUS = new Map(['storage.js', 'home.js', 'schedule-ui.js'].map(name => [name, previousFile(name)]));
async function previousTab(context) {
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.route(`${base}/assets/life/*.js`, route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    return PREVIOUS.has(name) ? route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: PREVIOUS.get(name) }) : route.fallback();
  });
  return page;
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
      await check(`${width}px: 250 posts and drafts are listed with no cap line, and the 251st post is stored`, async page => {
        await openHome(page);
        assert.equal((await seed(page, { saved: 240, drafts: 10, copies: 2 })).count, 250);
        await page.waitForFunction(() => document.querySelector('#homePosts [role="status"]')?.textContent.trim() === '글 240개');
        assert.equal(await notice(page).count(), 0, 'no line about a cap');
        assert.equal(await page.locator('#homeTab-drafts').innerText().then(text => text.trim()), '초안 10');
        // The posts tab pages through all of them, 20 at a time.
        for (let shown = 20; shown < 240; shown += 20) await page.locator('#homePostList .home-more').click();
        assert.equal(await page.locator('#homePostList .home-post').count(), 240);
        assert.equal(await page.locator('#homePostList .home-more').count(), 0);
        assert.equal(await newPost(page, '251번째 글'), 'stored');
        await page.waitForFunction(() => document.querySelector('#homePosts [role="status"]')?.textContent.trim() === '글 241개');
        assert.equal(await notice(page).count(), 0);
        assert.equal(await page.locator('#homePostList .home-post', { hasText: '251번째 글' }).count(), 1, 'the new post is listed (first: it was written last)');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal scroll');
        await page.evaluate(() => scrollTo(0, 0)); await shot(page, `posts-250-${width}`);
      }, { viewport: { width, height }, ...(width < 760 ? { hasTouch: true, isMobile: true } : {}) });
    }
    await check('a tab of the earlier version on the same device lists every post, refuses its own new one with its message, and its edit reaches this version', async page => {
      await openHome(page);
      assert.equal((await seed(page, { saved: 205 })).count, 205);
      await page.waitForFunction(() => document.querySelector('#homePosts [role="status"]')?.textContent.trim() === '글 205개');
      const old = await previousTab(page.context()); observe(old, report, 'earlier version tab');
      await openHome(old);
      assert.equal(await old.evaluate(() => typeof HaedoLife.HomeUI.postCapacity), 'function', 'the tab runs the earlier home module');
      await old.waitForFunction(() => document.querySelector('#homePosts [role="status"]')?.textContent.trim() === '글 205개');
      assert.equal((await notice(old).locator('.life-meta').innerText()).trim(), '글·초안 205/200개 · 새 글을 저장하려면 쓰지 않는 글을 6개 지워 주세요.', 'its own line counts every post');
      await shot(old, 'earlier-version-tab');
      // Its own cap: refused with its existing message; nothing is written.
      const before = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, ws = await s.getActive(); return JSON.stringify((await s.listPhotoPosts(ws)).map(row => [row.id, row.revision])); });
      assert.match(await newPost(old, '이전 판의 새 글'), /^photo_post_limit: 글과 초안은 합계 200개까지입니다\./);
      assert.equal(await page.evaluate(async () => { const s = HaedoLife.Shell.storage, ws = await s.getActive(); return JSON.stringify((await s.listPhotoPosts(ws)).map(row => [row.id, row.revision])); }), before, 'a refused save changes nothing');
      // A post that is there is saved (the one seeded last, so first on this version's list); this version's list shows the change.
      const edited = await old.evaluate(async () => {
        const s = HaedoLife.Shell.storage, ws = await s.getActive(), rows = await s.listPhotoPosts(ws), row = rows[rows.length - 1], doc = await s.readPhotoPost(ws, row.id);
        const saved = await s.savePhotoPost(ws, { ...doc, title: '이전 판 탭에서 고친 글', updatedAt: new Date().toISOString() }, doc.revision);
        return { id: saved.id, revision: saved.revision, createdAt: doc.createdAt };
      });
      await page.waitForFunction(() => [...document.querySelectorAll('#homePostList .home-post-open')].some(node => node.textContent === '이전 판 탭에서 고친 글'));
      const mine = await page.evaluate(async id => { const s = HaedoLife.Shell.storage, ws = await s.getActive(); return (await s.listPhotoPosts(ws)).find(row => row.id === id); }, edited.id);
      assert.deepEqual([mine.title, mine.revision, mine.createdAt], ['이전 판 탭에서 고친 글', edited.revision, edited.createdAt]);
      // This version stores a new post; the earlier tab lists it too.
      assert.equal(await newPost(page, '새 판의 206번째 글'), 'stored');
      await old.reload(); await ready(old); await old.locator('.life-home').waitFor(); await homeReady(old);
      await old.waitForFunction(() => document.querySelector('#homePosts [role="status"]')?.textContent.trim() === '글 206개');
      assert.equal(await docCount(page), 206);
      await old.close();
    });
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

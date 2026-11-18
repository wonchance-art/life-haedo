/* Focused home regression journeys: synthetic Auth, real app/IndexedDB/Blobs.
 * npm run dev; PW_MODULE_PATH=/path/to/playwright node tests/home-refinement-browser.cjs
 * No production account, remote persistence or native-device claims.
 */
'use strict';
const { isLegacyLibraryCapabilityRead } = require('./helpers/library-cloud.cjs');
const { isBackgroundSync, isRssInboxRead } = require('./helpers/account-sync-rpcs.cjs'); // Owner directive 2026-11-01: only owner-scoped background sync calls are excluded.
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const { openBlogMenu } = require('./helpers/feature-menus.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { ShareCloud } = require('./life-share-browser.cjs');
const { playwright, ready, nav, makeContext, observe } = require('./unified-home-browser.cjs');
const out = path.resolve('.local/home-refinement/qa');
const report = { rss: [], scope: 'Linux Chromium viewport simulation; anonymous mocked Auth HTTP, real account-scoped IndexedDB and synthetic photo bytes. No live OAuth, native IME, Apple device or deployment evidence.', checks: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, libraryCapabilityReads: [], remoteWrites: [], privateSaves: [], external: [], captures: [] };
const homeReady = page => page.locator('#homePosts[aria-busy="false"]').waitFor();
async function openHome(page) { await page.goto(base + '/index.html'); await ready(page); await homeReady(page); }
async function home(page) { await nav(page, 'home'); await homeReady(page); }
async function instrument(context) {
  await context.route(`${base}/assets/life/storage.js`, async route => {
    const response = await route.fetch();
    const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async readWorkbench(...values){if(window.__refinementFailWorkbench)throw new Error('Anonymous workbench read failure');return actual.readWorkbench(...values);},async readPhotoPost(...values){(window.__refinementPhotoReads ||= []).push(values[1]);{const frame=new Error().stack.split(String.fromCharCode(10)).find(x=>x.includes('/assets/life/')&&!x.includes('/assets/life/storage.js'));if(frame&&frame.includes('/assets/life/home.js'))(window.__refinementHomeReads ||= []).push(values[1]);}return actual.readPhotoPost(...values);}});}});})();`;
    await route.fulfill({ response, body: await response.text() + hook });
  });
}
async function seed(page, photoCount = 6) {
  return page.evaluate(async photoCount => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, m = HaedoLife.PhotoPost, p = HaedoLife.PagePosts, w = HaedoLife.Writing;
    const workspaceId = await s.getActive(), refs = { photos: [] };
    const canvas = document.createElement('canvas'); canvas.width = 72; canvas.height = 48;
    const draw = canvas.getContext('2d'); draw.fillStyle = '#4e7163'; draw.fillRect(0, 0, 72, 48); draw.fillStyle = '#bcd6d9'; draw.fillRect(0, 0, 72, 24);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    for (let i = 0; i < photoCount; i++) {
      const doc = m.create(c.id, `2026-10-${String(17 - i).padStart(2, '0')}T00:00:00.000Z`);
      const image = await m.readPhoto(new File([blob], `anonymous-${i}.png`, { type: 'image/png' }), c.id);
      doc.status = 'saved'; doc.title = '공통낱말 산책 사진 ' + (i + 1);
      doc.photos = [image]; doc.ops = [{ insert: '오래 걸은 날에 남기는 익명의 기록입니다. 🌱\n' }, { insert: { photo: { id: image.id, caption: '익명 합성 풍경 ' + i, alt: '하늘과 초록 들판 ' + i } } }, { insert: '\n' }];
      await s.savePhotoPost(workspaceId, doc, 0); refs.photos.push(doc.id);
    }
    const draft = m.create(c.id, '2026-10-18T00:00:00.000Z'); draft.title = '공통낱말 이어 쓸 초안'; draft.ops = [{ insert: '지금 쓰던 초안의 실제 입력\n' }]; await s.savePhotoPost(workspaceId, draft, 0); refs.draft = draft.id;
    const archived = m.create(c.id, '2026-10-16T10:00:00.000Z'); archived.status = 'saved'; archived.archived = true; archived.title = '공통낱말 보관한 글'; archived.ops = [{ insert: '보관함 검색에서만 읽을 본문\n' }]; await s.savePhotoPost(workspaceId, archived, 0); refs.archived = archived.id;
    const wb = await s.readWorkbench(workspaceId), legacy = p.draft(wb.page.posts || [], c.id(), '2026-10-10T00:00:00.000Z'); legacy.body = '공통낱말 기존 첨부 글\n호환 저장 형식을 유지합니다.';
    wb.page.posts = p.finish((wb.page.posts || []).concat(legacy), legacy.id, '2026-10-10T01:00:00.000Z').posts; refs.legacy = legacy.id;
    wb.page.title = '익명의 산책 기록'; wb.page.intro = '직접 설정한 한글 소개'; wb.page.showIntro = false;
    const bundle = await s.read(workspaceId), own = w.createDraft(bundle); own.title = '공통낱말 직접 쓴 기록'; own.text = '정확한 원문 버전으로 읽는 본문입니다. 🌱';
    const prepared = await w.prepareSave(bundle, own);
    const committed = await s.commitLocal({ workspaceId, baseRevision: bundle.revision, operationId: c.id(), changes: prepared.changes }); assertStored(committed);
    refs.source = prepared.source.id; refs.version = prepared.version.id; refs.sourceText = own.text;
    refs.group = c.id(); wb.groups.push({ id: refs.group, title: '다시 찾을 산책 묶음', versionIds: [refs.version] });
    refs.book = c.id(); refs.chapter = c.id(); wb.books = [{ id: refs.book, title: '보존할 익명 원고', fromYear: '', toYear: '', question: '', chapters: [{ id: refs.chapter, title: '산책의 장', note: '', versionIds: [refs.version] }] }];
    await s.saveWorkbench(workspaceId, wb, wb.revision);
    return refs;
    function assertStored(result) { if (result.status !== 'stored') throw new Error('Anonymous source fixture failed'); }
  }, photoCount);
}
async function populate(page, photoCount) { await openHome(page); const refs = await seed(page, photoCount); await page.reload(); await ready(page); await homeReady(page); return refs; }
async function search(page, text) {
  const input = page.locator('#homePostSearch');
  if (!await input.isVisible()) await page.locator('.home-search-toggle').click();
  await input.fill(text);
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); report.browser = browser.version();
  async function check(name, run, contextOptions = {}) {
    if (process.env.REFINEMENT_TEST_MATCH && !new RegExp(process.env.REFINEMENT_TEST_MATCH).test(name)) return;
    const server = new ShareCloud(), device = 'refinement-' + report.checks.length;
    const context = await makeContext(browser, server, device, accounts.a, { viewport: { width: 320, height: 568 }, hasTouch: true, ...contextOptions }); await instrument(context);

    const rss = { starts: [], reads: [] }, rssWorkspaces = new Map();
    await context.exposeBinding('__recordRssStart', (_source, value) => { rss.starts.push(value); rssWorkspaces.set(value.owner, value.workspaceId); });
    await context.addInitScript(() => {
      if (window !== top) return;
      const documentId = crypto.randomUUID(); window.__rssStartReports = [];
      // Successful owner reveals are counted independently of HTTP requests.
      document.addEventListener('haedo:page-ready', () => { const storage = HaedoLife.Shell.storage;
        __rssStartReports.push(storage.getActive().then(workspaceId => window.__recordRssStart({ documentId, owner: storage.account.userId, workspaceId })));
      });
    });
    await context.route('**/*', route => { const request = route.request(), url = new URL(request.url()); if (url.origin === cloud && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !url.pathname.startsWith('/auth/')) {
      if (isRssInboxRead(request, { cloud, server, ownerId: accounts.a.id, workspaceId: rssWorkspaces.get(accounts.a.id) })) rss.reads.push({ owner: server.libraryOwner(request), path: url.pathname });
      else if (isBackgroundSync(request.url())) (report.backgroundSync ||= []).push({ name, path: url.pathname }); else if (isLegacyLibraryCapabilityRead(request, { cloud, server })) report.libraryCapabilityReads.push({ name, owner: server.libraryOwner(request), method: request.method(), path: url.pathname, parameterCount: 0 });
      else if (url.pathname === '/rest/v1/rpc/life_blog_save' && request.method() === 'POST') report.privateSaves.push({ name, postId: request.postDataJSON().p_post_id });
      else report.remoteWrites.push({ method: request.method(), path: url.pathname });
    } if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push(url.origin); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(15000); observe(page, report, name);
    try { await run(page);
      await page.evaluate(() => Promise.all(window.__rssStartReports || []));
      // The shell defers RSS loading and its first inbox read to an idle callback (timeout 2000 ms)
      // after page-ready, plus the module fetch; a short check can finish before that read leaves.
      // Wait for the read itself instead of assuming it already happened (CI 2026-11-07 run 42385120007).
      for (const deadline = Date.now() + 10000; !rss.reads.length && Date.now() < deadline;) await new Promise(resolve => setTimeout(resolve, 50));
      assert(rss.reads.length > 0); assert(rss.reads.length <= rss.starts.length, 'RSS list reads must not exceed actual app starts');
      report.rss.push({ name, ...rss });
      assert.equal(server.writes().length, 0); assert.equal(server.publicationWrites().length, 0);
      // 2026-11-01: saved posts and drafts reach the owner's private account
      // storage automatically (background sync). They stay private: same
      // owner, never published, and no other write path is used.
      if (name === 'empty home offers one first write and completes private save/read/home') assert(server.saves().length >= 1, 'The explicit saved post reaches the private account');
      assert.equal((report.backgroundSync || []).filter(call => call.name === name && call.path === '/rest/v1/rpc/life_blog_save').length, server.saves().length);
      assert.equal(report.privateSaves.filter(call => call.name === name).length, 0, 'every private save is the owner-scoped background sync');
      assert(server.saves().every(call => call.owner === accounts.a.id));
      // No duplicate private saves: every request is a new operation and each
      // post's server revisions strictly increase (no re-sent or racing save).
      assert.equal(new Set(server.saves().map(call => call.body.p_operation_id)).size, server.saves().length, 'no repeated private save operation');
      const revisions = new Map();
      for (const call of server.saves()) {
        const prior = revisions.get(call.body.p_post_id) ?? -1;
        assert(call.body.p_expected_revision > prior, 'private saves of one post advance strictly: ' + call.body.p_post_id);
        revisions.set(call.body.p_post_id, call.body.p_expected_revision);
      }
      for (const row of server.posts.values()) { assert.equal(row.owner, accounts.a.id); assert.equal(row.publication, null); assert(['saved', 'draft'].includes(row.data.status)); }
      report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(out, `failure-${report.checks.length}.png`), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    await check('empty home offers one first write and completes private save/read/home', async page => {
      await openHome(page);
      assert.equal(await page.locator('.home-list-controls').isVisible(), false);
      const layout = await page.locator('#homeFirstWrite').evaluate(button => ({ y: button.getBoundingClientRect().top, bottom: button.getBoundingClientRect().bottom, profileBottom: document.querySelector('#lifeApp .life-page-title').getBoundingClientRect().bottom, dockTop: document.querySelector('[data-haedo-navigation]').getBoundingClientRect().top, overflow: document.documentElement.scrollWidth > innerWidth }));
      assert(layout.y >= layout.profileBottom); assert(layout.bottom <= layout.dockTop); assert.equal(layout.overflow, false);
      await page.locator('#homeFirstWrite').click(); await page.locator('.ql-editor').waitFor(); await page.waitForFunction(() => document.activeElement?.classList.contains('ql-editor'));
      await page.locator('.ql-editor').fill('첫 문장으로 시작한 비공개 글 🌱'); await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor();
      await page.locator('#photoServerStatus[data-state="synced"]').waitFor();
      assert.match(await page.locator('.photo-article').innerText(), /첫 문장으로 시작한/);
      await page.getByRole('button', { name: '내 글로 돌아가기', exact: true }).click(); await homeReady(page);
      assert.equal(await page.locator('#homePosts .home-post').count(), 1); assert.equal(await page.locator('.home-list-controls').isVisible(), true);
      const row = page.locator('#homePosts .home-post'); assert.match(await row.innerText(), /비공개 원본/); assert.doesNotMatch(await row.innerText(), /이 브라우저에 보관/);
      await row.locator('.home-post-open').click(); await page.locator('.photo-article').waitFor(); assert.match(await page.locator('.photo-article').innerText(), /첫 문장으로 시작한/);
    });
    await check('populated home uses keyboard-operable composer and respects profile intro visibility', async page => {
      await populate(page); assert.equal(await page.locator('#homePosts .home-post').count(), 8);
      assert.equal(await page.locator('#homePosts .home-post-author').count(), 0); assert.equal(await page.locator('.home-blog-description').isVisible(), false);
      for (const node of await page.locator('#homePosts .home-post-meta').all()) assert.match(await node.innerText(), /비공개/);
      assert.equal(await page.locator('#homePosts [data-home-kind="photo"] .home-post-meta').first().innerText().then(text => text.includes('비공개 원본') && !text.includes('이 브라우저')), true);
      // 2026-11-08 S3: the list has no write button of its own; the global 글쓰기 is the one write action.
      assert.equal(await page.locator('.home-blog-write').count(), 0); assert.equal(await page.getByRole('button', { name: '새 글 쓰기', exact: true }).count(), 0);
      const prompt = page.locator('[data-haedo-navigation] [data-haedo-compose]:visible'); assert.equal(await prompt.count(), 1); assert.equal(await page.locator('.home-compose-prompt').count(), 0); assert.equal(await prompt.evaluate(node => node.tagName), 'A'); await prompt.focus(); await page.keyboard.press('Enter');
      await page.locator('.ql-editor').waitFor(); await page.waitForFunction(() => document.activeElement?.classList.contains('ql-editor'));
      await page.getByRole('button', { name: '닫기', exact: true }).click(); await homeReady(page);
      // 프로필 편집 is in the heading's 글 메뉴 (2026-11-08 S3), not on the profile row.
      assert.equal(await page.locator('.home-profile-bar button').count(), 0);
      await openBlogMenu(page); await page.getByRole('button', { name: '프로필 편집', exact: true }).click(); await page.locator('#wbPageTitle').waitFor();
      const toggle = page.locator('#wbShowIntro'); await toggle.check(); await page.getByRole('button', { name: '저장하고 돌아가기', exact: true }).click(); await homeReady(page);
      // Rule change 2026-11-16 노션 방향 (Designer default 2): 노트 has no blog profile row; name, intro, avatar and 소개 표시 live in 글 메뉴 → 프로필 편집. The choice is kept in the profile.
      assert.equal(await page.locator('#lifeHome .home-blog-description').count(), 0);
      assert.deepEqual(await page.evaluate(() => (async () => { const s = HaedoLife.Shell.storage; return (await s.readWorkbench(await s.getActive())).page; })().then(page => [page.intro, page.showIntro])), ['직접 설정한 한글 소개', true]);
    });
    // 2026-11-18 (W2 review m-6): 노트 lost its profile row on 2026-11-16 (Designer default 2), and nothing asserted what
    // 글 메뉴 → 프로필 편집 shows since. It shows the saved 블로그 이름, 소개 and 소개 표시; an edit is saved and shown again; a
    // read that fails says so, changes nothing, and 다시 불러오기 brings the form back with the saved values.
    await check('글 메뉴 → 프로필 편집 shows the saved name, intro and 소개 표시, recovers from a failed read with 다시 불러오기, and saves an edit', async page => {
      await populate(page);
      const saved = () => page.evaluate(() => (async () => { const s = HaedoLife.Shell.storage, profile = (await s.readWorkbench(await s.getActive())).page; return [profile.title, profile.intro, profile.showIntro]; })());
      const shownProfile = async () => [await page.locator('#wbPageTitle').inputValue(), await page.locator('#wbPageIntro').inputValue(), await page.locator('#wbShowIntro').isChecked()];
      const open = async () => { await openBlogMenu(page); await page.getByRole('button', { name: '프로필 편집', exact: true }).click(); await page.locator('#lifeMain[data-mode="page"]').waitFor(); };
      const before = await saved();
      assert.deepEqual(before, ['익명의 산책 기록', '직접 설정한 한글 소개', false], 'the saved profile of the fixture');
      // The read fails (the profile's record has not been read in this page yet): no form, no empty fields to save over the profile.
      await page.evaluate(() => { window.__refinementFailWorkbench = true; });
      await open();
      const retry = page.locator('#lifeMain').getByRole('button', { name: '다시 불러오기', exact: true }); await retry.waitFor();
      assert.match(await page.locator('#lifeMain .life-workbench').innerText(), /구성을 불러오지 못했습니다\. 보관한 원문은 바뀌지 않았습니다\./);
      assert.equal(await page.locator('#wbProfileSettings, #wbPageTitle, #wbPageIntro, #wbShowIntro, #wbProfileDone').count(), 0, 'no profile form after a failed read');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, 'no horizontal overflow');
      await page.evaluate(() => { window.__refinementFailWorkbench = false; });
      assert.deepEqual(await saved(), before, 'the failed read changed nothing');
      await retry.click(); await page.locator('#wbProfileSettings').waitFor();
      // The form: each field is shown, named and holds the saved value.
      assert.equal(await page.locator('#wbProfileSettings').getAttribute('aria-label'), '프로필 편집');
      assert.equal(await page.getByRole('heading', { level: 1, name: '프로필 편집', exact: true }).count(), 1);
      for (const [id, label] of [['wbPageTitle', '블로그 이름'], ['wbPageIntro', '소개'], ['wbShowIntro', '소개 표시']]) {
        const field = page.locator('#' + id); assert.equal(await field.isVisible(), true, label + ' is shown');
        assert.equal(await page.locator('#wbProfileSettings').getByLabel(label, { exact: true }).evaluate(node => node.id), id, label + ' names its field');
      }
      assert.deepEqual(await shownProfile(), before, 'the form shows the saved name, intro and 소개 표시');
      assert.equal(await page.locator('.wb-error:visible, .life-error:visible').count(), 0, 'no error is left after the retry');
      // An edit is saved, and shown again when the screen is opened again.
      await page.locator('#wbPageTitle').fill('고친 익명 블로그'); await page.locator('#wbPageIntro').fill('고친 한글 소개 🌱'); await page.locator('#wbShowIntro').check();
      await page.getByRole('button', { name: '저장하고 돌아가기', exact: true }).click(); await homeReady(page);
      assert.deepEqual(await saved(), ['고친 익명 블로그', '고친 한글 소개 🌱', true]);
      await open(); await page.locator('#wbProfileSettings').waitFor();
      assert.deepEqual(await shownProfile(), ['고친 익명 블로그', '고친 한글 소개 🌱', true], 'the saved edit is shown again');
      // After a reload at the screen's own address too.
      await page.reload(); await ready(page); await page.locator('#wbProfileSettings').waitFor();
      assert.deepEqual(await shownProfile(), await saved(), 'after a reload');
      await page.getByRole('button', { name: '저장하고 돌아가기', exact: true }).click(); await homeReady(page);
      assert.deepEqual(await saved(), ['고친 익명 블로그', '고친 한글 소개 🌱', true], 'leaving without a change keeps the profile');
    });
    await check('search reveals accessibly and preserves exact archived result/tab/query on return', async page => {
      const refs = await populate(page); const toggle = page.locator('.home-search-toggle'), input = page.locator('#homePostSearch');
      assert.equal(await input.isVisible(), false); assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.focus(); await page.keyboard.press('Enter'); await page.waitForFunction(() => document.activeElement?.id === 'homePostSearch'); assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await page.keyboard.press('Escape'); assert.equal(await input.isVisible(), false); assert.equal(await toggle.evaluate(node => node === document.activeElement), true);
      await page.keyboard.press('Enter'); await page.waitForFunction(() => document.activeElement?.id === 'homePostSearch');
      const query = '  공통낱말  '; await input.fill(query); await page.waitForFunction(() => document.querySelectorAll('#homePosts .home-post').length === 8);
      assert.equal(await toggle.getAttribute('aria-label'), '검색어 수정'); await toggle.click(); assert.equal(await input.isVisible(), true); assert.equal(await input.inputValue(), query); assert.equal(await input.evaluate(node => node === document.activeElement), true);
      assert.doesNotMatch(await page.locator('.home-search-scope').innerText(), /글과 초안/);
      await page.locator('#homeTab-drafts').click(); await page.locator('#homePosts .home-draft').waitFor(); assert.equal(await page.locator('#homePosts .home-draft').count(), 1); assert.match(await page.locator('.home-search-scope').innerText(), /초안/); assert.equal(await page.locator('.home-resume').isVisible(), false);
      await page.locator('#homeTab-archive').click(); const row = page.locator(`[data-photo-post-id="${refs.archived}"]`); await row.waitFor(); assert.match(await page.locator('.home-search-scope').innerText(), /숨긴 글/);
      await row.locator('.home-post-open').click(); await page.locator('.photo-article').waitFor(); assert.match(await page.locator('.photo-article').innerText(), /보관함 검색에서만/);
      await page.getByRole('button', { name: '내 글로 돌아가기', exact: true }).click(); await homeReady(page);
      assert.equal(await input.inputValue(), query); assert.equal(await input.isVisible(), true); assert.equal(await page.locator('#homeTab-archive').getAttribute('aria-selected'), 'true');
      await page.waitForFunction(id => document.activeElement?.closest('[data-photo-post-id]')?.dataset.photoPostId === id, refs.archived);
      assert.equal(await page.locator('#homePosts .home-post').count(), 1);
      await page.locator('.home-search-clear').click(); assert.equal(await input.inputValue(), ''); assert.equal(await input.evaluate(node => node === document.activeElement), true);
      await page.keyboard.press('Escape'); assert.equal(await input.isVisible(), false); assert.equal(await toggle.evaluate(node => node === document.activeElement), true);
    });
    await check('draft-only storage keeps its state controls and one resume destination', async page => {
      await openHome(page);
      const id = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, m = HaedoLife.PhotoPost, draft = m.create(HaedoLife.Core.id); draft.title = '유일한 작성 초안'; draft.ops = [{ insert: '이어 쓸 유일한 입력\n' }]; await s.savePhotoPost(await s.getActive(), draft, 0); return draft.id; });
      await page.reload(); await ready(page); await homeReady(page);
      assert.equal(await page.locator('.home-list-controls').isVisible(), true); assert.equal(await page.locator('.home-resume').isVisible(), true);
      await page.locator('#homeTab-drafts').click(); assert.equal(await page.locator('.home-resume').isVisible(), false); assert.equal(await page.locator('#homePosts .home-draft').count(), 1);
      await page.locator(`[data-draft-id="${id}"] .home-draft-open`).click(); await page.locator('.ql-editor').waitFor(); assert.match(await page.locator('.ql-editor').innerText(), /이어 쓸 유일한 입력/);
      await page.getByRole('button', { name: '닫기', exact: true }).click(); await homeReady(page); assert.equal(await page.locator('#homeTab-drafts').getAttribute('aria-selected'), 'true');
    });
    await check('clearing retained search after all posts disappear restores first-write focus', async page => {
      await openHome(page);
      await page.evaluate(async () => { const s = HaedoLife.Shell.storage, c = HaedoLife.Core, p = HaedoLife.PagePosts, workspaceId = await s.getActive(), wb = await s.readWorkbench(workspaceId), post = p.draft([], c.id(), '2026-10-17T00:00:00.000Z'); post.body = '한 편만 남은 검색 대상'; wb.page.posts = p.finish([post], post.id, '2026-10-17T01:00:00.000Z').posts; await s.saveWorkbench(workspaceId, wb, wb.revision); });
      await page.reload(); await ready(page); await homeReady(page); await search(page, '검색 대상'); assert.equal(await page.locator('#homePosts .home-post').count(), 1);
      await nav(page, 'tools');
      await page.evaluate(async () => { const s = HaedoLife.Shell.storage, workspaceId = await s.getActive(), wb = await s.readWorkbench(workspaceId); wb.page.posts = []; await s.saveWorkbench(workspaceId, wb, wb.revision); });
      await home(page); assert.equal(await page.locator('#homePostSearch').inputValue(), '검색 대상'); assert.equal(await page.locator('.home-list-controls').isVisible(), true);
      await page.locator('.home-search-clear').click(); await page.locator('#homeFirstWrite').waitFor();
      assert.equal(await page.locator('.home-list-controls').isVisible(), false); await page.waitForFunction(() => document.activeElement?.id === 'homeFirstWrite');
    });
    await check('every photo card keeps its photo frame, opens from the row, and later covers load on demand', async page => {
      // 2026-11-16: twelve photo posts so that some rows start beyond the 320px look-ahead of a 320×568 screen
      // (W2 note rows are shorter); the premise is asserted. What is measured is the rendering path: a row's cover
      // is read and shown only once the row nears the screen. Storage reads are not counted here, because the
      // account sync (BlogSync) also reads posts it has not uploaded yet, at its own pace (CI 43976093293); reads
      // made by home.js itself are attributed through the call site and must not include rows beyond the look-ahead.
      const refs = await populate(page, 12), lastId = refs.photos[refs.photos.length - 1], last = page.locator(`[data-photo-post-id="${lastId}"]`);
      for (const id of refs.photos) assert.equal(await page.locator(`[data-photo-post-id="${id}"] .home-post-media`).count(), 1);
      const placed = await page.evaluate(ids => ids.map(id => ({ id, top: document.querySelector(`[data-photo-post-id="${id}"] .home-post-media`).getBoundingClientRect().top })), refs.photos);
      const near = placed.filter(row => row.top < 568).map(row => row.id), outside = placed.filter(row => row.top > 568 + 320).map(row => row.id);
      assert(near.length > 0 && outside.length > 0, 'rows both on screen and beyond the look-ahead: ' + JSON.stringify(placed.map(row => Math.round(row.top))));
      const shown = ids => page.evaluate(ids => ids.filter(id => { const image = document.querySelector(`[data-photo-post-id="${id}"] .home-post-cover`); return !!image?.getAttribute('src'); }), ids);
      // The rows on screen show their covers; meanwhile the rows beyond the look-ahead stay without one.
      await page.waitForFunction(ids => ids.every(id => { const image = document.querySelector(`[data-photo-post-id="${id}"] .home-post-cover`); return image?.complete && image.naturalWidth > 0; }), near);
      // Observation window for a negative check: a wrong eager load starts with the observer's first callback, together
      // with the on-screen rows, so it has shown by now; waiting longer only gives a violation more time to appear.
      await page.waitForTimeout(400);
      assert.deepEqual(await shown(outside), [], 'covers beyond the look-ahead are not read or shown at first render');
      assert.deepEqual(await page.evaluate(ids => (window.__refinementHomeReads || []).filter(id => ids.includes(id)), outside), [], 'home reads no record beyond the look-ahead');
      assert((await page.evaluate(() => window.__refinementHomeReads || [])).length > 0, 'home reads are attributed');
      assert.deepEqual(await page.evaluate(ids => ids.map(id => document.querySelector(`[data-photo-post-id="${id}"] .home-post-media`).getAttribute('aria-busy')), outside), outside.map(() => 'true'));
      await last.locator('.home-post-media').scrollIntoViewIfNeeded();
      await page.waitForFunction(id => { const image = document.querySelector(`[data-photo-post-id="${id}"] .home-post-cover`); return image?.complete && image.naturalWidth > 0; }, lastId);
      assert((await page.evaluate(() => window.__refinementPhotoReads)).includes(lastId));
      // Rule change 2026-11-16 노션 방향 (Designer default 3): the photo is shown only, not a second button. The row's
      // title button covers the row, so a press on the photo still opens the post (and nothing else takes the press).
      assert.deepEqual(await last.locator('.home-post-media').evaluate(node => [node.tagName, node.getAttribute('role'), node.tabIndex, node.closest('button')]), ['DIV', null, -1, null]);
      assert.equal(await last.locator('button').count(), 1, 'one button per row: its title');
      // In the middle of the screen, clear of the sticky heading and the tab bar (instant: the root scrolls smoothly).
      await last.locator('.home-post-media').evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const photo = await last.locator('.home-post-media').boundingBox();
      assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.classList.contains('home-post-open'), [photo.x + photo.width / 2, photo.y + photo.height / 2]), true, 'the photo lies under the title button\'s target');
      await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 2); await page.locator('.photo-article').waitFor(); assert.match(await page.locator('.photo-article').innerText(), new RegExp('공통낱말 산책 사진 ' + refs.photos.length + '(?!\\d)'));
    });
    await check('Seoul year boundary shows prior year and correct saved or modified date', async page => {
      await page.clock.setFixedTime(new Date('2026-10-17T12:00:00.000Z')); await openHome(page);
      assert.equal(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'Asia/Seoul');
      const samples = [];
      for (const time of ['2025-12-31T14:59:00.000Z', '2025-12-31T15:01:00.000Z']) {
        await page.clock.setFixedTime(new Date(time));
        samples.push(...await page.evaluate(async time => {
          const s = HaedoLife.Shell.storage, c = HaedoLife.Core, m = HaedoLife.PhotoPost, p = HaedoLife.PagePosts, w = HaedoLife.Writing, workspaceId = await s.getActive();
          // Written earlier, edited at the boundary: its row names the edit date (2026-11-16 notes-menu rule).
          const doc = m.create(c.id, time); doc.createdAt = '2025-11-20T03:00:00.000Z'; doc.title = '서울 연도 경계 사진 글'; doc.status = 'saved'; doc.ops = [{ insert: '경계 시각에 저장한 익명 본문\n' }]; await s.savePhotoPost(workspaceId, doc, 0);
          const wb = await s.readWorkbench(workspaceId), legacy = p.draft(wb.page.posts || [], c.id(), time); legacy.body = '서울 연도 경계 기존 첨부 글'; wb.page.posts = p.finish((wb.page.posts || []).concat(legacy), legacy.id, time).posts; await s.saveWorkbench(workspaceId, wb, wb.revision);
          const bundle = await s.read(workspaceId), draft = w.createDraft(bundle); draft.title = '서울 연도 경계 직접 글'; draft.text = '원문 기반 글의 저장 시각도 서울 기준으로 읽습니다.';
          const prepared = await w.prepareSave(bundle, draft), result = await s.commitLocal({ workspaceId, baseRevision: bundle.revision, operationId: c.id(), changes: prepared.changes }); if (result.status !== 'stored') throw new Error('Date-boundary source fixture failed');
          return [{ selector: '[data-photo-post-id="' + doc.id + '"]', prefix: '수정 ', time, edited: true }, { selector: '[data-post-id="' + legacy.id + '"]', prefix: '수정 ', time }, { selector: '[data-source-id="' + prepared.source.id + '"]', prefix: '저장 ', time }];
        }, time));
      }
      await page.clock.setFixedTime(new Date('2026-10-17T12:00:00.000Z')); await page.reload(); await ready(page); await homeReady(page);
      assert.equal(await page.locator('#homePosts .home-post').count(), 6);
      const observed = [];
      for (const sample of samples) {
        // Rule change (2026-11-16 notes-menu, decision 8): a row's time is when it was first written, under that day's
        // heading; the meta names an edit date only for a row changed on another day. Rows written and saved at the
        // boundary say their Seoul day in the heading and their Seoul time on the row (until then the meta always named
        // the save date); the photo post written earlier still names its boundary edit date in the meta, as before.
        if (!sample.edited) {
          const row = page.locator('#homePosts ' + sample.selector), seoul = sample.time.includes('14:59') ? ['23:59', '2025년 12월 31일 수요일'] : ['00:01', '1월 1일 목요일'];
          assert.deepEqual([await row.locator('.home-row-time').innerText(), await row.evaluate(node => { let n = node.previousElementSibling; while (n && !n.classList.contains('home-day-heading')) n = n.previousElementSibling; return n?.textContent; })], seoul, sample.selector);
          assert.equal(await row.locator('.home-post-meta time').count(), 0, 'no edit date for a row saved the day it was written');
          observed.push({ prefix: sample.prefix.trim(), timestamp: sample.time, visible: seoul.join(' / ') }); continue;
        }
        const time = page.locator('#homePosts ' + sample.selector + ' .home-post-meta time'), text = await time.innerText();
        assert.equal(await time.getAttribute('datetime'), sample.time); assert(text.startsWith(sample.prefix));
        if (sample.time.includes('14:59')) assert.match(text, /2025년\s*12월\s*31일/);
        else { assert.match(text, /1월\s*1일/); assert.doesNotMatch(text, /2025|2026/); }
        assert.match(await time.getAttribute('title'), sample.time.includes('14:59') ? /2025년/ : /2026년/); observed.push({ prefix: sample.prefix.trim(), timestamp: sample.time, visible: text });
      }
      report.dateBoundary = { timezone: 'Asia/Seoul', currentDate: '2026-10-17T12:00:00.000Z', observed };
    }, { timezoneId: 'Asia/Seoul' });
    for (const tab of ['posts', 'drafts', 'archive']) await check(`workbench failure is recoverable from ${tab} and retry reconciles library`, async page => {
      const refs = await populate(page); await nav(page, 'tools'); await page.evaluate(() => { window.__refinementFailWorkbench = true; }); await home(page);
      if (tab !== 'posts') await page.locator('#homeTab-' + tab).click();
      // Rule change 2026-11-16 노션 방향 (Designer default 2): 노트 has no blog profile row; name, intro, avatar and 소개 표시 live in 글 메뉴 → 프로필 편집. The failed read of the blog record is the list's error line on every tab, with its retry.
      assert.equal(await page.locator('#homeFirstWrite').count(), 0); const error = page.locator('.home-posts-error'); await error.waitFor(); assert.match(await error.innerText(), /기존 글을 불러오지 못/);
      assert.equal(await page.locator('#lifeHome :is(.home-profile-status, .home-profile-bar)').count(), 0);
      assert.equal(await page.locator('#homeBooks').count(), 0); assert.equal(await page.locator('#homeGroups').count(), 0);
      await page.evaluate(() => { window.__refinementFailWorkbench = false; }); await error.getByRole('button', { name: '다시 불러오기', exact: true }).click(); await homeReady(page);
      assert.equal(await page.locator('#homeTab-' + tab).getAttribute('aria-selected'), 'true'); assert.equal(await page.locator('.home-posts-error').count(), 0);
      // 2026-11-08 S3: groups and books are 자료's (no list block); the retried read restores the profile.
      assert.equal(await page.locator('.home-library, #homeGroups, #homeBooks').count(), 0);
      assert.equal(await page.evaluate(() => (async () => { const s = HaedoLife.Shell.storage; return (await s.readWorkbench(await s.getActive())).page; })().then(page => page.title)), '익명의 산책 기록');
      if (tab === 'posts') { assert.equal(await page.locator('#homePosts .home-post').count(), 8); await page.locator(`[data-source-id="${refs.source}"][data-version-id="${refs.version}"] .home-post-open`).click(); await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), refs.sourceText); }
    });
  } finally { report.capturedAt = new Date().toISOString(); await browser.close(); await fs.writeFile(path.join(out, process.env.REFINEMENT_REPORT_NAME || (process.env.REFINEMENT_TEST_MATCH ? 'recheck-report.json' : 'browser-report.json')), JSON.stringify(report, null, 2) + '\n'); }
  const failed = report.checks.filter(item => !item.pass).length; console.log(JSON.stringify({ passed: report.checks.length - failed, failed, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, remoteWrites: report.remoteWrites.length }));
  if (failed || report.consoleErrors.length || report.pageErrors.length || report.remoteWrites.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { seed };

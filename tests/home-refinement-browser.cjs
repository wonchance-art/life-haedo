/* Focused home regression journeys: synthetic Auth, real app/IndexedDB/Blobs.
 * npm run dev; PW_MODULE_PATH=/path/to/playwright node tests/home-refinement-browser.cjs
 * No production account, remote persistence or native-device claims.
 */
'use strict';
const { isLegacyLibraryCapabilityRead } = require('./helpers/library-cloud.cjs');
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { ShareCloud } = require('./life-share-browser.cjs');
const { playwright, ready, nav, makeContext, observe } = require('./unified-home-browser.cjs');
const out = path.resolve('.local/home-refinement/qa');
const report = { scope: 'Linux Chromium viewport simulation; anonymous mocked Auth HTTP, real account-scoped IndexedDB and synthetic photo bytes. No live OAuth, native IME, Apple device or deployment evidence.', checks: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, libraryCapabilityReads: [], remoteWrites: [], privateSaves: [], external: [], captures: [] };
const homeReady = page => page.locator('#homePosts[aria-busy="false"]').waitFor();
async function openHome(page) { await page.goto(base + '/index.html'); await ready(page); await homeReady(page); }
async function home(page) { await nav(page, 'home'); await homeReady(page); }
async function instrument(context) {
  await context.route(`${base}/assets/life/storage.js`, async route => {
    const response = await route.fetch();
    const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async readWorkbench(...values){if(window.__refinementFailWorkbench)throw new Error('Anonymous workbench read failure');return actual.readWorkbench(...values);},async readPhotoPost(...values){(window.__refinementPhotoReads ||= []).push(values[1]);return actual.readPhotoPost(...values);}});}});})();`;
    await route.fulfill({ response, body: await response.text() + hook });
  });
}
async function seed(page) {
  return page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, m = HaedoLife.PhotoPost, p = HaedoLife.PagePosts, w = HaedoLife.Writing;
    const workspaceId = await s.getActive(), refs = { photos: [] };
    const canvas = document.createElement('canvas'); canvas.width = 72; canvas.height = 48;
    const draw = canvas.getContext('2d'); draw.fillStyle = '#4e7163'; draw.fillRect(0, 0, 72, 48); draw.fillStyle = '#bcd6d9'; draw.fillRect(0, 0, 72, 24);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    for (let i = 0; i < 6; i++) {
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
  });
}
async function populate(page) { await openHome(page); const refs = await seed(page); await page.reload(); await ready(page); await homeReady(page); return refs; }
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
    await context.route('**/*', route => { const request = route.request(), url = new URL(request.url()); if (url.origin === cloud && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !url.pathname.startsWith('/auth/')) {
      if (isLegacyLibraryCapabilityRead(request, { cloud, server })) report.libraryCapabilityReads.push({ name, owner: server.libraryOwner(request), method: request.method(), path: url.pathname, parameterCount: 0 });
      else if (url.pathname === '/rest/v1/rpc/life_blog_save' && request.method() === 'POST') report.privateSaves.push({ name, postId: request.postDataJSON().p_post_id });
      else report.remoteWrites.push({ method: request.method(), path: url.pathname });
    } if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push(url.origin); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(15000); observe(page, report, name);
    try { await run(page); assert.equal(server.writes().length, 0); assert.equal(server.publicationWrites().length, 0);
      const expected = name === 'empty home offers one first write and completes private save/read/home' ? 1 : 0;
      assert.equal(server.saves().length, expected, 'Only the explicit saved-post journey may store a private server copy');
      assert.equal(report.privateSaves.filter(call => call.name === name).length, expected);
      for (const row of server.posts.values()) { assert.equal(row.owner, accounts.a.id); assert.equal(row.publication, null); assert.equal(row.data.status, 'saved'); }
      report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(out, `failure-${report.checks.length}.png`), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    await check('empty home offers one first write and completes private save/read/home', async page => {
      await openHome(page);
      assert.equal(await page.locator('.home-list-controls').isVisible(), false);
      const layout = await page.locator('#homeFirstWrite').evaluate(button => ({ y: button.getBoundingClientRect().top, bottom: button.getBoundingClientRect().bottom, profileBottom: document.querySelector('.home-profile-bar').getBoundingClientRect().bottom, dockTop: document.querySelector('[data-haedo-navigation]').getBoundingClientRect().top, overflow: document.documentElement.scrollWidth > innerWidth }));
      assert(layout.y >= layout.profileBottom); assert(layout.bottom <= layout.dockTop); assert.equal(layout.overflow, false);
      await page.locator('#homeFirstWrite').click(); await page.locator('.ql-editor').waitFor(); await page.waitForFunction(() => document.activeElement?.classList.contains('ql-editor'));
      await page.locator('.ql-editor').fill('첫 문장으로 시작한 비공개 글 🌱'); await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor();
      await page.locator('#photoServerStatus[data-state="synced"]').waitFor();
      assert.match(await page.locator('.photo-article').innerText(), /첫 문장으로 시작한/);
      await page.getByRole('button', { name: '내 글로 돌아가기', exact: true }).click(); await homeReady(page);
      assert.equal(await page.locator('#homePosts .home-post').count(), 1); assert.equal(await page.locator('.home-list-controls').isVisible(), true);
      const row = page.locator('#homePosts .home-post'); assert.match(await row.innerText(), /비공개/); assert.match(await row.innerText(), /이 브라우저/);
      await row.locator('.home-post-open').click(); await page.locator('.photo-article').waitFor(); assert.match(await page.locator('.photo-article').innerText(), /첫 문장으로 시작한/);
    });
    await check('populated home uses keyboard-operable composer and respects profile intro visibility', async page => {
      await populate(page); assert.equal(await page.locator('#homePosts .home-post').count(), 8);
      assert.equal(await page.locator('#homePosts .home-post-author').count(), 0); assert.equal(await page.locator('.home-blog-description').isVisible(), false);
      for (const node of await page.locator('#homePosts .home-post-meta').all()) assert.match(await node.innerText(), /비공개/);
      assert.match(await page.locator('#homePosts [data-home-kind="photo"] .home-post-meta').first().innerText(), /이 브라우저/);
      const prompt = page.locator('.home-compose-prompt'); assert.equal(await prompt.evaluate(node => node.tagName), 'BUTTON'); await prompt.focus(); await page.keyboard.press('Enter');
      await page.locator('.ql-editor').waitFor(); await page.waitForFunction(() => document.activeElement?.classList.contains('ql-editor'));
      await page.getByRole('button', { name: '닫기', exact: true }).click(); await homeReady(page);
      await page.getByRole('button', { name: '프로필 편집', exact: true }).click(); await page.locator('#wbPageTitle').waitFor();
      const toggle = page.locator('#wbShowIntro'); await toggle.check(); await page.getByRole('button', { name: '저장하고 돌아가기', exact: true }).click(); await homeReady(page);
      assert.equal(await page.locator('.home-blog-description').innerText(), '직접 설정한 한글 소개'); assert.equal(await page.locator('.home-blog-description').isVisible(), true);
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
      await page.locator('#homeTab-archive').click(); const row = page.locator(`[data-photo-post-id="${refs.archived}"]`); await row.waitFor(); assert.match(await page.locator('.home-search-scope').innerText(), /보관/);
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
    await check('every photo card retains an actionable frame and later covers load on demand', async page => {
      const refs = await populate(page), last = page.locator(`[data-photo-post-id="${refs.photos[5]}"]`);
      for (const id of refs.photos) assert.equal(await page.locator(`[data-photo-post-id="${id}"] .home-post-media`).count(), 1);
      const early = await page.evaluate(() => [...new Set(window.__refinementPhotoReads || [])]); assert(early.length < refs.photos.length, 'Offscreen photo records must not all be fetched at first render');
      await last.locator('.home-post-media').scrollIntoViewIfNeeded();
      await page.waitForFunction(id => { const image = document.querySelector(`[data-photo-post-id="${id}"] .home-post-cover`); return image?.complete && image.naturalWidth > 0; }, refs.photos[5]);
      assert((await page.evaluate(() => window.__refinementPhotoReads)).includes(refs.photos[5]));
      await last.locator('.home-post-media').click(); await page.locator('.photo-article').waitFor(); assert.match(await page.locator('.photo-article').innerText(), /공통낱말 산책 사진 6/);
    });
    await check('Seoul year boundary shows prior year and correct saved or modified date', async page => {
      await page.clock.setFixedTime(new Date('2026-10-17T12:00:00.000Z')); await openHome(page);
      assert.equal(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'Asia/Seoul');
      const samples = [];
      for (const time of ['2025-12-31T14:59:00.000Z', '2025-12-31T15:01:00.000Z']) {
        await page.clock.setFixedTime(new Date(time));
        samples.push(...await page.evaluate(async time => {
          const s = HaedoLife.Shell.storage, c = HaedoLife.Core, m = HaedoLife.PhotoPost, p = HaedoLife.PagePosts, w = HaedoLife.Writing, workspaceId = await s.getActive();
          const doc = m.create(c.id, time); doc.title = '서울 연도 경계 사진 글'; doc.status = 'saved'; doc.ops = [{ insert: '경계 시각에 저장한 익명 본문\n' }]; await s.savePhotoPost(workspaceId, doc, 0);
          const wb = await s.readWorkbench(workspaceId), legacy = p.draft(wb.page.posts || [], c.id(), time); legacy.body = '서울 연도 경계 기존 첨부 글'; wb.page.posts = p.finish((wb.page.posts || []).concat(legacy), legacy.id, time).posts; await s.saveWorkbench(workspaceId, wb, wb.revision);
          const bundle = await s.read(workspaceId), draft = w.createDraft(bundle); draft.title = '서울 연도 경계 직접 글'; draft.text = '원문 기반 글의 저장 시각도 서울 기준으로 읽습니다.';
          const prepared = await w.prepareSave(bundle, draft), result = await s.commitLocal({ workspaceId, baseRevision: bundle.revision, operationId: c.id(), changes: prepared.changes }); if (result.status !== 'stored') throw new Error('Date-boundary source fixture failed');
          return [{ selector: '[data-photo-post-id="' + doc.id + '"]', prefix: '수정 ', time }, { selector: '[data-post-id="' + legacy.id + '"]', prefix: '수정 ', time }, { selector: '[data-source-id="' + prepared.source.id + '"]', prefix: '저장 ', time }];
        }, time));
      }
      await page.clock.setFixedTime(new Date('2026-10-17T12:00:00.000Z')); await page.reload(); await ready(page); await homeReady(page);
      assert.equal(await page.locator('#homePosts .home-post').count(), 6);
      const observed = [];
      for (const sample of samples) {
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
      assert.equal(await page.locator('#homeFirstWrite').count(), 0); const error = page.locator('.home-profile-status'); await error.waitFor(); assert.match(await error.innerText(), /불러오지 못/);
      assert.equal(await page.locator('#homeBooks').count(), 0); assert.equal(await page.locator('#homeGroups').count(), 0);
      await page.evaluate(() => { window.__refinementFailWorkbench = false; }); await error.getByRole('button', { name: '프로필 다시 불러오기', exact: true }).click(); await homeReady(page);
      assert.equal(await page.locator('#homeTab-' + tab).getAttribute('aria-selected'), 'true'); assert.equal(await page.locator('.home-posts-error').count(), 0);
      const library = page.locator('.home-library'); if (!await library.evaluate(node => node.open)) await library.locator(':scope > summary').click();
      assert.equal(await page.locator('#homeGroups [data-group-id="' + refs.group + '"]').count(), 1); assert.equal(await page.locator('#homeBooks [data-book-id="' + refs.book + '"]').count(), 1);
      assert.match(await page.locator('#homeBooks').innerText(), /1개 장/); assert.match(await page.locator('.home-profile-bar').innerText(), /익명의 산책 기록/);
      if (tab === 'posts') { assert.equal(await page.locator('#homePosts .home-post').count(), 8); await page.locator(`[data-source-id="${refs.source}"][data-version-id="${refs.version}"] .home-post-open`).click(); await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), refs.sourceText); }
    });
  } finally { report.capturedAt = new Date().toISOString(); await browser.close(); await fs.writeFile(path.join(out, process.env.REFINEMENT_REPORT_NAME || (process.env.REFINEMENT_TEST_MATCH ? 'recheck-report.json' : 'browser-report.json')), JSON.stringify(report, null, 2) + '\n'); }
  const failed = report.checks.filter(item => !item.pass).length; console.log(JSON.stringify({ passed: report.checks.length - failed, failed, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, remoteWrites: report.remoteWrites.length }));
  if (failed || report.consoleErrors.length || report.pageErrors.length || report.remoteWrites.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { seed };

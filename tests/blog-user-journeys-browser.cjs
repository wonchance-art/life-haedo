/* User tasks through the real app/SDK/IndexedDB; intercepted anonymous HTTP
 * Auth only. No production credentials, DB, account or native-device claims.
 * JOURNEY_PHASE=before BASE_URL=http://127.0.0.1:4175 node tests/blog-user-journeys-browser.cjs
 * BASE_URL=http://127.0.0.1:4173 node tests/blog-user-journeys-browser.cjs
 */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { ShareCloud } = require('./life-share-browser.cjs');
const { playwright, ready, shellReady, settle, makeContext, observe, nav } = require('./unified-home-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const phase = process.env.JOURNEY_PHASE || 'after';
assert(['before', 'after'].includes(phase));
const out = path.resolve('.local/blog-journeys', phase);
const sizes = [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }];
const report = { phase, createdAt: new Date().toISOString(), scope: 'Linux Chromium simulated viewports/touch, actual app and account-scoped IndexedDB; anonymous intercepted Auth/share HTTP. No live OAuth/remote DB, native IME, Apple hardware, PWA or deployment evidence.', checks: [], visual: [], qualityFailures: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [] };
async function instrumentStorage(context) {
  await context.route(`${base}/assets/life/storage.js`, async route => {
    const response = await route.fetch();
    const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async readWorkbench(...values){if(window.__journeyFailWorkbench)throw new Error('Anonymous workbench read failure');return actual.readWorkbench(...values);},async readPhotoPost(...values){if(window.__journeyFailPhoto===values[1])throw new Error('Anonymous individual document read failure');return actual.readPhotoPost(...values);},async listPhotoPosts(...values){if(window.__journeyFailList)throw new Error('Anonymous list read failure');const value=await actual.listPhotoPosts(...values);if(window.__journeyHoldList){window.__journeyHeldList=true;await new Promise(resolve=>window.__journeyReleaseList=()=>{window.__journeyHoldList=false;resolve();});}return value;}});}});})();`;
    await route.fulfill({ response, body: await response.text() + hook });
  });
}
async function home(page) {
  await nav(page, 'home'); await page.locator('#homePosts[aria-busy="false"]').waitFor();
}
async function openHome(page) { await page.goto(base + '/index.html'); await ready(page); await page.locator('#homePosts[aria-busy="false"]').waitFor(); }
async function snap(page, scene) {
  if (process.env.JOURNEY_NO_SNAP) return;
  for (const size of sizes) {
    await page.setViewportSize(size); await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.querySelectorAll('.home-post-cover,.photo-read-image,.photo-block img')].filter(image => image.getAttribute('src') && image.checkVisibility({ visibilityProperty: true })).every(image => image.complete && image.naturalWidth > 0));
    await page.evaluate(() => { for (const animation of document.getAnimations()) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish(); document.activeElement?.blur(); scrollTo({ top: 0, behavior: 'instant' }); });
    await page.mouse.move(size.width - 1, 0);
    const metrics = await page.evaluate(inspect), file = `${scene}-${size.width}.png`;
    if (phase === 'after' && scene === 'writing' && size.width <= 760) assert.equal(await page.locator('[data-haedo-navigation]').isVisible(), false, 'Writing hides mobile global navigation');
    await page.screenshot({ path: path.join(out, file), fullPage: true }); report.visual.push({ scene, file, ...metrics });
    if (phase === 'after') {
      if (metrics.horizontalOverflow) report.qualityFailures.push({ scene, width: size.width, check: 'horizontalOverflow' });
      for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) if (metrics[key].length) report.qualityFailures.push({ scene, width: size.width, check: key, details: metrics[key] });
    }
  }
}
async function seed(page, count = 3) {
  return page.evaluate(async count => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, m = HaedoLife.PhotoPost, workspaceId = await s.getActive(), ids = [];
    for (let i = 0; i < count; i++) {
      const doc = m.create(c.id, `2026-10-${String(17 - Math.min(i, 16)).padStart(2, '0')}T00:00:00.000Z`);
      doc.title = ['산책에서 발견한 문장', '제목 없이 시작하는 하루', '오래된 글도 같은 목록에서'][i % 3] + (i >= 3 ? ' ' + i : '');
      doc.status = 'saved'; doc.ops = [{ insert: '걷다가 잠시 멈췄다. 익숙한 길에서 생각을 글로 남긴다.\n\n다시 읽고 싶은 익명의 한글 기록 ' + i + ' 🌱\n' }];
      await s.savePhotoPost(workspaceId, doc, 0); ids.push(doc.id);
    }
    const wb = await s.readWorkbench(workspaceId); wb.page.title = '느린 오후의 기록'; wb.page.intro = '걷고, 읽고, 내 말로 남깁니다.'; wb.page.showIntro = true;
    await s.saveWorkbench(workspaceId, wb, wb.revision);
    return { workspaceId, ids };
  }, count);
}
async function seedMixed(page) {
  return page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, p = HaedoLife.PagePosts, m = HaedoLife.PhotoPost, w = HaedoLife.Writing, workspaceId = await s.getActive();
    const refs = { workspaceId };
    const photo = m.create(c.id, '2026-10-17T00:00:00.000Z'); photo.status = 'saved'; photo.title = '세 형식 공통검색 사진 글'; photo.ops = [{ insert: '로컬 리치 형식의 실제 본문입니다.\n' }];
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800; const draw = canvas.getContext('2d'), gradient = draw.createLinearGradient(0, 0, 1200, 800); gradient.addColorStop(0, '#c6d8db'); gradient.addColorStop(.55, '#e3cbb0'); gradient.addColorStop(1, '#556e63'); draw.fillStyle = gradient; draw.fillRect(0, 0, 1200, 800); draw.fillStyle = '#e7d4aa'; draw.beginPath(); draw.moveTo(420, 800); draw.lineTo(730, 280); draw.lineTo(780, 280); draw.lineTo(750, 800); draw.fill();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9)), image = await m.readPhoto(new File([blob], 'anonymous-path.jpg', { type: blob.type }), c.id); photo.photos = [image]; photo.ops.push({ insert: { photo: { id: image.id, caption: '검증용으로 그린 익명 산책길', alt: '청록색 하늘 아래 산책길을 그린 합성 이미지' } } }, { insert: '\n' });
    refs.photo = (await s.savePhotoPost(workspaceId, photo, 0)).id || photo.id; refs.imageDigest = image.digest;
    const draft = m.create(c.id, '2026-10-17T01:00:00.000Z'); draft.title = '이어 쓸 실제 사진 초안'; draft.ops = [{ insert: '초안 탭에서만 열어야 할 입력\n' }]; await s.savePhotoPost(workspaceId, draft, 0); refs.photoDraft = draft.id;
    const archived = m.create(c.id, '2026-10-16T00:00:00.000Z'); archived.status = 'saved'; archived.archived = true; archived.title = '보관함에만 남긴 실제 글'; archived.ops = [{ insert: '일반 글 검색에 나오지 않는 보관 글\n' }]; await s.savePhotoPost(workspaceId, archived, 0); refs.archived = archived.id;
    const wb = await s.readWorkbench(workspaceId), legacy = p.draft(wb.page.posts || [], c.id(), '2026-10-15T00:00:00.000Z'); legacy.body = '세 형식 공통검색 기존 첨부 글\n본문과 대상은 기존 저장 형식을 유지합니다.';
    wb.page.posts = p.finish((wb.page.posts || []).concat(legacy), legacy.id, '2026-10-15T01:00:00.000Z').posts; await s.saveWorkbench(workspaceId, wb, wb.revision); refs.legacy = legacy.id;
    const pd = await s.readPageDrafts(workspaceId), legacyDraft = p.draft(wb.page.posts, c.id(), '2026-10-15T02:00:00.000Z'); legacyDraft.body = '이어 쓸 실제 첨부 초안'; pd.posts.push(legacyDraft); await s.savePageDrafts(workspaceId, pd, pd.revision); refs.legacyDraft = legacyDraft.id;
    let bundle = await s.read(workspaceId), own = w.createDraft(bundle); own.title = '세 형식 공통검색 직접 쓴 원문'; own.text = '원문 기반 글의 정확한 버전을 읽습니다. 🌱\n원본 UTF16 범위를 유지합니다.';
    const result = await w.prepareSave(bundle, own); const committed = await s.commitLocal({ workspaceId, baseRevision: bundle.revision, operationId: c.id(), changes: result.changes }); if (committed.status !== 'stored') throw new Error('Own writing fixture failed'); refs.source = result.source.id; refs.version = result.version.id; refs.sourceText = own.text;
    bundle = await s.read(workspaceId); const stage = w.createDraft(bundle); stage.title = '이어 쓸 실제 직접 글 초안'; stage.text = '직접 글 작성기의 원래 입력'; refs.writingDraft = (await s.saveStage(stage)).stageId;
    const foreign = await c.prepareImport({ origin: 'obsidian', title: '공통검색 가져온 내 메모는 블로그 글 아님', text: 'authorRelation self만으로 직접 쓴 글로 편입하지 않는다.', authorRelation: 'self', forceSeparate: true }, bundle);
    await s.commitLocal({ workspaceId, baseRevision: bundle.revision, operationId: c.id(), changes: c.buildImportChanges(bundle, foreign, []) }); refs.imported = foreign.source.id;
    return refs;
  });
}
async function documents(page) { return page.evaluate(async () => { const s = HaedoLife.Shell.storage, workspaceId = await s.getActive(); return { workspaceId, docs: await Promise.all((await s.listPhotoPosts(workspaceId)).map(row => s.readPhotoPost(workspaceId, row.id))) }; }); }
async function assertPostCommitLibraryReturn(page, destination = 'import') {
  const library = page.locator('.home-library');
  if (!await library.evaluate(node => node.open)) await library.locator(':scope > summary').click();
  const entry = page.locator('[data-home-destination="' + destination + '"]');
  await entry.scrollIntoViewIfNeeded(); await entry.focus();
  const origin = await entry.evaluate(node => ({ key: node.dataset.focusKey, scrollY }));
  await entry.click(); await settle(page); assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), destination);
  await page.locator('#lifeSubviewReturn').click(); await page.locator('#homePosts[aria-busy="false"]').waitFor();
  await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, origin.key);
  await page.waitForFunction(top => Math.abs(scrollY - top) < 2, origin.scrollY);
  assert.equal(await page.locator('.home-library').evaluate(node => node.open), true);
  return { destination, focusKey: origin.key, scrollY: origin.scrollY, restoredScrollY: await page.evaluate(() => scrollY) };
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); report.browser = browser.version();
  async function check(name, run, seedAccount = accounts.a) {
    if (process.env.JOURNEY_TEST_MATCH && !new RegExp(process.env.JOURNEY_TEST_MATCH).test(name)) return;
    const server = new ShareCloud(), device = 'journey-' + report.checks.length, context = await makeContext(browser, server, device, seedAccount, { viewport: sizes[0], hasTouch: true });
    await instrumentStorage(context);
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push(url.origin); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
    try { await run({ page, context, server, device }); assert.equal(server.writes().length, 0); assert.equal(server.publicationWrites().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(out, `failure-${report.checks.length}.png`), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    if (phase === 'after') {
      await check('first write starts in body, saves a titleless private post, reads and returns to the exact saved row', async ({ page, server, device }) => {
        await page.goto(base + '/index.html'); await shellReady(page);
        assert.deepEqual(await page.evaluate(() => __homeDbOpens), []); await snap(page, 'public');
        server.oauthAccounts.set(device, accounts.a);
        await page.locator('[data-life-login="compose"]').click(); await page.locator('#googleLogin').click();
        await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page); await page.locator('.ql-editor').waitFor();
        await page.waitForFunction(() => document.activeElement?.classList.contains('ql-editor')); assert.equal(new URL(page.url()).searchParams.has('compose'), false); assert((await page.evaluate(() => __homeDbOpens)).every(item => item.verified));
        assert.equal(await page.locator('#photoTitle').inputValue(), '');
        const text = '제목을 짓지 않아도 한 문장부터 남깁니다. 🌱'; await page.locator('.ql-editor').fill(text); await snap(page, 'writing');
        await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor();
        assert.match(await page.locator('.photo-article').innerText(), /제목을 짓지 않아도/);
        assert.doesNotMatch(await page.locator('.photo-article').innerText(), /제목 없는 글/);
        assert.match(await page.locator('.photo-status').innerText(), /비공개 글을 저장했어요/);
        const data = await documents(page), saved = data.docs.find(doc => doc.status === 'saved'); assert(saved); assert.equal(saved.title, ''); assert(saved.ops.some(op => typeof op.insert === 'string' && op.insert.includes(text)));
        await snap(page, 'titleless-reading'); await page.getByRole('button', { name: '내 글로 돌아가기', exact: true }).click(); await page.locator('#homePosts[aria-busy="false"]').waitFor();
        const row = page.locator(`#homePosts [data-photo-post-id="${saved.id}"]`); assert.equal(await row.count(), 1); assert.doesNotMatch(await row.innerText(), /제목 없는 글/);
        await row.locator('.home-post-open').click(); await page.locator('.photo-article').waitFor(); assert.match(await page.locator('.photo-article').innerText(), /제목을 짓지 않아도/);
        await page.getByRole('button', { name: '내 글로 돌아가기', exact: true }).click(); await page.locator('#homePosts[aria-busy="false"]').waitFor();
        await assertPostCommitLibraryReturn(page);
      }, null);
      await check('one searchable list retains all three formats, real drafts and archive without importing self-labelled sources', async ({ page }) => {
        await openHome(page); const refs = await seedMixed(page); await page.reload(); await ready(page); await home(page);
        const posts = page.locator('#homePosts .home-post'); assert.equal(await posts.count(), 3);
        assert.equal(await page.locator(`#homePosts [data-source-id="${refs.imported}"]`).count(), 0);
        await page.locator('#homePostSearch').fill('세 형식 공통검색'); await page.waitForFunction(() => document.querySelectorAll('#homePosts .home-post').length === 3);
        await snap(page, 'home');
        await page.locator(`#homePosts [data-source-id="${refs.source}"][data-version-id="${refs.version}"] .home-post-open`).click(); await settle(page);
        assert.equal(await page.locator('#lifeSourceText').textContent(), refs.sourceText);
        await page.locator('#lifeSearchReturn').click(); await page.locator('#homePosts[aria-busy="false"]').waitFor();
        assert.equal(await page.locator('#homePostSearch').inputValue(), '세 형식 공통검색');
        await page.locator('#homePostSearch').fill(''); await page.locator('#homeTab-drafts').click(); await page.locator('#homePosts[aria-busy="false"]').waitFor();
        assert.equal(await page.locator('#homePosts .home-draft').count(), 3);
        for (const kind of ['photo-draft', 'plain-draft', 'source-draft']) assert.equal(await page.locator(`#homePosts [data-draft-kind="${kind}"]`).count(), 1);
        await snap(page, 'drafts'); await page.locator(`[data-draft-id="${refs.photoDraft}"] .home-draft-open`).click(); await page.locator('.ql-editor').waitFor(); assert.equal(await page.locator('#photoTitle').inputValue(), '이어 쓸 실제 사진 초안');
        await page.locator('.ql-editor').fill('이어 쓴 실제 초안 내용'); await page.getByRole('button', { name: '닫기', exact: true }).click(); await page.locator('#homePosts[aria-busy="false"]').waitFor();
        assert.equal(await page.locator('#homeTab-drafts').getAttribute('aria-selected'), 'true');
        assert.equal((await documents(page)).docs.find(doc => doc.id === refs.photoDraft).status, 'draft');
        await page.locator('#homeTab-archive').click(); await page.locator('#homePosts[aria-busy="false"]').waitFor();
        assert.equal(await page.locator('#homePosts .home-post').count(), 1); assert.equal(await page.locator(`[data-photo-post-id="${refs.archived}"]`).count(), 1); await snap(page, 'archive');
        await page.locator('#homeTab-posts').click(); await page.locator('#homePosts[aria-busy="false"]').waitFor(); await page.locator('#homePostSearch').fill('보관함에만');
        await page.waitForFunction(() => document.querySelectorAll('#homePosts .home-post').length === 0);
      });
      await check('legacy posts edit through their original composer and profile edits return to the same filtered home', async ({ page }) => {
        await openHome(page); const refs = await seedMixed(page); await page.reload(); await ready(page); await home(page);
        await page.locator('#homePostSearch').fill('세 형식 공통검색'); await page.waitForFunction(() => document.querySelectorAll('#homePosts .home-post').length === 3);
        await page.locator(`[data-post-id="${refs.legacy}"] .home-post-open`).click(); await page.locator('.pp-post').waitFor();
        assert.equal(await page.locator('.photo-editor').count(), 0); await page.getByRole('button', { name: '글 수정', exact: true }).click(); await page.locator('#ppBody').waitFor();
        await page.locator('#ppBody').fill('세 형식 공통검색 기존 첨부 글 — 실제 수정\n이전 형식으로 저장된 본문을 수정합니다.');
        await page.locator('.pp-composer').getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('#ppBody').waitFor({ state: 'detached' });
        await page.getByRole('button', { name: '내 글로 돌아가기', exact: true }).last().click(); await page.locator('#homePosts[aria-busy="false"]').waitFor();
        assert.equal(await page.locator('#homePostSearch').inputValue(), '세 형식 공통검색'); assert.match(await page.locator(`[data-post-id="${refs.legacy}"]`).innerText(), /실제 수정/);
        await page.locator('.home-profile-open').first().click(); await page.locator('#wbPageTitle').waitFor();
        assert.equal(await page.locator('.wb-post-feed').count(), 0, 'Profile editing must not mount a second private post list');
        await page.locator('#wbPageTitle').fill('새 이름으로 이어 쓰는 블로그'); await page.locator('#wbPageIntro').fill('목록을 벗어나지 않고 소개를 정돈합니다.'); await snap(page, 'profile');
        await page.getByRole('button', { name: '저장하고 돌아가기', exact: true }).click(); await page.locator('#homePosts[aria-busy="false"]').waitFor();
        assert.equal(await page.locator('#homePostSearch').inputValue(), '세 형식 공통검색'); assert.match(await page.locator('.home-profile-bar').innerText(), /새 이름으로 이어 쓰는 블로그/);
        assert.equal((await documents(page)).docs.find(doc => doc.id === refs.photo).title, '세 형식 공통검색 사진 글');
      });
      await check('search and expanded range survive reading and save while Korean composition keeps the current search', async ({ page }) => {
        await openHome(page); await seed(page, 27); await page.reload(); await ready(page); await home(page);
        assert.equal(await page.locator('#homePosts .home-post').count(), 20);
        await page.getByRole('button', { name: '글 20개 더 보기', exact: true }).click(); assert.equal(await page.locator('#homePosts .home-post').count(), 27);
        await page.locator('#homePosts .home-post').nth(25).locator('.home-post-open').click(); await page.locator('.photo-article').waitFor(); await page.getByRole('button', { name: '내 글로 돌아가기', exact: true }).click(); await page.locator('#homePosts[aria-busy="false"]').waitFor(); assert.equal(await page.locator('#homePosts .home-post').count(), 27);
        const query = page.locator('#homePostSearch'); await query.fill('오래된 글도'); await page.waitForFunction(() => document.querySelectorAll('#homePosts .home-post').length === 9);
        await query.dispatchEvent('compositionstart'); await query.fill('아직 조합 중인 검색');
        assert.equal(await page.locator('#homePosts .home-post').count(), 9, 'Composition must not erase the existing reading results');
        await query.dispatchEvent('compositionend', { data: '검색' }); await page.waitForFunction(() => document.querySelectorAll('#homePosts .home-post').length === 0);
        await query.fill('오래된 글도'); await page.waitForFunction(() => document.querySelectorAll('#homePosts .home-post').length === 9);
        const row = page.locator('#homePosts .home-post').nth(6), id = await row.getAttribute('data-photo-post-id'); await row.locator('.home-post-open').click(); await page.locator('.photo-article').waitFor();
        await page.getByRole('button', { name: '글 수정', exact: true }).click(); await page.locator('.ql-editor').waitFor(); await page.locator('.ql-editor').fill('검색 문맥을 유지하며 다시 저장한 본문');
        await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor(); await page.getByRole('button', { name: '내 글로 돌아가기', exact: true }).click(); await page.locator('#homePosts[aria-busy="false"]').waitFor();
        assert.equal(await query.inputValue(), '오래된 글도'); assert.equal(await page.locator('#homeTab-posts').getAttribute('aria-selected'), 'true'); assert.equal(await page.locator('#homePosts .home-post').count(), 9);
        const storedEdit = (await documents(page)).docs.find(doc => doc.status === 'saved' && doc.ops.some(op => typeof op.insert === 'string' && op.insert.includes('검색 문맥을 유지하며 다시 저장한 본문'))); assert(storedEdit);
        const visible = await page.locator(`#homePosts [data-photo-post-id="${storedEdit.id}"]`).evaluate(node => { const box = node.getBoundingClientRect(); return box.bottom > 0 && box.top < innerHeight; }); assert(visible, 'The just-saved matching row must remain visible after its sort position changes');
        await query.fill(''); await page.waitForFunction(() => document.querySelectorAll('#homePosts .home-post').length === 20);
      });
      await check('saving a post outside the current search keeps the query until an explicit reveal action', async ({ page }) => {
        await openHome(page); const sample = await seed(page, 1); await page.reload(); await ready(page); await home(page);
        await page.locator('#homePostSearch').fill('산책에서'); await page.locator(`#homePosts [data-photo-post-id="${sample.ids[0]}"] .home-post-open`).click(); await page.locator('.photo-article').waitFor();
        await page.getByRole('button', { name: '글 수정', exact: true }).click(); await page.locator('#photoTitle').fill('완전히 다른 제목으로 바꾼 글'); await page.locator('.ql-editor').fill('본문의 검색어도 명시적으로 고쳤습니다.');
        await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor(); await page.getByRole('button', { name: '내 글로 돌아가기', exact: true }).click(); await page.locator('#homePosts[aria-busy="false"]').waitFor();
        assert.equal(await page.locator('#homePostSearch').inputValue(), '산책에서'); assert.equal(await page.locator('#homePosts .home-post').count(), 0);
        const reveal = page.getByRole('button', { name: '검색어 지우고 저장한 글 보기', exact: true }); await reveal.waitFor(); await reveal.click();
        assert.equal(await page.locator('#homePostSearch').inputValue(), ''); assert.equal(await page.locator('#homePosts .home-post').count(), 1); assert.match(await page.locator('#homePosts .home-post').innerText(), /완전히 다른 제목/);
      });
      await check('partial storage failures preserve readable formats and never claim an empty blog', async ({ page }) => {
        await openHome(page); const refs = await seedMixed(page); await page.reload(); await ready(page); await nav(page, 'tools');
        await page.evaluate(() => { window.__journeyFailWorkbench = true; }); await home(page);
        assert.equal(await page.locator(`[data-photo-post-id="${refs.photo}"]`).count(), 1); assert.equal(await page.locator(`#homePosts [data-source-id="${refs.source}"]`).count(), 1);
        assert.equal(await page.locator('#homeFirstWrite').count(), 0); assert.match(await page.locator('#homePosts').innerText(), /다시|실패|못/); await snap(page, 'partial-failure');
        await page.evaluate(() => { window.__journeyFailWorkbench = false; }); await page.locator('#homePosts').getByRole('button', { name: /다시/ }).first().click(); await page.locator(`[data-post-id="${refs.legacy}"]`).waitFor();
        await nav(page, 'tools'); await page.evaluate(() => { window.__journeyFailList = true; }); await home(page);
        assert.equal(await page.locator(`#homePosts [data-source-id="${refs.source}"]`).count(), 1); assert.equal(await page.locator(`[data-post-id="${refs.legacy}"]`).count(), 1); assert.equal(await page.locator('#homeFirstWrite').count(), 0);
        await page.locator('#homePostSearch').fill('no matching result'); assert.equal(await page.locator('#homePosts .home-first-post').count(), 0, 'An incomplete search must not claim no matches'); assert.equal(await page.locator('#homePosts .home-load-error').count(), 1);
      });
      await check('changing workspace while a real old list read is held preserves the selected workspace and its empty state', async ({ page }) => {
        await openHome(page); const sample = await seed(page);
        const other = await page.evaluate(async original => { const s = HaedoLife.Shell.storage, created = await s.createWorkspace('별도의 익명 작업공간'); await s.setActive(original); return created.workspaceId; }, sample.workspaceId);
        await page.reload(); await ready(page); await nav(page, 'tools'); await page.evaluate(() => { window.__journeyHoldList = true; }); await nav(page, 'home'); await page.waitForFunction(() => window.__journeyHeldList);
        await nav(page, 'manage'); await page.locator('#lifeCurrentWorkspace').click(); await page.locator('#lifeWorkspace').selectOption(other); await page.waitForFunction(id => HaedoLife.Shell.storage.getActive().then(active => active === id), other); await settle(page);
        await page.evaluate(() => { window.__journeyHoldList = false; window.__journeyReleaseOldList = window.__journeyReleaseList; }); await home(page);
        assert.equal((await documents(page)).workspaceId, other); assert.equal(await page.locator('#homePosts .home-post').count(), 0); assert.equal(await page.locator('#homeFirstWrite').isVisible(), true);
        await page.evaluate(() => __journeyReleaseOldList()); await settle(page); assert.equal(await page.locator('#homePosts .home-post').count(), 0); assert.doesNotMatch(await page.locator('#homePosts').innerText(), /산책에서 발견한 문장/);
      });
      await check('late account reads cannot paint old private rows into the next context', async ({ page, server, device }) => {
        await openHome(page); const sample = await seed(page); await nav(page, 'tools'); await page.evaluate(() => { window.__journeyHoldList = true; }); await nav(page, 'home'); await page.waitForFunction(() => window.__journeyHeldList);
        await nav(page, 'tools'); await page.evaluate(() => __journeyReleaseList()); await settle(page); assert.equal(await page.locator('#homePosts').count(), 0);
        await page.evaluate(() => { window.__journeyHoldList = true; window.__journeyHeldList = false; }); await nav(page, 'home'); await page.waitForFunction(() => window.__journeyHeldList);
        await page.evaluate(() => { window.__journeySignout = HaedoAuth.client.auth.signOut({ scope: 'local' }); }); await page.waitForFunction(() => document.querySelector('#lifeApp').hidden && !HaedoLife.Shell.storage); await page.evaluate(() => __journeyReleaseList()); await page.waitForFunction(() => HaedoAuth.user === null);
        assert.doesNotMatch(await page.locator('body').innerText(), /산책에서 발견한 문장/);
        server.oauthAccounts.set(device, accounts.b); await page.locator('[data-life-return-login]').click(); await page.locator('#googleLogin').click(); await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page); await page.locator('#homePosts[aria-busy="false"]').waitFor();
        assert.equal((await documents(page)).docs.length, 0); assert.doesNotMatch(await page.locator('body').innerText(), /산책에서 발견한 문장/);
        const denied = await page.evaluate(async ref => { try { await HaedoLife.Shell.storage.readPhotoPost(ref.workspaceId, ref.ids[0]); return false; } catch (_) { return true; } }, sample); assert(denied);
      });
    }
    if (phase === 'before') await check('immutable before: home, profile, saved reading and writing at three widths', async ({ page }) => {
      await openHome(page); const sample = await seed(page); await page.reload(); await ready(page); await home(page); await snap(page, 'home');
      await page.locator('.home-profile-open').first().click(); await page.locator('.wb-profile').waitFor(); await snap(page, 'profile');
      await home(page); await page.locator(`#homePosts [data-photo-post-id="${sample.ids[0]}"] .home-post-open`).click(); await page.locator('.photo-article').waitFor(); await snap(page, 'reading');
      await page.getByRole('button', { name: '글 수정', exact: true }).click(); await page.locator('.ql-editor').waitFor(); await snap(page, 'writing');
    });
  } finally { report.capturedAt = new Date().toISOString(); await browser.close(); await fs.writeFile(path.join(out, process.env.JOURNEY_REPORT_NAME ? path.basename(process.env.JOURNEY_REPORT_NAME) : process.env.JOURNEY_TEST_MATCH ? 'recheck-report.json' : 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); }
  const failed = report.checks.filter(check => !check.pass).length;
  console.log(JSON.stringify({ passed: report.checks.length - failed, failed, captures: report.visual.length, qualityFailures: report.qualityFailures.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, realRemoteWrites: 0 }));
  if (failed || report.qualityFailures.length || report.consoleErrors.length || report.pageErrors.length) process.exitCode = 1;
}
module.exports = { seed, documents, snap, assertPostCommitLibraryReturn };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

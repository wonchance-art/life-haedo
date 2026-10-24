/* Integration entry/return checks: actual application, bundled Auth SDK and IDB.
 * Auth and empty owner remote catalogues are synthetic. No remote publication,
 * production account/data, actual Google login or Apple device claim. */
'use strict';
const { openBlogMenu } = require('./helpers/feature-menus.cjs');
process.env.BASE_URL ||= 'http://127.0.0.1:4220';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { ShareCloud } = require('./life-share-browser.cjs');
const { accounts, base, cloud } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, shellReady, settle, nav } = require('./unified-home-browser.cjs');
const output = path.resolve(__dirname, '../.local/integrated-release-entry');
const sizes = [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }];
async function context(browser, name, size, account = accounts.a, oldAuthSource = null, report) {
  const server = new ShareCloud(), value = await makeContext(browser, server, name, account, { viewport: size, hasTouch: true });
  if (oldAuthSource) await value.route(base + '/assets/platform-auth.js', route => route.fulfill({ contentType: 'application/javascript', body: oldAuthSource }));
  // An empty owner library needs no SQL writes. The other team verifies the
  // full RPC/RLS/publication journey against isolated PostgreSQL independently.
  await value.route(cloud + '/rest/v1/rpc/life_blog_list', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS' }, body: '' });
    assert.equal(route.request().postDataJSON().p_workspace_id, null);
    return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS' }, body: '[]' });
  });
  await value.route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    if ([new URL(base).origin, cloud].includes(origin)) return route.fallback();
    report?.external.push(origin); return route.abort();
  });
  value.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === cloud && /\/rest\/v1\/rpc\/(?:life_(?:blog_(?:save|publish|unpublish|prepare_asset)|public_page_put|material_put)|life_sync_put)$/.test(url.pathname)) report?.writes.push(url.pathname);
  });
  value.on('page', page => {
    page.setDefaultTimeout(20000);
    page.on('pageerror', e => report?.pageErrors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') report?.consoleErrors.push(e.text()); });
  });
  return { context: value, server, page: await value.newPage() };
}
async function oauthRoundTrip(browser, { file = 'index.html', size = sizes[0], oldAuthSource = null, report } = {}) {
  const device = 'entry-pkce-' + file + '-' + size.width, f = await context(browser, device, size, null, oldAuthSource, report);
  try {
    f.server.oauthAccounts.set(device, accounts.a);
    await f.page.goto(base + '/' + file + '?section=manage&view=public-cover&unknown=drop&next=https%3A%2F%2Foutside.invalid%2Fsteal#discarded-fragment', { waitUntil: 'domcontentloaded' });
    if (file === 'index.html') {
      await shellReady(f.page); assert.deepEqual(await f.page.evaluate(() => __homeDbOpens), [], 'A guest return URL must not open private IndexedDB');
      await f.page.locator('[data-life-return-login]').click();
    }
    await f.page.locator('#googleLogin').click(); await f.page.waitForURL(url => url.pathname.endsWith('/' + file)); await ready(f.page);
    const result = await f.page.evaluate(() => ({ path: location.pathname.split('/').pop(), query: location.search, hash: location.hash,
      mode: document.querySelector('#lifeMain')?.dataset.mode, verifiedDatabaseOpens: __homeDbOpens.every(value => value.verified),
      safeNext: HaedoAuth.safeNext('index.html?section=manage&view=public-cover&code=discarded&next=https://outside.invalid#access_token=hidden') }));
    if (!oldAuthSource) { await f.page.locator('#publicCoverEditor').waitFor(); await f.page.locator('#pcSaveStatus[data-state="saved"]').waitFor(); }
    return result;
  } finally { await f.context.close(); }
}
async function seedCompatibility(page) {
  return page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, C = HaedoLife.Core, P = HaedoLife.PhotoPost, ws = await s.getActive(); let bundle = await s.read(ws);
    const imported = await C.prepareImport({ origin: 'other', title: '기존 자료와 정확한 문장', text: '\ufeff보존한 예전 본문\r\n정확한 문장 🌱\r\n마지막 줄', fileName: 'anonymous-old.md' }, bundle);
    let stored = await s.commitLocal({ workspaceId: ws, baseRevision: bundle.revision, operationId: C.id(), changes: C.buildImportChanges(bundle, imported) }); if (stored.status !== 'stored') throw Error('Synthetic source install failed');
    bundle = await s.read(ws); const quote = '정확한 문장 🌱', start = imported.version.contentText.indexOf(quote);
    const ref = await HaedoLife.SourceReference.build({ bundle, sourceId: imported.source.id, versionId: imported.version.id, locator: { start, end: start + quote.length } });
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 72; const g = canvas.getContext('2d'); g.fillStyle = '#254b40'; g.fillRect(0, 0, 96, 72); g.fillStyle = '#e3e8d8'; g.fillRect(13, 17, 47, 29);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')), photo = await P.readPhoto(new File([blob], '기존-v1-원본.png', { type: 'image/png' }), C.id);
    const doc = P.create(C.id); doc.format = 'life-photo-post-v1'; delete doc.attachments; delete doc.archived; doc.status = 'saved'; doc.title = '기존 v1 사진 글'; doc.photos = [photo]; doc.ops = [{ insert: '기존 글 본문\r\n정확한 문장 🌱\n' }, { insert: { photo: { id: photo.id, caption: '기존 설명\n둘째 줄', alt: '기존 원본 도형' } } }, { insert: '\n' }];
    const post = await s.savePhotoPostWithEvidence(ws, doc, 0, [ref], 0);
    const draft = P.create(C.id); draft.title = '기존에 쓰던 미완성 글'; draft.ops = [{ insert: 'OLD_DRAFT_MUST_REMAIN\n' }]; const priorDraft = await s.savePhotoPost(ws, draft, 0);
    const wb = await s.readWorkbench(ws); wb.page.entries.push({ id: C.id(), title: '예전 선택 자료 항목', parts: [{ versionId: imported.version.id, enabled: true }], note: '기존 비공개 코멘트', pinned: true, enabled: true, showBody: true, showNote: true }); await s.saveWorkbench(ws, wb, wb.revision);
    const nine = await s.readNineBoard(ws); nine.boards.push({ id: 'compat-board', title: '기존 9칸 v1', intro: '기존 소개', areas: [{ id: 'compat-area', title: '산책과 책', note: '기존 영역 메모', items: [{ ...HaedoLife.NineBoard.snapshot({ type: 'book', title: '기존 첨부 책', creator: '익명 저자', url: 'https://example.org/old-book' }), reason: '기존 선택 이유' }] }] }); await s.saveNineBoard(ws, nine, nine.revision);
    const series = await s.readBlogSeries(ws), selectedSeries = HaedoLife.BlogSeries.create(C.id); selectedSeries.title = '기존 여행 연재'; selectedSeries.items.push(HaedoLife.BlogSeries.item(post, C.id)); series.series.push(selectedSeries); await s.saveBlogSeries(ws, series, series.revision);
    const plans = await s.readMaterialWriting(ws), plan = HaedoLife.MaterialWriting.create(C.id); plan.title = '이어서 완성할 작성 준비'; plan.question = '기존 비공개 질문'; plan.materials.push(HaedoLife.MaterialWriting.material(bundle, imported.source.id, imported.version.id, C.id)); plan.blocks.push({ id: C.id(), kind: 'paragraph', text: '기존 생각과 개요' }); plans.plans.push(plan); await s.saveMaterialWriting(ws, plans, plans.revision);
    return { workspaceId: ws, postId: post.id, priorDraftId: priorDraft.id, planId: plan.id, seriesId: selectedSeries.id };
  });
}
async function compatibilitySnapshot(page, seed) {
  return page.evaluate(async seed => {
    const s = HaedoLife.Shell.storage, P = HaedoLife.PhotoPost, ws = seed.workspaceId;
    async function plain(value) {
      if (value instanceof Blob) { const bitmap = await createImageBitmap(value), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; const g = canvas.getContext('2d'); g.drawImage(bitmap, 0, 0); bitmap.close(); return { size: value.size, type: value.type, digest: await P.digest(value), width: canvas.width, height: canvas.height, pixelDigest: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', g.getImageData(0, 0, canvas.width, canvas.height).data)), n => n.toString(16).padStart(2, '0')).join('') }; }
      if (Array.isArray(value)) return Promise.all(value.map(plain));
      if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await plain(item)])));
      return value;
    }
    const posts = []; for (const row of await s.listPhotoPosts(ws)) posts.push({ doc: await s.readPhotoPost(ws, row.id), evidence: await s.readPostEvidence(ws, row.id) });
    return plain({ bundle: await s.read(ws), workbench: await s.readWorkbench(ws), posts, seriesSnapshot: await s.readBlogSeriesSnapshot(ws, seed.seriesId), nine: await s.readNineBoard(ws) });
  }, seed);
}
async function openPage(page) {
  // Section switching preserves its last child, including a module reopened
  // after leaving settings. Use the real child return instead of assuming its
  // parent toolbar is immediately visible.
  if (await page.locator('#lifeMain').getAttribute('data-mode') !== 'page') await nav(page, 'records');
  if (await page.locator('#lifeMain').getAttribute('data-mode') !== 'page') await page.getByRole('button', { name: '선택 자료 페이지', exact: true }).click();
  await page.locator('.life-workbench[data-mode="page"]').waitFor();
  await page.waitForFunction(() => ['#wbPageMaterialWriting','.mw-workspace','.bs-workspace','.nb-workspace'].some(selector => document.querySelector(selector)?.checkVisibility()));
  if (await page.locator('.mw-workspace').isVisible()) await page.locator('#mwClose').click();
  else if (await page.locator('.bs-workspace,.nb-workspace').isVisible()) await page.getByRole('button', { name: '내 페이지로 돌아가기', exact: true }).click();
  await page.locator('#wbPageMaterialWriting').waitFor();
}
async function compositionGuard(page, selector, text, modeSelector, savedSelector) {
  const input = page.locator(selector); await input.waitFor();
  await input.evaluate((node, text) => { window.__integratedInput = node; node.focus(); node.setSelectionRange(1, 2, 'backward'); node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '한' })); node.value = text; node.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertCompositionText', isComposing: true })); }, text);
  await page.locator('[data-haedo-navigation] [data-haedo-section="manage"]').click(); await page.locator('#lifeError').waitFor({ state: 'visible' });
  assert.equal(await page.locator(modeSelector).isVisible(), true, 'Input-in-progress navigation must remain on the same editor');
  assert.equal(await input.evaluate(node => node === window.__integratedInput), true); assert.equal(await input.inputValue(), text);
  await input.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: node.value })));
  await page.locator(savedSelector).waitFor(); await nav(page, 'manage'); await page.locator('#lifeBlogManager').waitFor({ state: 'detached' });
}
async function capture(page, report, scene, size) {
  await page.evaluate(() => document.fonts.ready); const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    inputs: [...document.querySelectorAll('#lifeMain input:not([type=checkbox]),#lifeMain textarea,#lifeMain select')].filter(node => node.checkVisibility()).map(node => ({ id: node.id, font: parseFloat(getComputedStyle(node).fontSize) })) }));
  assert(metrics.scrollWidth <= metrics.width + 1, scene + ': horizontal overflow'); assert(metrics.inputs.every(value => value.font >= 16), scene + ': input font below 16px');
  const file = scene + '-' + size.width + '.png'; await page.screenshot({ path: path.join(output, file), fullPage: true }); report.visual.push({ scene, file, ...metrics });
}
async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)); await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const report = { checks: [], visual: [], writes: [], consoleErrors: [], pageErrors: [], external: [], browser: browser.version(), node: process.version,
    scope: 'Actual app/bundled Auth SDK/IndexedDB and generated PNG bytes. Synthetic Auth PKCE and empty owner catalogues only; no SQL/RLS, production Google, Apple hardware, publication or deployment claim.' };
  try {
    for (const file of ['index.html', 'life.html']) { const result = await oauthRoundTrip(browser, { file, report }); assert.equal(result.path, file); assert.equal(result.query, file === 'index.html' ? '?view=public-cover' : '?section=home&view=public-cover'); assert.equal(result.hash, ''); assert.equal(result.safeNext, 'index.html?section=manage&view=public-cover'); assert.equal(result.verifiedDatabaseOpens, true); report.checks.push({ name: 'Exact synthetic Google PKCE return to public cover from ' + file, pass: true, result }); }
    for (const size of sizes) {
      const f = await context(browser, 'entry-compat-' + size.width, size, accounts.a, null, report);
      try {
        const page = f.page; await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await ready(page); const seed = await seedCompatibility(page), before = await compatibilitySnapshot(page, seed); console.log('Entry compatibility started ' + size.width);
        await openBlogMenu(page); await page.getByRole('button', { name: '글 관리', exact: true }).click(); await page.locator('#lifeBlogManager').waitFor();
        await page.locator('.blog-post[data-post-id="' + seed.postId + '"]').getByRole('button', { name: '기존 v1 사진 글', exact: true }).click(); await page.locator('.photo-article').waitFor();
        assert.match(await page.locator('.photo-article').innerText(), /기존 설명/); await capture(page, report, 'old-v1-photo-read', size); await nav(page, 'manage');
        await openBlogMenu(page); await page.getByRole('button', { name: '공개 표지', exact: true }).click(); await page.locator('#pcSaveStatus[data-state="saved"]').waitFor(); await page.locator('#pcNew').click(); await page.locator('#pcTitle').waitFor();
        await compositionGuard(page, '#pcTitle', '한글 입력을 이어 쓴 표지 ' + size.width, '#publicCoverEditor', '#pcSaveStatus[data-state="saved"]');
        await openBlogMenu(page); await page.getByRole('button', { name: '공개 표지', exact: true }).click(); await page.locator('#pcSaveStatus[data-state="saved"]').waitFor(); assert.equal(await page.locator('#pcTitle').inputValue(), '한글 입력을 이어 쓴 표지 ' + size.width); await capture(page, report, 'cover-reopened', size);
        await openPage(page); await page.locator('#wbPageMaterialWriting').click(); await page.locator('#mwQuestion').waitFor(); await compositionGuard(page, '#mwQuestion', '기존 질문 뒤에 조합한 새 생각 ' + size.width, '.mw-workspace', '.mw-status[data-state="saved"]');
        await openPage(page); await page.locator('#wbPageMaterialWriting').click(); await page.locator('#mwQuestion').waitFor(); assert.equal(await page.locator('#mwQuestion').inputValue(), '기존 질문 뒤에 조합한 새 생각 ' + size.width); console.log('Preparation resumed ' + size.width);
        await openPage(page); await page.locator('#wbPageSeries').click(); await page.locator('#bsIntro').waitFor(); await compositionGuard(page, '#bsIntro', '기존 연재에 이어 적은 소개 ' + size.width, '.bs-workspace', '.bs-status[data-state="saved"]');
        await openPage(page); await page.locator('#wbPageSeries').click(); await page.locator('#bsIntro').waitFor(); assert.equal(await page.locator('#bsIntro').inputValue(), '기존 연재에 이어 적은 소개 ' + size.width); console.log('Series resumed ' + size.width);
        await openPage(page); await page.locator('#wbPageNine').click(); await page.locator('#nbAreaTitle').waitFor(); await compositionGuard(page, '#nbAreaTitle', '기존 영역의 새 이름 ' + size.width, '.nb-workspace', '.nb-status[data-state="saved"]');
        await openPage(page); await page.locator('#wbPageNine').click(); await page.locator('#nbAreaTitle').waitFor(); assert.equal(await page.locator('#nbAreaTitle').inputValue(), '기존 영역의 새 이름 ' + size.width); await capture(page, report, 'old-nine-reopened', size);
        const after = await compatibilitySnapshot(page, seed); assert.deepEqual(after.bundle, before.bundle); assert.deepEqual(after.workbench, before.workbench); assert.deepEqual(after.posts, before.posts); assert.deepEqual(after.seriesSnapshot.posts, before.seriesSnapshot.posts);
        assert.equal(after.posts.find(value => value.doc.id === seed.postId).doc.format, 'life-photo-post-v1'); assert.equal(after.nine.format, before.nine.format); assert.deepEqual(after.nine.boards[0].areas[0].items, before.nine.boards[0].areas[0].items);
        console.log('Entry compatibility passed ' + size.width); report.checks.push({ name: 'Settings/editor integration, composing-input guards and legacy original-byte compatibility ' + size.width, pass: true, originals: { documents: after.posts.length, photoFormat: 'life-photo-post-v1', photos: after.posts.flatMap(value => value.doc.photos).length, exactSourceAndEvidence: true } });
      } finally { await f.context.close(); }
    }
    assert.deepEqual(report.writes, []); assert.deepEqual(report.external, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); report.pass = true;
  } catch (error) { report.pass = false; report.failure = { message: error.message, stack: error.stack }; throw error; }
  finally { await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify({ pass: report.pass, checks: report.checks.length, visual: report.visual.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, remoteWrites: report.writes.length, report: path.join(output, 'report.json') }, null, 2));
}
module.exports = { oauthRoundTrip, context, sizes };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

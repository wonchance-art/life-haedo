/* Import-first home acceptance: actual local app, bundled SDK and IndexedDB.
 * Only generated Korean samples and intercepted anonymous Auth; no production data.
 * BASE_URL=http://127.0.0.1:4173 PW_MODULE_PATH=... node tests/import-hub-home-browser.cjs
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base, openManagement } = require('./life-sync-browser.cjs');
const { playwright, ready, shellReady, settle, nav, makeContext, observe } = require('./unified-home-browser.cjs');
const { seed } = require('./fixtures/import-hub-home.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const out = path.resolve(process.env.IMPORT_HUB_OUT || '.local/import-hub-home');
const report = { capturedAt: new Date().toISOString(), base, scope: 'Local Chromium, actual app/SDK/IDB; synthetic Auth and generated samples. No actual Apple/IME/Google/production verification.', checks: [], captures: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, realRemoteWrites: 0 };
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function hub(page) { await page.locator('.home-hub').waitFor(); await page.waitForFunction(() => document.querySelector('#homeRecent')?.getAttribute('aria-busy') === 'false'); await frames(page); }
async function start(page) { await page.goto(base + '/index.html'); await ready(page); await hub(page); }
async function goHome(page) { await nav(page, 'home'); await hub(page); }
async function reload(page) { await page.goto(base + '/index.html'); await ready(page); await hub(page); }
async function click(page, name) { await page.getByRole('button', { name, exact: true }).click(); await settle(page); }
async function fingerprint(page, workspaceId) {
  return page.evaluate(async workspaceId => {
    const s = HaedoLife.Shell.storage, b = await s.read(workspaceId || await s.getActive());
    const text = JSON.stringify({ sources: b.sources, versions: b.sourceVersions, records: b.records });
    return { workspaceId: b.workspaceId, sources: b.sources.length, versions: b.sourceVersions.length, sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), x => x.toString(16).padStart(2, '0')).join('') };
  }, workspaceId);
}
async function instrument(context) {
  await context.route(`${base}/assets/life/storage.js`, async route => {
    const response = await route.fetch();
    const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async readWorkbench(...a){if(window.__hubFailWorkbench)throw Error('Synthetic workbench read failure');const value=await actual.readWorkbench(...a);if(window.__hubHold){window.__hubEntered=true;await new Promise(resolve=>(window.__hubReleases ||= []).push(resolve));}window.__hubFinished=(window.__hubFinished||0)+1;return value;},async listPhotoPosts(...a){if(window.__hubFailPhotos)throw Error('Synthetic photo list failure');return actual.listPhotoPosts(...a);}});}});})();`;
    await route.fulfill({ response, body: await response.text() + hook });
  });
}
async function release(page) { await page.evaluate(() => { window.__hubHold = false; for (const resolve of window.__hubReleases || []) resolve(); window.__hubReleases = []; }); }
async function captureBatch(page, scene) {
  if (process.env.IMPORT_HUB_NO_CAPTURE) return;
  const rowReview = !!process.env.IMPORT_HUB_ROW_REVIEW;
  if (rowReview && scene !== 'mixed') return;
  const sizes = rowReview ? [{ width: 1440, height: 1000 }, { width: 390, height: 844 }] : [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }];
  for (const size of sizes) {
    await page.setViewportSize(size); await page.evaluate(() => document.fonts.ready); await frames(page);
    await page.waitForFunction(() => [...document.querySelectorAll('.home-recent-thumbnail')].every(frame => frame.getAttribute('aria-busy') === 'false') && [...document.querySelectorAll('.home-recent-cover')].every(image => image.complete && image.naturalWidth > 0));
    await page.evaluate(() => { document.activeElement?.blur(); for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); scrollTo({ top: 0, behavior: 'instant' }); });
    await page.mouse.move(size.width - 1, 0); await frames(page);
    const metrics = await page.evaluate(inspect), file = `${scene}-${size.width}.png`;
    const home = await page.evaluate(() => ({ recent: document.querySelectorAll('.home-recent-item').length, visibleResume: !!document.querySelector('#homeReadingResumeOpen'), duplicateIds: [...new Set([...document.querySelectorAll('[id]')].map(n => n.id))].filter(id => document.querySelectorAll('[id="' + id + '"]').length > 1), rowText: [...document.querySelectorAll('.home-recent-item')].map(n => n.textContent) }));
    await page.screenshot({ path: path.join(out, file), fullPage: !rowReview }); report.captures.push({ scene, file, ...metrics, home });
  }
}
async function simplifiedRows(page, fixture) {
  if (!process.env.IMPORT_HUB_ROW_REVIEW) return;
  const rows = await page.locator('.home-recent-item').evaluateAll(rows => rows.map(row => {
    const preview = row.querySelector('.home-recent-excerpt'), css = preview && getComputedStyle(preview);
    return { title: row.querySelector('.home-recent-open')?.textContent, meta: row.querySelector('.home-recent-meta')?.textContent,
      preview: preview?.textContent || '', previewHeight: preview?.getBoundingClientRect().height || 0, lineHeight: css ? parseFloat(css.lineHeight) : 0,
      times: row.querySelectorAll('time').length, attachmentLists: row.querySelectorAll('.home-recent-attachments').length, text: row.textContent };
  }));
  assert.equal(rows.length, 6);
  for (const row of rows) {
    assert(row.title.trim(), 'Stored title remains usable'); assert(row.meta?.trim(), 'Source label remains visible');
    assert.equal(row.times, 0); assert.equal(row.attachmentLists, 0);
    assert(!/작성자|관계|비공개|브라우저|확보 범위|내 기록|가져옴|수정 |저장 |링크만 보관/.test(row.meta), 'Only source and necessary coverage remain: ' + row.meta);
    if (row.preview) assert(row.previewHeight <= row.lineHeight + 1, 'Preview occupies at most one line');
    if (fixture.attachmentTitle) assert(!row.text.includes(fixture.attachmentTitle), 'Attachment title is retained in details, not repeated in home rows');
  }
  const nullRow = rows.find(row => row.title === fixture.refs[12].title), partialRow = rows.find(row => row.title === fixture.refs[11].title);
  assert(nullRow); assert.match(nullRow.meta, /본문 미확보/); assert.equal(nullRow.preview, '');
  assert(partialRow); assert.match(partialRow.meta, /일부 본문/); assert(partialRow.preview.includes('모든 자료 검색표식 11.'));
  const latest = rows.find(row => row.title === fixture.refs[0].title); assert(latest); assert.match(latest.meta, /Obsidian/); assert(latest.preview.includes('최신 원문'));
}
async function exactReturn(page, control, expectedText, versionId) {
  await control.scrollIntoViewIfNeeded(); await control.focus(); await frames(page);
  const expected = await control.evaluate(el => ({ y: scrollY, key: el.dataset.focusKey }));
  await control.click(); await page.locator('#lifeSourceText').waitFor(); await frames(page);
  assert.equal(await page.locator('#lifeSourceText').textContent(), expectedText); assert.equal(await page.locator('#lifeVersion').inputValue(), versionId);
  await page.locator('#lifeSearchReturn').click(); await hub(page);
  await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, expected.key);
  const actual = await page.evaluate(() => scrollY); assert(Math.abs(actual - expected.y) <= 2, `Home return scroll ${actual} != ${expected.y}`);
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); report.browser = browser.version();
  async function check(name, run, account = accounts.a) {
    if (process.env.IMPORT_HUB_MATCH && !new RegExp(process.env.IMPORT_HUB_MATCH).test(name)) return;
    const server = new FakeCloud(), device = 'import-hub-' + report.checks.length, context = await makeContext(browser, server, device, account, { viewport: { width: 390, height: 844 } }), page = await context.newPage(); page.setDefaultTimeout(15000); observe(page, report, name);
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push({ check: name, origin: url.origin }); return route.abort('blockedbyclient'); });
    await instrument(context);
    try { await run({ page, context, server, device }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
    finally { await context.close(); await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); }
  }
  try {
    await check('public import intent, explicit review, aborted write and retry', async ({ page, server, device }) => {
      await page.goto(base + '/index.html'); await shellReady(page); assert.deepEqual(await page.evaluate(() => __homeDbOpens), []); await captureBatch(page, 'public');
      server.oauthAccounts.set(device, accounts.a); await page.locator('[data-life-login="import"]').click(); await page.locator('#googleLogin').click(); await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page); await page.locator('#lifeImportText').waitFor();
      const raw = '새로 모은 익명 원문 🌱\n실패해도 입력과 기존 자료를 지킵니다.';
      await page.locator('#lifeImportTitle').fill('첫 가져오기 익명 글'); await page.locator('#lifeImportText').fill(raw); await click(page, '원문·출처 확인');
      const before = await fingerprint(page); assert.equal(before.sources, 0);
      await page.evaluate(() => { window.__hubPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(...args) { const request = __hubPut.apply(this, args); if (this.name === 'bundles') this.transaction.abort(); return request; }; });
      await click(page, '자료만 보관'); await page.locator('#lifeError:not([hidden])').waitFor(); assert.deepEqual(await fingerprint(page), before); assert.equal(await page.locator('#lifeReviewText').inputValue(), raw);
      await page.evaluate(() => { IDBObjectStore.prototype.put = __hubPut; }); await click(page, '자료만 보관'); await goHome(page);
      assert.equal(await page.locator('.home-recent-item').count(), 1); assert.equal((await fingerprint(page)).sources, 1);
      await page.locator('.home-recent-open').click(); await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
    }, null);
    await check('confirmed empty home exposes search and import without false resume', async ({ page }) => {
      await start(page); assert.equal(await page.locator('.home-hub-empty').count(), 1); assert.equal(await page.locator('#homeFirstWrite').count(), 0); assert.equal(await page.locator('#homeReadingResumeOpen').count(), 0);
      assert(await page.locator('#homeGlobalSearch').isVisible()); assert(await page.locator('.home-hub-actions [data-home-destination="import"]').isVisible()); await captureBatch(page, 'empty');
      await page.locator('.home-hub-actions [data-home-destination="import"]').click(); await page.locator('#lifeImportText').waitFor(); await page.locator('#lifeSubviewReturn').click(); await hub(page); assert.equal(await page.locator('.home-hub-empty').count(), 1);
    });
    await check('thirteen imported originals: recent six, global search, exact reader and link-only', async ({ page }) => {
      await start(page); const f = await seed(page), before = await fingerprint(page); await reload(page); assert.equal(before.sources, 13); assert.equal(before.versions, 14); assert.equal(await page.locator('.home-recent-item').count(), 6);
      await simplifiedRows(page, f);
      assert.equal(await page.locator('#homeFirstWrite,.home-hub-empty').count(), 0); assert.equal(await page.locator('.home-recent-item[data-version-id="' + f.oldVersionId + '"]').count(), 0); assert.equal(await page.locator('#homeReadingResumeOpen').count(), 0); await captureBatch(page, 'imported-only');
      await exactReturn(page, page.locator('.home-recent-item[data-version-id="' + f.latestVersionId + '"] .home-recent-open'), f.latestText, f.latestVersionId);
      const link = f.refs.find(row => row.linkOnly); await page.locator('.home-recent-item[data-version-id="' + link.versionId + '"] .home-recent-open').click(); await page.locator('#lifeMain[data-mode="source"]').waitFor(); assert.equal(await page.locator('#lifeSourceText').count(), 0); assert.match(await page.locator('#lifeMain').innerText(), /본문.*(없|미확보)|링크만/); await page.locator('#lifeSearchReturn').click(); await hub(page);
      const query = '모든 자료 검색표식 1.'; await page.locator('#homeGlobalSearch').fill(query); await page.locator('#homeGlobalSearch').evaluate(el => { el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true })); }); assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'home'); await page.locator('#homeGlobalSearch').dispatchEvent('compositionend'); await page.locator('#homeGlobalSearch').press('Enter');
      await page.locator('#lifeFindQuery').waitFor(); assert.equal(await page.locator('#lifeFindQuery').inputValue(), query); await page.locator('.life-find-result').filter({ hasText: f.refs[1].title }).waitFor(); await page.locator('#lifeSubviewReturn').click(); await hub(page); assert.equal(await page.locator('#homeGlobalSearch').inputValue(), query); await page.waitForFunction(() => document.activeElement?.id === 'homeGlobalSearch'); assert.deepEqual(await fingerprint(page), before);
    });
    await check('mixed originals and saved writing share six recent rows; drafts and archive remain accessible', async ({ page }) => {
      await start(page); const f = await seed(page, 'mixed'), before = await fingerprint(page); await reload(page); await captureBatch(page, 'mixed');
      await simplifiedRows(page, f);
      assert.equal(await page.locator('.home-recent-item').count(), 6); for (const kind of ['source', 'photo', 'plain']) assert(await page.locator('.home-recent-item[data-home-kind="' + kind + '"]').count() > 0);
      for (const id of [f.draftId, f.archivedId]) assert.equal(await page.locator('.home-recent-item[data-photo-post-id="' + id + '"]').count(), 0);
      const photoControl = page.locator('.home-recent-item[data-photo-post-id="' + f.photoId + '"] .home-recent-open'); await photoControl.scrollIntoViewIfNeeded(); await photoControl.focus(); const photoOrigin = await photoControl.evaluate(el => ({ key: el.dataset.focusKey, y: scrollY }));
      await photoControl.click(); await page.locator('.photo-article').waitFor(); assert.match(await page.locator('.photo-article').innerText(), /익명 사진 글/); await page.locator('.photo-read-return button').click(); await hub(page); await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, photoOrigin.key); assert(Math.abs(await page.evaluate(() => scrollY) - photoOrigin.y) <= 2);
      const plainControl = page.locator('.home-recent-item[data-post-id="' + f.plainId + '"] .home-recent-open'); await plainControl.scrollIntoViewIfNeeded(); await plainControl.focus(); const plainOrigin = await plainControl.evaluate(el => ({ key: el.dataset.focusKey, y: scrollY }));
      await plainControl.click(); await page.locator('.pp-post').first().waitFor(); assert.match(await page.locator('#lifeMain').innerText(), /익명 첨부 글/); if(f.attachmentTitle) assert((await page.locator('#lifeMain').innerText()).includes(f.attachmentTitle)); await page.locator('.pp-workspace > .pp-toolbar').getByRole('button', { name: '홈으로 돌아가기', exact: true }).click(); await hub(page); await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, plainOrigin.key); assert(Math.abs(await page.evaluate(() => scrollY) - plainOrigin.y) <= 2);
      await page.locator('.home-hub-all').click(); await page.locator('#lifeWritingsOpen').click(); await page.locator('#homePosts').waitFor(); assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'writings'); assert.equal(new URL(page.url()).searchParams.get('view'), 'writings');
      await page.locator('#homeTab-drafts').click(); await page.locator('.home-draft').filter({ hasText: '작성 중인 익명 초안' }).waitFor(); await page.locator('#homeTab-archive').click(); await page.locator('.home-post[data-photo-post-id="' + f.archivedId + '"]').waitFor(); assert.deepEqual(await fingerprint(page), before);
    });
    await check('resume is conditional and preserves the exact older immutable BOM/CRLF version', async ({ page }) => {
      await start(page); const f = await seed(page), before = await fingerprint(page); await page.evaluate(async f => { const s = HaedoLife.Shell.storage; const result = await s.saveReadingPosition(f.workspaceId, { sourceId: f.refs[0].sourceId, sourceVersionId: f.oldVersionId, offset: f.refs[0].text.indexOf('이전') }, 0); if (result.status !== 'stored') throw Error('Reading position fixture rejected'); }, f); await reload(page);
      await page.locator('#homeReadingResumeOpen').waitFor(); await page.locator('#homeReadingResumeOpen').click(); await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), f.refs[0].text); assert.equal(await page.locator('#lifeVersion').inputValue(), f.oldVersionId); await page.locator('#lifeSearchReturn').click(); await hub(page); await page.waitForFunction(() => document.activeElement?.id === 'homeReadingResumeOpen'); await page.locator('#homeReadingResumeClear').click(); await page.locator('#homeReadingResumeOpen').waitFor({ state: 'detached' }); assert.deepEqual(await fingerprint(page), before);
    });
    await check('read failures preserve known originals and retry before declaring an empty home', async ({ page }) => {
      await start(page); await nav(page, 'tools'); await page.evaluate(() => { __hubFailWorkbench = __hubFailPhotos = true; }); await goHome(page); await page.locator('.home-load-error').waitFor(); assert.equal(await page.locator('.home-hub-empty').count(), 0);
      await page.evaluate(() => { __hubFailWorkbench = __hubFailPhotos = false; }); await click(page, '다시 불러오기'); await page.locator('.home-hub-empty').waitFor();
      const f = await seed(page), before = await fingerprint(page); await reload(page); await nav(page, 'tools'); await page.evaluate(() => { __hubFailPhotos = true; }); await goHome(page); assert.equal(await page.locator('.home-recent-item').count(), 6); assert.equal(await page.locator('.home-hub-empty').count(), 0); await page.locator('.home-load-error').waitFor(); await page.evaluate(() => { __hubFailPhotos = false; }); await click(page, '다시 불러오기'); await page.locator('.home-load-error').waitFor({ state: 'detached' }); assert.deepEqual(await fingerprint(page, f.workspaceId), before);
    });
    await check('late reads cannot replace navigation, a new workspace, or the next account', async ({ page, server, device }) => {
      await start(page); const f = await seed(page), before = await fingerprint(page); await reload(page); await nav(page, 'tools'); await page.evaluate(() => { __hubHold = true; __hubEntered = false; }); await nav(page, 'home'); await page.waitForFunction(() => __hubEntered); await nav(page, 'tools'); await release(page); await frames(page); assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'tools');
      await page.evaluate(() => { __hubHold = true; __hubEntered = false; }); await nav(page, 'home'); await page.waitForFunction(() => __hubEntered); await openManagement(page); await page.locator('#lifeWorkspace').selectOption(f.otherWorkspaceId); await settle(page); await release(page); await goHome(page); assert.equal(await page.locator('.home-recent-item').count(), 0); assert.equal(await page.locator('.home-hub-empty').count(), 1); assert.deepEqual(await fingerprint(page, f.workspaceId), before);
      await openManagement(page); await page.locator('#lifeWorkspace').selectOption(f.workspaceId); await settle(page); await page.evaluate(() => { __hubHold = true; __hubEntered = false; }); await nav(page, 'home'); await page.waitForFunction(() => __hubEntered); await page.evaluate(() => { window.__hubSignout = HaedoAuth.client.auth.signOut({ scope: 'local' }); }); await page.waitForFunction(() => document.querySelector('#lifeApp').hidden && !HaedoLife.Shell.storage); await release(page); await page.waitForFunction(() => HaedoAuth.user === null); assert(!(await page.locator('body').innerText()).includes(f.refs[0].title));
      server.oauthAccounts.set(device, accounts.b); await page.locator('[data-life-login="import"]').click(); await page.locator('#googleLogin').click(); await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page); await nav(page, 'home'); await hub(page); assert.equal((await fingerprint(page)).sources, 0); assert(!(await page.locator('body').innerText()).includes(f.refs[0].title)); assert(await page.evaluate(async id => { try { await HaedoLife.Shell.storage.read(id); return false; } catch (_) { return true; } }, f.workspaceId));
    });
  } finally { await browser.close(); }
  report.visualFailures = report.captures.filter(c => c.horizontalOverflow || c.smallTargets.length || c.unnamed.length || c.smallInputs.length || c.contrastFailures.length || c.home.duplicateIds.length).map(c => ({ scene: c.scene, width: c.viewport.width, overflow: c.horizontalOverflow, targets: c.smallTargets, unnamed: c.unnamed, smallInputs: c.smallInputs, contrast: c.contrastFailures, duplicateIds: c.home.duplicateIds }));
  report.passed = report.checks.filter(c => c.pass).length; report.failed = report.checks.length - report.passed; await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ passed: report.passed, failed: report.failed, captures: report.captures.length, visualFailures: report.visualFailures.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length }));
  if (report.failed || report.visualFailures.length || report.consoleErrors.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

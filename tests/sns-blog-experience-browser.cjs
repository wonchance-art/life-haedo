/* Real app/SDK/IndexedDB with intercepted anonymous Auth and synthetic images.
 * BASE_URL=http://127.0.0.1:4173 node tests/sns-blog-experience-browser.cjs
 * SNS_PHASE=before BASE_URL=http://127.0.0.1:4175 captures the immutable base.
 * Service-worker update/offline behavior belongs to the separate PWA runner.
 */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { ShareCloud } = require('./life-share-browser.cjs');
const { playwright, ready, shellReady, settle, makeContext, observe, nav } = require('./unified-home-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const phase = process.env.SNS_PHASE || 'after';
assert(['before', 'after'].includes(phase));
const out = process.env.SNS_OUT_DIR ? path.resolve(process.env.SNS_OUT_DIR) : path.resolve('.local/sns-blog', phase);
const sizes = [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }];
const report = { phase, createdAt: new Date().toISOString(), scope: 'Linux Chromium viewport/touch simulation; anonymous HTTP Auth/share simulator, real local app/SDK/IndexedDB. Synthetic 1800×1200 image. No real Google/remote DB, Apple hardware, native IME, PWA or deployment claim.', checks: [], visual: [], qualityFailures: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [] };

async function home(page) {
  if (!await page.locator('[data-haedo-navigation] a[data-haedo-section="home"]').isVisible()) {
    if (await page.locator('.photo-editor').isVisible()) await page.getByRole('button', { name: '닫기', exact: true }).click();
    else await page.locator('[data-subview-return]').click();
    await settle(page);
  }
  await nav(page, 'home'); await page.locator('#homePosts[aria-busy="false"]').waitFor();
  await page.locator('#homeComposition[aria-busy="false"]').waitFor();
  if (phase === 'after' && await page.locator('#homeTab-posts').getAttribute('aria-selected') !== 'true') await page.locator('#homeTab-posts').click();
}
async function library(page) {
  const node = page.locator('.home-library');
  if (!await node.evaluate(element => element.open)) await node.locator(':scope > summary').click();
}
async function profile(page) {
  if (phase === 'after') {
    await page.locator('[data-home-destination="page"]').click();
    await page.locator('#wbPageTitle').waitFor();
    assert.equal(await page.locator('#wbPageTitle').inputValue(), '느린 오후의 기록');
    assert.equal(await page.locator('#wbProfileSettings').isVisible(), true);
    assert.equal(await page.locator('.wb-post-feed').count(), 0, 'Profile editing must not duplicate the home feed');
  } else {
    await page.locator('[data-home-destination="page"]').click(); await listFromPhoto(page);
    await page.locator('.wb-post-feed').waitFor();
  }
}
async function compatibility(page) {
  await page.goto(base + '/index.html?view=page'); await ready(page);
  const retained = page.locator('.wb-page-compatibility');
  if (!await retained.evaluate(node => node.open)) await retained.locator(':scope > summary').click();
  await page.locator('.wb-post-feed').waitFor();
}
async function listFromPhoto(page) {
  if (await page.locator('.photo-editor').isVisible()) await page.getByRole('button', { name: '닫기', exact: true }).click();
  if (await page.locator('.photo-article').isVisible()) await page.getByRole('button', { name: '사진 글 목록', exact: true }).click();
}
async function snap(page, scene) {
  const firstCapture = report.visual.length, firstFailure = report.qualityFailures.length;
  if (scene === 'writing') await page.waitForFunction(expected => document.querySelector('.photo-status')?.textContent === expected, phase === 'after' ? '초안 보관됨' : '초안이 이 브라우저에 저장됨');
  for (const size of sizes) {
    await page.setViewportSize(size); await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.querySelectorAll('.home-post-cover,.photo-read-image,.photo-entry-cover[src],.photo-block img')]
      .filter(image => image instanceof HTMLImageElement && image.getAttribute('src') && image.checkVisibility({ visibilityProperty: true }))
      .every(image => image.complete && image.naturalWidth > 0));
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
      document.activeElement?.blur(); scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.mouse.move(size.width - 1, 0);
    const metrics = await page.evaluate(inspect), file = `${scene}-${size.width}.png`;
    Object.assign(metrics, await page.evaluate(() => {
      const main = document.querySelector('#lifeMain'), css = main && getComputedStyle(main);
      return { contentWidth: main && !main.closest('[hidden]') ? main.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) : null,
        navigation: [...document.querySelectorAll('[data-haedo-navigation] [data-haedo-section]')].filter(node => node.checkVisibility({ visibilityProperty: true })).map(node => {
          const box = node.getBoundingClientRect(), icon = node.querySelector('svg').getBoundingClientRect(), label = node.querySelector('.haedo-nav-text'), text = label.getBoundingClientRect();
          return { label: node.getAttribute('aria-label'), mode: innerWidth <= 760 ? 'bottom' : innerWidth <= 1100 ? 'rail' : 'label', width: box.width, height: box.height,
            iconWidth: icon.width, iconHeight: icon.height, iconLeft: icon.left - box.left, labelGap: text.left - icon.right, labelTop: text.top - icon.bottom,
            centeredX: Math.abs((box.left + box.right - icon.left - icon.right) / 2), centeredY: Math.abs((box.top + box.bottom - icon.top - icon.bottom) / 2), labelVisible: getComputedStyle(label).display !== 'none' };
        }) };
    }));
    await page.screenshot({ path: path.join(out, file), fullPage: true });
    report.visual.push({ scene, file, ...metrics });
    if (phase === 'after') {
      if (metrics.horizontalOverflow) report.qualityFailures.push({ scene, width: size.width, check: 'horizontalOverflow' });
      for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) if (metrics[key].length) report.qualityFailures.push({ scene, width: size.width, check: key, details: metrics[key] });
      if (scene !== 'public') {
        const aligned = metrics.navigation.map(item => item.label).join(',') === '홈,자료실,도구,설정' && metrics.navigation.every(item => item.width >= 44 && item.height >= 44 && item.iconWidth === 20 && item.iconHeight === 20 &&
          (['rail', 'bottom'].includes(item.mode) ? item.centeredX < 1 && item.labelVisible && item.labelTop >= 3 && item.labelTop <= 5 : item.iconLeft === 16 && item.centeredY < 1 && item.labelVisible && item.labelGap === 16));
        if (scene === 'writing' && size.width <= 760) {
          const focusedWriting = await page.evaluate(() => document.body.dataset.writingFocus === 'true');
          if (metrics.navigation.length || !focusedWriting) report.qualityFailures.push({ scene, width: size.width, check: 'focusedMobileWriting', details: metrics.navigation });
        } else if (!aligned) report.qualityFailures.push({ scene, width: size.width, check: 'navigationAlignment', details: metrics.navigation });
        if (metrics.contentWidth > 721) report.qualityFailures.push({ scene, width: size.width, check: 'contentMaximum720', details: metrics.contentWidth });
      }
    }
  }
  return { captures: report.visual.slice(firstCapture), qualityFailures: report.qualityFailures.slice(firstFailure) };
}
async function seed(page) {
  return page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, m = HaedoLife.PhotoPost, workspaceId = await s.getActive();
    const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = 1200;
    const x = canvas.getContext('2d'), sky = x.createLinearGradient(0, 0, 0, 1200);
    sky.addColorStop(0, '#a8c6cf'); sky.addColorStop(.48, '#e8d8c5'); sky.addColorStop(1, '#466e75');
    x.fillStyle = sky; x.fillRect(0, 0, 1800, 1200);
    x.fillStyle = '#f7e8c2'; x.beginPath(); x.arc(1260, 330, 85, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#617c74'; x.beginPath(); x.moveTo(0, 520); x.bezierCurveTo(500, 320, 760, 720, 1800, 460); x.lineTo(1800, 1200); x.lineTo(0, 1200); x.fill();
    x.fillStyle = '#c8b99a'; x.beginPath(); x.moveTo(750, 1200); x.bezierCurveTo(900, 920, 1000, 840, 1190, 660); x.lineTo(1270, 660); x.bezierCurveTo(1140, 900, 1220, 1040, 1390, 1200); x.fill();
    for (let i = 0; i < 31; i++) { x.fillStyle = i % 2 ? '#304b44' : '#3f6051'; const left = i * 67 - 70, top = 600 + i % 5 * 34; x.beginPath(); x.moveTo(left, top); x.lineTo(left + 130, 1200); x.lineTo(left - 130, 1200); x.fill(); }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .92));
    const image = await m.readPhoto(new File([blob], 'anonymous-afternoon.jpg', { type: blob.type }), c.id);
    const specs = [
      { title: '빛이 길게 머무는 오후', body: '산책을 하다 잠깐 멈췄다. 익숙한 길도 천천히 걸으면 다른 장면이 된다.', image: true },
      { title: '읽은 문장을 내 말로 남기는 일', body: '좋았던 문장을 적어 두는 것에서 한 걸음 더. 오늘의 내 경험과 나란히 놓고 생각을 이어 본다.\n\n다시 읽을 때 어떤 마음일까.' },
      { title: '작은 취향의 목록', body: '창가 자리, 느린 음악, 오래 쓰는 연필. 매일 곁에 두고 싶은 것들을 조금씩 모은다. 🌿' }
    ], postIds = [];
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i], at = `2026-10-${String(17 - i).padStart(2, '0')}T00:00:00.000Z`, doc = m.create(c.id, at);
      doc.title = spec.title; doc.status = 'saved'; doc.ops = [{ insert: spec.body + '\n' }];
      if (spec.image) { doc.photos = [image]; doc.ops.push({ insert: { photo: { id: image.id, caption: '익명 샘플로 그린 오후의 산책길', alt: '노을 아래 길과 나무를 그린 합성 이미지' } } }, { insert: '\n사진을 보고 다시 떠오른 생각을 여기에 남긴다.\n' }); }
      await s.savePhotoPost(workspaceId, doc, 0); postIds.push(doc.id);
    }
    const wb = await s.readWorkbench(workspaceId); wb.page.title = '느린 오후의 기록'; wb.page.intro = '걷고, 읽고, 좋아하는 것을 모으며 씁니다.'; wb.page.showIntro = true;
    await s.saveWorkbench(workspaceId, wb, wb.revision);
    let b = await s.read(workspaceId);
    const p = await c.prepareImport({ origin: 'obsidian', title: '다시 읽을 산책 메모', text: '한 번 지나친 풍경도 다시 보면 새로운 문장이 된다.\n다른 곳에서 가져온 원문과 내 생각을 구분해서 남긴다.', author: '익명 작성자', authorRelation: 'self', forceSeparate: true }, b);
    const result = await s.commitLocal({ workspaceId, baseRevision: b.revision, operationId: c.id(), changes: c.buildImportChanges(b, p, []) });
    if (result.status !== 'stored') throw new Error('Anonymous source seed failed');
    return { workspaceId, postIds, sourceId: p.source.id, versionId: p.version.id, width: image.width, height: image.height, digest: image.digest, base64: canvas.toDataURL('image/jpeg', .92).split(',')[1] };
  });
}
async function docs(page) {
  return page.evaluate(async () => { const s = HaedoLife.Shell.storage, workspaceId = await s.getActive(), rows = await s.listPhotoPosts(workspaceId); return { workspaceId, docs: await Promise.all(rows.map(row => s.readPhotoPost(workspaceId, row.id))) }; });
}
async function openPost(page, id) { await page.locator(`#homePosts .home-post[data-photo-post-id="${id}"] .home-post-open`).click(); await page.locator('.photo-article').waitFor(); }
async function exactCover(page, id, width) {
  if (phase === 'before') return;
  await page.locator(`#homePosts .home-post[data-photo-post-id="${id}"] .home-post-cover`).waitFor();
  await page.waitForFunction(({ id, width }) => document.querySelector(`#homePosts .home-post[data-photo-post-id="${id}"] .home-post-cover`)?.naturalWidth === width, { id, width });
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); report.browser = browser.version();
  async function check(name, run) {
    if (process.env.SNS_TEST_MATCH && !new RegExp(process.env.SNS_TEST_MATCH).test(name)) return;
    const server = new ShareCloud(), device = 'sns-' + report.checks.length, context = await makeContext(browser, server, device, null, { viewport: sizes[0], hasTouch: true });
    await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback(); report.external.push(u.origin); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(15000); observe(page, report, name);
    try { await run({ page, context, server, device }); assert.equal(server.writes().length, 0); assert.equal(server.publicationWrites().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(out, `failure-${report.checks.length}.png`), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  async function login(page, server, device) {
    server.oauthAccounts.set(device, accounts.a); await page.locator('[data-life-login]').click(); await page.locator('#googleLogin').click();
    await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page);
    if (phase === 'after') { await page.locator('#photoTitle').waitFor(); await page.getByRole('button', { name: '닫기', exact: true }).click(); }
    await page.locator('#homePosts[aria-busy="false"]').waitFor();
  }
  try {
    await check('public login, real-photo feed, profile, writing, reading, editing and return through every main area', async ({ page, server, device }) => {
      await page.goto(base + '/index.html'); await shellReady(page); assert.deepEqual(await page.evaluate(() => __homeDbOpens), []); await snap(page, 'public');
      await login(page, server, device); const sample = await seed(page); await page.reload(); await ready(page); await home(page);
      assert((await page.evaluate(() => __homeDbOpens)).every(item => item.verified));
      if (phase === 'after') {
        assert.equal(await page.locator('#homePosts .home-post-author').count(), 0);
        const metadata = await page.locator('#homePosts .home-post-meta').allTextContents();
        assert.equal(metadata.length, 3);
        metadata.forEach(text => assert.match(text, /비공개 · 이 브라우저에 보관/));
        assert.equal(await page.locator('.home-profile-open .home-avatar').innerText(), '느린');
      }
      await exactCover(page, sample.postIds[0], sample.width); await snap(page, 'feed');
      await profile(page); await snap(page, 'profile');
      if (phase === 'after') {
        await page.locator('#wbPageTitle').waitFor();
        assert.equal(await page.locator('#wbPageTitle').inputValue(), '느린 오후의 기록');
        await page.locator('#wbPageIntro').fill('걷고, 읽고, 좋아하는 것을 모으며 씁니다. 오늘의 문장도 천천히.');
      }
      await home(page);
      if (phase === 'after') assert.match(await page.locator('.home-profile-intro,.home-blog-description').first().innerText(), /오늘의 문장도 천천히/);
      await openPost(page, sample.postIds[0]); await snap(page, 'reading');
      await page.getByRole('button', { name: '글 수정', exact: true }).click(); await page.locator('#photoTitle').waitFor(); await snap(page, 'writing');
      await page.locator('#photoTitle').fill('빛이 길게 머무는 오후 — 다시 쓴 생각');
      await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor();
      const edited = (await docs(page)).docs.find(doc => doc.title.endsWith('다시 쓴 생각') && doc.status === 'saved');
      assert(edited); assert.equal(edited.photos[0].digest, sample.digest); assert.equal(edited.photos[0].width, 1800);
      await home(page); await library(page); await page.locator('[data-home-destination="sources"]').click(); await settle(page); await snap(page, 'library');
      await page.locator(`.life-source-card[data-source-id="${sample.sourceId}"] .life-source-open`).first().click(); await settle(page);
      assert.match(await page.locator('#lifeSourceText').innerText(), /다른 곳에서 가져온 원문/); await snap(page, 'source');
      await home(page); await page.locator('#lifeFindOpen').click(); await page.locator('#lifeFind[aria-busy="false"]').waitFor();
      await page.locator('#lifeFindQuery').fill('오후'); await page.locator(`[data-focus-key="find:photo-post:${edited.id}"]`).click(); await page.locator('.photo-article').waitFor();
      assert.match(await page.locator('.photo-article').innerText(), /다시 쓴 생각/);
      await nav(page, 'manage'); await snap(page, 'settings'); await nav(page, 'tools'); await snap(page, 'tools'); await home(page);
      await page.locator('[data-home-destination="write"]:visible, #homeFirstWrite').click(); await page.locator('#photoTitle').waitFor();
      await page.locator('#photoTitle').fill('새로 남기는 한글 사진 글');
      const body = page.locator('.ql-editor'); await body.evaluate(node => { window.__snsEditor = node; node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
      await body.fill('오늘의 생각을 한글로 천천히 씁니다.\n사진 앞뒤의 순서를 그대로 남깁니다.'); await body.dispatchEvent('compositionend', { data: '씁니다' });
      assert.equal(await body.evaluate(node => node === window.__snsEditor), true);
      await page.locator('#photoFiles').setInputFiles({ name: 'anonymous-afternoon.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(sample.base64, 'base64') });
      await page.locator('.photo-block').waitFor(); await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor();
      const fresh = (await docs(page)).docs.find(doc => doc.title === '새로 남기는 한글 사진 글' && doc.status === 'saved'); assert(fresh); assert.equal(fresh.photos[0].digest, sample.digest);
      await home(page); await exactCover(page, fresh.id, 1800); await openPost(page, fresh.id);
      assert.match(await page.locator('.photo-article').innerText(), /오늘의 생각을 한글로/); await page.reload(); await ready(page); await home(page); await openPost(page, fresh.id);
      report.image = { width: sample.width, height: sample.height, originalDigestVerified: fresh.photos[0].digest === sample.digest, synthetic: true };
    });
    if (phase === 'after') await check('failed writes preserve Korean/photo input; ZIP restores original bytes and account boundaries hold', async ({ page, server, device }) => {
      await page.goto(base + '/index.html'); await shellReady(page); await login(page, server, device); const sample = await seed(page); await page.reload(); await ready(page); await home(page); await openPost(page, sample.postIds[0]);
      const download = page.waitForEvent('download'); await page.getByRole('button', { name: '사진 포함 백업', exact: true }).click(); const zip = await fs.readFile(await (await download).path());
      await page.getByRole('button', { name: '글 수정', exact: true }).click(); await page.locator('#photoTitle').waitFor();
      await page.evaluate(() => { window.__snsPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { const request = __snsPut.apply(this, args); if (args[0]?.key?.startsWith('photo-post:')) this.transaction.abort(); return request; }; });
      await page.locator('#photoTitle').fill('실패해도 남아야 할 한글 입력'); await page.locator('.photo-status[role="alert"]').waitFor();
      await nav(page, 'home').catch(() => {}); assert.equal(await page.locator('#photoTitle').inputValue(), '실패해도 남아야 할 한글 입력');
      assert.equal((await docs(page)).docs.find(doc => doc.id === sample.postIds[0]).title, '빛이 길게 머무는 오후');
      await page.evaluate(() => { IDBObjectStore.prototype.put = __snsPut; });
      const more = page.locator('.photo-more'); if (!await more.evaluate(node => node.open)) await more.locator(':scope > summary').click();
      await page.getByRole('button', { name: '초안 다시 저장', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.photo-status')?.textContent === '초안 보관됨');
      await page.getByRole('button', { name: '닫기', exact: true }).click(); await compatibility(page); const files = page.locator('.photo-files'); if (!await files.evaluate(node => node.open)) await files.locator(':scope > summary').click();
      await page.getByLabel('사진 글 ZIP 백업', { exact: true }).setInputFiles({ name: 'anonymous-photo.zip', mimeType: 'application/zip', buffer: zip });
      await page.getByRole('button', { name: '새 초안으로 복원', exact: true }).click(); await page.locator('#photoTitle').waitFor();
      const restored = (await docs(page)).docs.find(doc => doc.status === 'draft' && doc.title === '빛이 길게 머무는 오후'); assert(restored); assert.equal(restored.photos[0].digest, sample.digest); assert.equal(restored.photos[0].width, 1800);
      report.zip = { bytes: zip.length, sha256: createHash('sha256').update(zip).digest('hex'), originalDigestVerified: true };
      await home(page); await page.evaluate(() => { window.__snsSignout = HaedoAuth.client.auth.signOut({ scope: 'local' }); });
      await page.waitForFunction(() => document.querySelector('#lifeApp').hidden && !HaedoLife.Shell.storage); assert(!(await page.locator('body').innerText()).includes('느린 오후의 기록'));
      server.oauthAccounts.set(device, accounts.b); await page.locator('[data-life-login]').click(); await page.locator('#googleLogin').click(); await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page); await home(page);
      assert.equal((await docs(page)).docs.length, 0); assert.equal(await page.locator('.home-post-cover').count(), 0);
      assert.equal(await page.evaluate(async sample => { try { await HaedoLife.Shell.storage.readPhotoPost(sample.workspaceId, sample.postIds[0]); return false; } catch (_) { return true; } }, { workspaceId: sample.workspaceId, postIds: sample.postIds }), true);
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []);
  } finally { await browser.close(); await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(`SNS blog ${phase}: ${report.checks.filter(check => check.pass).length}/${report.checks.length} journeys; ${report.visual.length} screenshots; visual failures ${report.qualityFailures.length}; console ${report.consoleErrors.length}; page ${report.pageErrors.length}.`);
  if (report.checks.some(check => !check.pass) || report.qualityFailures.length || report.consoleErrors.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
}
module.exports = { seed, home, snap };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

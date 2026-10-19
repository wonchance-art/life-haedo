'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4212';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { LocalSQLSeriesCloud } = require('./blog-series-sql-fixture.cjs');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, nav } = require('./unified-home-browser.cjs');
const out = path.resolve(__dirname, '../.local/blog-series-public');
async function main() {
  await fs.mkdir(out, { recursive: true });
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  const server = new LocalSQLSeriesCloud({ container: process.env.BLOG_POSTGRES_CONTAINER, database: process.env.BLOG_POSTGRES_DATABASE + '_series_browser' });
  await server.prepare(); await server.initialize();
  const report = { checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, pass: false,
    scope: 'Actual app UI/SDK/IndexedDB and existing PostgreSQL page/blog RPCs; synthetic HTTP Auth/Storage/Edge; no production/Google/Apple claims.' };
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const contexts = [];
  async function context(name, seed) {
    const value = await makeContext(browser, server, name, seed, { viewport: { width: 1440, height: 1000 } }); contexts.push(value);
    await value.route('**/*', route => { const origin = new URL(route.request().url()).origin; if ([new URL(base).origin, cloud].includes(origin)) return route.fallback(); report.external.push(origin); return route.abort(); });
    return value;
  }
  function observe(page) {
    page.setDefaultTimeout(25000); page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', event => { if (event.type() !== 'error') return;
      if (event.location().url.startsWith(cloud) && (/Failed to load resource:.*(?:ERR_FAILED|404)/.test(event.text()) || page.expectedOffline && /ERR_INTERNET_DISCONNECTED/.test(event.text()))) report.expectedErrors++; else report.consoleErrors.push(event.text()); });
  }
  const owner = await context('series-owner', accounts.a), anonymous = await context('series-visitor', null);
  await anonymous.addInitScript(() => {
    for (const key of ['localStorage', 'sessionStorage', 'indexedDB']) Object.defineProperty(window, key, { configurable: true, get() { throw Error('Anonymous reader accessed ' + key); } });
    const original = window.setTimeout; window.__seriesPolls = [];
    window.setTimeout = function (callback, delay, ...args) { if (delay === 30000) window.__seriesPolls.push(callback); return original.call(this, callback, delay, ...args); };
  });
  const page = await owner.newPage(), visitor = await anonymous.newPage(); observe(page); observe(visitor);
  const busy = async () => page.waitForFunction(() => document.getElementById('bsShare')?.getAttribute('aria-busy') === 'false');
  const button = async name => { await page.getByRole('button', { name, exact: true }).click(); await busy(); };
  const state = value => visitor.waitForFunction(value => document.getElementById('seriesStatus')?.dataset.state === value, value);
  const writeCounts = () => ({ saves: server.blogRequests.filter(r => r.rpc === 'life_blog_save').length, posts: server.blogRequests.filter(r => r.rpc === 'life_blog_publish').length, uploads: server.assetRequests.filter(r => r.method === 'POST').length });
  async function capture(target, scene, selector) {
    for (const width of [1440, 820, 390]) {
      await target.setViewportSize({ width, height: 1000 }); await target.evaluate(() => document.fonts.ready);
      await target.evaluate(() => { scrollTo(0, 0); document.getElementById('bsShare')?.scrollTo(0, 0); });
      const metrics = await target.evaluate(require('./home-entry-browser.cjs').inspectHome, selector);
      // Match the site's existing design inspector: a native checkbox's
      // wrapping label is its effective pointer target. Keep raw measurements
      // as evidence and independently exercise the label's far edge below.
      metrics.rawSmallTargets = metrics.smallTargets;
      metrics.effectiveTargets = await target.evaluate(selector => {
        const root = document.querySelector(selector), visible = el => el.checkVisibility({ checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && !el.closest('[hidden],.life-sr-only,.life-skip,.sr-only');
        return [...root.querySelectorAll('button,a[href],input,textarea,select,summary'), ...document.querySelectorAll('[data-haedo-navigation] a')].filter(visible).map(el => {
          const effective = el.matches('input[type=checkbox],input[type=radio]') ? el.closest('label') || el : el, r = effective.getBoundingClientRect();
          return { tag: el.tagName.toLowerCase(), name: (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.textContent || '').trim(), width: r.width, height: r.height, wrappingLabel: effective !== el };
        });
      }, selector);
      metrics.smallTargets = metrics.effectiveTargets.filter(control => control.width < 43.9 || control.height < 43.9);
      assert.equal(metrics.horizontalOverflow, false); for (const key of ['smallTargets', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ':' + key);
      const file = scene + '-' + width + '.png'; await target.screenshot({ path: path.join(out, file), fullPage: selector !== '#bsShare' }); report.visual.push({ scene, width, file, metrics });
    }
  }
  const check = async (name, run) => { console.log('START ' + name); await run(); report.checks.push(name); console.log('PASS ' + name); };
  let fixture, publicURL, publicId, beforeWrites;
  try {
    await page.goto(base + '/index.html'); await ready(page); await settle(page);
    fixture = await page.evaluate(async () => {
      const life = HaedoLife, storage = life.Shell.storage, ws = await storage.getActive(), ids = () => crypto.randomUUID(), docs = [];
      const canvas = document.createElement('canvas'); canvas.width = 4032; canvas.height = 3024;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#cfe4dd'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#182522'; ctx.font = '80px sans-serif'; ctx.fillText('합성 여행 원본', 120, 160);
      const original = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const sync = life.BlogSync.create({ storage, auth: HaedoAuth }); const publications = [];
      for (let index = 0; index < 3; index++) {
        const doc = life.PhotoPost.create(ids); doc.status = 'saved'; doc.title = index === 2 ? '미선택 비공개 여행 글' : '공개 여행 ' + (index + 1);
        doc.ops = [{ insert: ('기억한 풍경을 내 말로 남깁니다. ' + (index + 1) + '\n\n').repeat(16) }];
        if (index === 1) { const photo = await life.PhotoPost.readPhoto(new File([original], 'synthetic-travel.png', { type: 'image/png' }), ids); doc.photos = [photo]; doc.ops.push({ insert: { photo: { id: photo.id, caption: '공개하기로 고른 풍경', alt: '합성 초록 풍경' } } }, { insert: '\n' }); }
        await storage.savePhotoPost(ws, doc, 0); const saved = await storage.readPhotoPost(ws, doc.id); docs.push(saved);
        if (index < 2) { await sync.connect(ws, saved.id); publications.push(await sync.publish(ws, saved.id, { expectedLocalRevision: saved.revision, photoIds: saved.photos.map(photo => photo.id), author: { name: '합성 여행자', intro: '' } })); }
      }
      const series = life.BlogSeries.create(ids); series.title = '천천히 이어 읽는 여행'; series.intro = '직접 선택한 두 편의 공개 목차'; series.items = docs.map(doc => life.BlogSeries.item(doc, ids));
      const library = await storage.readBlogSeries(ws); library.series.push(series); await storage.saveBlogSeries(ws, library, library.revision);
      sync.dispose(); return { ws, seriesId: series.id, docs: docs.map(doc => ({ id: doc.id, title: doc.title, photos: doc.photos.map(({ blob, ...photo }) => photo) })), publications };
    });
    const oldPage = server.rpc(accounts.a.id, 'life_public_page_put', { p_workspace_id: fixture.ws, p_expected_revision: 0, p_operation_id: randomUUID(), p_action: 'publish', p_snapshot: { format: 'life-share-v1', title: '기존 공개 페이지', intro: null, entries: [] } });
    const localBefore = await page.evaluate(async ws => { const s = HaedoLife.Shell.storage; return { bundle: await s.read(ws), series: await s.readBlogSeries(ws), posts: await s.listPhotoPosts(ws) }; }, fixture.ws);
    await check('actual owner dialog defaults to no selection and publishes only ordered explicitly selected active tokens with durable receipt replay', async () => {
      await page.goto(base + '/index.html?section=records&view=page'); await ready(page); await settle(page);
      await page.locator('#wbPageSeries').click(); await page.locator('#bsSelect').selectOption(fixture.seriesId);
      await page.locator('.bs-files > summary').click(); await page.locator('#bsPublish').click(); await page.locator('#bsShare').waitFor(); await busy();
      assert.equal(await page.locator('#bsShareChoices input:checked').count(), 0); assert.equal(await page.locator('#bsShareChoices select').count(), 3);
      assert.equal(await page.locator('#bsShareChoices option').filter({ hasText: fixture.docs[2].title }).count(), 0);
      report.checkboxEdgeTargets = [];
      for (const width of [1440, 820, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const input of await page.locator('#bsShare input[type=checkbox]').all()) {
          const label = input.locator('xpath=..'), rect = await label.evaluate(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }));
          assert(rect.width >= 44 && rect.height >= 44); assert.equal(await input.isChecked(), false);
          await label.click({ position: { x: rect.width - 4, y: rect.height - 4 } }); assert.equal(await input.isChecked(), true);
          await label.click({ position: { x: rect.width - 4, y: rect.height - 4 } }); assert.equal(await input.isChecked(), false);
          report.checkboxEdgeTargets.push({ viewport: width, name: await input.getAttribute('aria-label'), ...rect });
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      beforeWrites = writeCounts();
      await button('공개 목차 미리보기'); assert.equal(server.pageRequests.filter(r => r.name === 'life_public_page_put').length, 0);
      for (const [index, publication] of [fixture.publications[1], fixture.publications[0]].entries()) {
        const choice = page.locator('.bs-share-choice').nth(index); await choice.locator('select').selectOption(publication.token); await choice.locator('input').check();
      }
      await button('공개 목차 미리보기'); assert.deepEqual(await page.locator('#bsSharePreview li').allTextContents(), [fixture.docs[1].title, fixture.docs[0].title]);
      await page.getByRole('checkbox', { name: '이 목차를 공개합니다', exact: true }).check(); server.pageFailure = 'ack'; await button('목차 게시·갱신');
      assert.match(await page.locator('#bsShare [role="alert"]').innerText(), /결과|확인|연결/);
      await button('미확인 게시 요청 다시 확인'); const link = page.getByRole('link', { name: '공개 모음 열기', exact: true }); await link.waitFor(); publicURL = await link.getAttribute('href'); publicId = new URL(publicURL).searchParams.get('series');
      const writes = server.pageRequests.filter(r => r.name === 'life_public_page_put'); assert.equal(writes.length, 2); assert.deepEqual(writes[0].args, writes[1].args);
      const snapshot = server.rpc(null, 'life_public_page_read', { p_public_id: publicId }).snapshot;
      assert.deepEqual(snapshot.entries.map(entry => new URL(entry.attachments[0].url).searchParams.get('post')), [fixture.publications[1].token, fixture.publications[0].token]);
      for (const doc of fixture.docs) { assert(!JSON.stringify(snapshot).includes(doc.id)); assert(!JSON.stringify(snapshot).includes(doc.title)); }
      assert.deepEqual(writeCounts(), beforeWrites); assert.equal(server.rpc(accounts.a.id, 'life_public_page_get', { p_workspace_id: fixture.ws }).publicId, oldPage.publicId);
      await capture(page, 'owner-explicit-toc', '#bsShare');
    });
    await check('a conflicting public update consumes the reviewed consent; a second click cannot overwrite until a fresh explicit review', async () => {
      await button('공개 목차 미리보기'); await page.getByRole('checkbox', { name: '이 목차를 공개합니다', exact: true }).check();
      const old = server.rpc(null, 'life_public_page_read', { p_public_id: publicId }), changed = structuredClone(old.snapshot); changed.title = '다른 창이 명시 갱신한 목차';
      const competing = server.rpc(accounts.a.id, 'life_public_page_put', { p_workspace_id: fixture.seriesId, p_expected_revision: old.revision, p_operation_id: randomUUID(), p_action: 'publish', p_snapshot: changed });
      assert.equal(competing.status, 'stored');
      await button('목차 게시·갱신');
      assert.equal(await page.getByRole('checkbox', { name: '이 목차를 공개합니다', exact: true }).isChecked(), false);
      assert.equal(await page.locator('#bsSharePreview h3,#bsSharePreview li').count(), 0);
      const requests = server.pageRequests.filter(r => r.name === 'life_public_page_put').length;
      await button('목차 게시·갱신');
      assert.equal(server.pageRequests.filter(r => r.name === 'life_public_page_put').length, requests, 'Consumed approval must stop a second click before any RPC');
      assert.deepEqual(server.rpc(null, 'life_public_page_read', { p_public_id: publicId }).snapshot, changed);
      await button('공개 목차 미리보기'); await page.getByRole('checkbox', { name: '이 목차를 공개합니다', exact: true }).check(); await button('목차 게시·갱신');
      const fresh = server.rpc(null, 'life_public_page_read', { p_public_id: publicId }); assert.equal(fresh.revision, competing.revision + 1); assert.equal(fresh.snapshot.title, '천천히 이어 읽는 여행');
      assert.equal(new URL(await page.getByRole('link', { name: '공개 모음 열기', exact: true }).getAttribute('href')).searchParams.get('series'), publicId);
      assert.deepEqual(writeCounts(), beforeWrites); report.casConsent = { consumedOnConflict: true, secondClickWrites: 0, requiresFreshReview: true, finalRevision: fresh.revision };
    });
    await check('anonymous navigation rechecks the current wrapper and original photo while unchanged background rechecks preserve DOM, selection and scroll', async () => {
      await visitor.goto(publicURL); await state('published'); assert.deepEqual(await visitor.locator('.bs-public-toc a').allTextContents(), [fixture.docs[1].title, fixture.docs[0].title]);
      assert.equal(await visitor.locator('script[src*="platform-auth"],script[src*="storage.js"],script[src*="supabase.js"]').count(), 0);
      await visitor.locator('.bs-public-toc a').first().click(); await state('published');
      assert.equal(await visitor.locator('#seriesContent h1').count(), 1); assert.equal(await visitor.locator('#seriesContent h1').innerText(), fixture.docs[1].title);
      assert.equal(await visitor.locator('.bs-public-contents').evaluate(node => node.open), false);
      const image = visitor.locator('.blog-document img'); await image.scrollIntoViewIfNeeded(); await image.evaluate(node => node.decode()); assert.deepEqual(await image.evaluate(node => [node.naturalWidth, node.naturalHeight]), [4032, 3024]);
      const src = await image.getAttribute('src'); const actualHash = await visitor.evaluate(async url => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await (await fetch(url, { credentials: 'omit', cache: 'no-store' })).arrayBuffer()))].map(value => value.toString(16).padStart(2, '0')).join(''), src);
      assert.equal(actualHash, fixture.docs[1].photos[0].digest);
      await visitor.evaluate(() => { window.__sameArticle = document.querySelector('.blog-document'); const text = document.querySelector('.blog-line').firstChild, range = document.createRange(); range.setStart(text, 2); range.setEnd(text, 9); getSelection().removeAllRanges(); getSelection().addRange(range); window.__selectedText = getSelection().toString(); window.__scrollBeforePoll = scrollY; });
      await visitor.evaluate(async () => __seriesPolls.at(-1)());
      assert.equal(await visitor.evaluate(() => document.querySelector('.blog-document') === __sameArticle && getSelection().toString() === __selectedText && Math.abs(scrollY - __scrollBeforePoll) < 2), true);
      visitor.expectedOffline = true; await anonymous.setOffline(true); await state('error'); assert.equal(await visitor.locator('#seriesContent').innerText(), '');
      await anonymous.setOffline(false); await state('published'); visitor.expectedOffline = false;
      assert.equal(await visitor.evaluate(() => typeof HaedoAuth), 'undefined');
      await visitor.getByRole('button', { name: '사진 원본 크기로 보기', exact: true }).click(); assert.equal(await image.evaluate(node => node.getBoundingClientRect().width > node.parentElement.getBoundingClientRect().width), true);
      await visitor.getByRole('button', { name: '사진 화면에 맞추기', exact: true }).click();
      await visitor.evaluate(() => scrollTo(0, 0)); await capture(visitor, 'visitor-current-original', '#seriesContent');
      const next = visitor.getByRole('link', { name: '다음 글 · ' + fixture.docs[0].title, exact: true }); await next.click(); await state('published'); assert.equal(await visitor.locator('#seriesContent h1').innerText(), fixture.docs[0].title);
      assert(await visitor.getByRole('link', { name: '이전 글 · ' + fixture.docs[1].title, exact: true }).isVisible());
    });
    await check('child and series revocation clear content independently, reject unrelated tokens, and leave private/local originals unchanged', async () => {
      server.rpc(accounts.a.id, 'life_blog_unpublish', { p_post_id: fixture.docs[0].id, p_expected_revision: fixture.publications[0].revision, p_operation_id: randomUUID() });
      await visitor.locator('#seriesRefresh').click(); await state('published'); assert.equal(await visitor.locator('.blog-document').count(), 0); assert.match(await visitor.locator('.bs-public-unavailable').innerText(), /공개가 종료/);
      await visitor.getByText('모음 목차 · 2편', { exact: true }).click(); assert(!await visitor.locator('.bs-public-toc').innerText().then(text => text.includes(fixture.docs[0].title)));
      await capture(visitor, 'visitor-revoked-chapter', '#seriesContent');
      const unrelated = new URL(publicURL); unrelated.searchParams.set('post', randomUUID()); await visitor.goto(unrelated.href); await state('error'); assert.equal(await visitor.locator('#seriesContent').innerText(), '');
      await visitor.goto(publicURL); await state('published');
      await page.getByRole('checkbox', { name: '이 공개 목차를 철회합니다', exact: true }).check(); await button('목차 공개 철회');
      await visitor.locator('#seriesRefresh').click(); await state('missing'); assert.equal(await visitor.locator('#seriesContent').innerText(), '');
      assert(server.rpc(null, 'life_blog_public_read', { p_token: fixture.publications[1].token }));
      const after = await page.evaluate(async ws => { const s = HaedoLife.Shell.storage; return { bundle: await s.read(ws), series: await s.readBlogSeries(ws), posts: await s.listPhotoPosts(ws) }; }, fixture.ws);
      assert.deepEqual(after, localBefore); assert.deepEqual(writeCounts(), beforeWrites); assert.equal(server.rpc(accounts.a.id, 'life_public_page_get', { p_workspace_id: fixture.ws }).publicId, oldPage.publicId);
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } finally {
    report.sqlPageRpcCalls = server.pageRequests.length; report.sqlBlogRpcCalls = server.blogRequests.length; report.originalUploads = server.assetRequests.filter(r => r.method === 'POST').length;
    if (!report.pass) { await page.screenshot({ path: path.join(out, 'failure-owner.png'), fullPage: true }).catch(() => {}); await visitor.screenshot({ path: path.join(out, 'failure-visitor.png'), fullPage: true }).catch(() => {}); }
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await Promise.all(contexts.map(value => value.close())); await browser.close();
  }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

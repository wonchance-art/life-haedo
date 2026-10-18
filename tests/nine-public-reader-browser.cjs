'use strict';
// Standalone public reader, actual ShareRemote/strict model/CollectionMedia.
// HTTP and cover responses are anonymous fixtures; owner/SQL QA is separate.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright } = require('./unified-home-browser.cjs');
const { cloud, publicKey } = require('./life-sync-browser.cjs');
const base = process.env.BASE_URL || 'http://127.0.0.1:4213';
const output = path.resolve(__dirname, '../.local/nine-public-reader');
const id = '55555555-5555-4555-8555-000000000001';
const fullTitle = '줄임없이 끝까지 읽어야 하는 긴 한글 제목 '.repeat(12) + '제목마지막';
const fullURL = 'https://example.org/source?whole=' + 'a'.repeat(600) + '&end=SOURCE_END';
const copy = value => JSON.parse(JSON.stringify(value));
const snapshot = (allBooks = false) => ({ format: 'life-share-v1', title: '직접 고른 여행의 아홉 칸', intro: '책과 음악에서 다시 찾은 여행의 장면입니다.\n출처는 각 항목에서 직접 확인합니다.', entries: [{
  title: '내가 고른 여행의 기록', pinned: false, note: null, parts: [],
  attachments: allBooks ? Array.from({ length: 9 }, (_, index) => ({ type: 'book', title: index === 0 ? fullTitle : '직접 고른 책 ' + (index + 1), creator: '익명 만든 사람', url: 'https://openlibrary.org/books/OL' + (123001 + index) + 'M' })) : [
    { type: 'book', title: fullTitle, creator: '한글로 남긴 만든 사람', url: fullURL },
    { type: 'video', title: '영상의 제목만 공개한 칸', creator: '익명 채널', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' },
    { type: 'music', title: '출처 주소 없이 고른 음악', creator: '', url: '' },
  ] }] });
const report = { checks: [], consoleErrors: [], pageErrors: [], unexpected: [], routeErrors: [],
  scope: 'Standalone public DOM and actual ShareRemote/NinePublic/CollectionMedia, anonymous intercepted public RPC and SVG cover fixtures. No owner session, production DB, live provider or Apple-device claim.' };
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function entered(gate) {
  let timer;
  try { await Promise.race([gate.entered, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Public read did not reach the fixture within 12 seconds')), 12000); })]); }
  finally { clearTimeout(timer); }
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version(); report.node = process.version;
  let active;
  async function fixture({ query = '?nine=' + id, value = snapshot(), viewport = { width: 820, height: 1000 } } = {}) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' }); active = context;
    const state = { snapshot: value, revision: 1, missing: false, reads: [], covers: [], badCover: false, gate: null };
    await context.addInitScript(() => {
      window.__privacy = { storage: [], idb: [], cache: [], fetches: [] }; window.__hidden = false; window.__online = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => __hidden });
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => __online });
      for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, { configurable: true, get() { __privacy.storage.push(name); throw Error('Public reader accessed private storage'); } });
      for (const name of ['open', 'deleteDatabase']) { const original = IDBFactory.prototype[name]; IDBFactory.prototype[name] = function (...args) { __privacy.idb.push(name); return original.apply(this, args); }; }
      for (const name of ['open', 'match', 'delete', 'keys']) { const original = CacheStorage.prototype[name]; CacheStorage.prototype[name] = function (...args) { __privacy.cache.push(name); return original.apply(this, args); }; }
      const fetch = window.fetch; window.fetch = function (url, options = {}) { __privacy.fetches.push({ url: String(url), credentials: options.credentials, cache: options.cache }); return fetch.apply(this, arguments); };
      const timeout = window.setTimeout, clear = window.clearTimeout; let next = -1; window.__polls = new Map();
      window.setTimeout = function (callback, delay, ...args) { if (delay === 30000) { const key = next--; __polls.set(key, () => callback(...args)); return key; } return timeout(callback, delay, ...args); };
      window.clearTimeout = function (key) { if (key < 0) __polls.delete(key); else clear(key); };
      window.__runPoll = () => { const pair = __polls.entries().next().value; if (!pair) throw Error('No current public poll'); __polls.delete(pair[0]); return pair[1](); };
    });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      try {
        if (url.href === base + '/assets/platform-config.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.HAEDO_CONFIG=' + JSON.stringify({ url: cloud, key: publicKey }) + ';' });
        if (url.origin === new URL(base).origin) return route.continue();
        if (url.href === cloud + '/rest/v1/rpc/life_public_page_read') {
          const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'cache-control': 'no-store' };
          if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
          assert.equal(request.method(), 'POST'); assert.deepEqual(request.postDataJSON(), { p_public_id: id });
          assert.equal(request.headers().authorization, undefined); assert.equal(request.headers().apikey, publicKey);
          state.reads.push(request.postDataJSON());
          const response = state.missing ? { status: 'missing' } : { status: 'published', publicId: id, revision: state.revision, updatedAt: '2026-10-18T00:00:00.000Z', snapshot: copy(state.snapshot) };
          if (state.gate) { const gate = state.gate; state.gate = null; gate.enter(); await gate.released; }
          return await route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(response) });
        }
        if (url.origin === 'https://covers.openlibrary.org') {
          state.covers.push({ url: url.href, headers: request.headers() });
          const width = state.badCover ? 1 : 120, height = state.badCover ? 1 : 160;
          return route.fulfill({ contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
            body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#c9dcd3"/></svg>` });
        }
        report.unexpected.push(url.origin); return route.abort();
      } catch (error) {
        if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(request.failure()?.errorText || '')) report.routeErrors.push(error.message);
        await route.abort().catch(() => {});
      }
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    await page.goto(base + '/taste.html' + query);
    await page.waitForFunction(() => ['published', 'missing', 'error'].includes(document.querySelector('#ninePublicStatus')?.dataset.state));
    async function privacy() {
      const result = await page.evaluate(() => ({ ...__privacy, auth: !!window.HaedoAuth, sdk: !!window.supabase, privateStore: !!HaedoLife.Storage }));
      assert.deepEqual(result.storage, []); assert.deepEqual(result.idb, []); assert.deepEqual(result.cache, []);
      assert.equal(result.auth, false); assert.equal(result.sdk, false); assert.equal(result.privateStore, false);
      assert(result.fetches.every(value => value.url === cloud + '/rest/v1/rpc/life_public_page_read' && value.credentials === 'omit' && value.cache === 'no-store'));
    }
    return { page, context, state, privacy, async close() { await privacy(); await context.close(); active = null; }, hold() {
      let enter, release; const gate = { entered: new Promise(resolve => { enter = resolve; }), released: new Promise(resolve => { release = resolve; }), enter: () => enter(), release: () => release() }; state.gate = gate; return gate;
    } };
  }
  const published = page => page.waitForFunction(() => document.querySelector('#ninePublicStatus')?.dataset.state === 'published');
  const check = async (name, run) => {
    if (process.env.NINE_PUBLIC_READER_MATCH && !new RegExp(process.env.NINE_PUBLIC_READER_MATCH).test(name)) return;
    console.log('START ' + name); await run(); report.checks.push(name); console.log('PASS ' + name);
  };
  try {
    await check('Invalid, absent and duplicate nine addresses issue no RPC and open no private storage', async () => {
      for (const query of ['', '?id=' + id, '?nine=not-a-public-id', '?nine=' + id + '&nine=' + id]) {
        const f = await fixture({ query }); assert.equal(f.state.reads.length, 0); assert.equal(await f.page.locator('.np-document').count(), 0); await f.close();
      }
    });
    await check('Nine native slots expose complete selected metadata and keep exact DOM, selection and scroll on an unchanged canonical public poll', async () => {
      const f = await fixture(), page = f.page; assert.equal(await page.locator('.np-cell').count(), 9); assert.equal(await page.locator('.np-tile').count(), 3);
      assert.equal(await page.locator('.np-empty').count(), 6); assert.equal(await page.locator('.np-empty button').count(), 0); assert.equal(f.state.covers.length, 0);
      await page.locator('.np-tile[data-index="0"]').click(); await page.waitForFunction(() => document.activeElement?.className === 'np-detail-title');
      assert.equal(await page.locator('.np-detail-title').innerText(), fullTitle); assert.equal(await page.locator('.np-source-link').innerText(), fullURL);
      assert.equal(await page.locator('.np-source-link').getAttribute('referrerpolicy'), 'no-referrer'); assert.equal(await page.locator('.np-source-link').getAttribute('rel'), 'noopener noreferrer');
      const before = await page.evaluate(() => {
        window.__article = document.querySelector('.np-document'); window.__detail = document.querySelector('.np-detail-title'); window.__tile = document.querySelector('.np-tile');
        const range = document.createRange(); range.setStart(__detail.firstChild, 2); range.setEnd(__detail.firstChild, 12); getSelection().removeAllRanges(); getSelection().addRange(range);
        return { selection: getSelection().toString(), scroll: scrollY };
      });
      f.state.revision++; const original = f.state.snapshot, entry = original.entries[0];
      f.state.snapshot = { entries: [{ attachments: entry.attachments.map(item => ({ url: item.url, creator: item.creator, title: item.title, type: item.type })), parts: [], note: null, pinned: false, title: entry.title }], intro: original.intro, title: original.title, format: original.format };
      await page.evaluate(() => __runPoll());
      assert.deepEqual(await page.evaluate(() => ({ article: __article === document.querySelector('.np-document'), detail: __detail === document.querySelector('.np-detail-title'), selection: getSelection().toString(), scroll: scrollY })), { article: true, detail: true, ...before });
      await page.locator('.np-detail-close').click(); await page.waitForFunction(() => document.activeElement === __tile);
      await page.locator('.np-tile[data-index="2"]').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.activeElement?.className === 'np-detail-title'); assert.equal(await page.locator('.np-source-link').count(), 0);
      assert.match(await page.locator('.np-source-empty').innerText(), /주소가 없습니다/); await f.close();
    });
    await check('Changed content replaces selection, strict shape failure removes old content and withdrawal clears the last public view', async () => {
      const f = await fixture(), page = f.page; await page.locator('.np-tile').first().click(); await page.locator('.np-detail-title').waitFor();
      f.state.snapshot.title = '작성자가 명시적으로 갱신한 제목'; f.state.revision++;
      await page.evaluate(() => __runPoll()); assert.equal(await page.locator('.np-title').innerText(), f.state.snapshot.title); assert.equal(await page.locator('.np-detail').isHidden(), true);
      const good = copy(f.state.snapshot); f.state.snapshot.entries[0].pinned = true;
      await page.evaluate(() => __runPoll()); assert.equal(await page.locator('#ninePublicStatus').getAttribute('data-state'), 'error'); assert.equal(await page.locator('.np-document').count(), 0);
      f.state.snapshot = good; await page.locator('#ninePublicRefresh').click(); await published(page);
      f.state.missing = true; await page.evaluate(() => __runPoll()); assert.equal(await page.locator('#ninePublicStatus').getAttribute('data-state'), 'missing');
      assert.equal(await page.locator('#ninePublicContent').innerText(), ''); assert.equal(await page.locator('#ninePublicUpdated').isHidden(), true); await f.close();
    });
    await check('Hide, offline and pagehide clear old content and reject an earlier in-flight public response', async () => {
      const f = await fixture(), page = f.page, gate = f.hold();
      await page.evaluate(() => { window.__pendingPublicPoll = __runPoll(); }); await entered(gate);
      await page.evaluate(() => { __hidden = true; document.dispatchEvent(new Event('visibilitychange')); }); assert.equal(await page.locator('#ninePublicContent').innerText(), '');
      gate.release(); await page.evaluate(() => __pendingPublicPoll); assert.equal(await page.locator('.np-document').count(), 0);
      await page.evaluate(() => { __hidden = false; document.dispatchEvent(new Event('visibilitychange')); }); await published(page);
      await page.evaluate(() => { __online = false; dispatchEvent(new Event('offline')); }); assert.equal(await page.locator('.np-document').count(), 0);
      await page.evaluate(() => { __online = true; dispatchEvent(new Event('online')); }); await published(page);
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide'))); assert.equal(await page.locator('.np-document').count(), 0);
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))); await published(page); await f.close();
    });
    await check('Only explicitly enabled Open Library covers load lazily, turn off completely and preserve metadata after image failure', async () => {
      const f = await fixture({ value: snapshot(true), viewport: { width: 390, height: 360 } }), page = f.page;
      assert.equal(f.state.covers.length, 0); await page.getByRole('button', { name: '책 표지 보기', exact: true }).click(); await page.locator('.np-cover img').first().waitFor(); await frames(page);
      assert(f.state.covers.length > 0 && f.state.covers.length < 9, 'Offscreen covers must remain unrequested');
      await page.locator('.np-cover').last().scrollIntoViewIfNeeded(); await page.locator('.np-cover').last().locator('img').waitFor();
      for (const request of f.state.covers) { assert.equal(request.headers.referer, undefined); assert.equal(request.headers.authorization, undefined); assert(request.url.startsWith('https://covers.openlibrary.org/b/olid/')); }
      await page.evaluate(() => { window.__oldCover = document.querySelector('.np-cover img'); });
      await page.getByRole('button', { name: '책 표지 끄기', exact: true }).click(); assert.equal(await page.locator('.np-cover img').count(), 0);
      assert.equal(await page.evaluate(() => __oldCover.getAttribute('src')), null);
      f.state.badCover = true; await page.getByRole('button', { name: '책 표지 보기', exact: true }).click(); await page.locator('.np-cover[data-state=error]').first().waitFor();
      assert.equal(await page.locator('.np-tile[data-index="0"] .np-item-title').innerText(), fullTitle);
      await page.locator('.np-tile[data-index="0"]').click(); assert.equal(await page.locator('.np-detail-title').innerText(), fullTitle);
      await page.evaluate(() => { __hidden = true; document.dispatchEvent(new Event('visibilitychange')); }); assert.equal(await page.locator('.np-cover img').count(), 0);
      const requested = f.state.covers.length;
      await page.evaluate(() => { __hidden = false; document.dispatchEvent(new Event('visibilitychange')); }); await published(page);
      assert.equal(await page.getByRole('button', { name: '책 표지 보기', exact: true }).getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('.np-cover img').count(), 0); assert.equal(f.state.covers.length, requested); await f.close();
    });
    await check('YouTube and unmatched book URLs remain complete text without invented image options or provider metadata requests', async () => {
      const f = await fixture(); assert.equal(await f.page.locator('.np-media-toggle').count(), 0); assert.equal(f.state.covers.length, 0);
      await f.page.locator('.np-tile[data-index="1"]').click(); assert.equal(await f.page.locator('.np-detail-title').innerText(), '영상의 제목만 공개한 칸');
      assert.equal(await f.page.locator('.np-source-link').getAttribute('href'), 'https://www.youtube.com/watch?v=jNQXAC9IVRw'); await f.close();
    });
    await check('Nested owner dialog returns to the same visible tile and exact dialog scroll after long preview details', async () => {
      const f = await fixture({ query: '', viewport: { width: 820, height: 500 } }), page = f.page;
      await page.addStyleTag({ url: base + '/assets/life/blog-series.css' });
      const value = snapshot(true); value.intro = '긴 공개 소개를 읽고 아홉 칸에서 직접 고릅니다.\n'.repeat(100);
      await page.evaluate(value => {
        const dialog = document.createElement('dialog'); dialog.className = 'bs-share-dialog nine-share-dialog'; dialog.id = 'nestedPublicPreview';
        const heading = document.createElement('h2'); heading.textContent = '공개 9칸 미리보기';
        const preview = document.createElement('section'); preview.className = 'nine-share-preview';
        window.__nestedPublicView = HaedoLife.NinePublicView.render(value); preview.append(__nestedPublicView.node); dialog.append(heading, preview); document.body.append(dialog); dialog.showModal();
      }, value);
      const tile = page.locator('#nestedPublicPreview .np-tile[data-index="0"]'); await tile.scrollIntoViewIfNeeded();
      const before = await page.locator('#nestedPublicPreview').evaluate(dialog => ({ top: dialog.scrollTop, left: dialog.scrollLeft }));
      await tile.click(); await page.waitForFunction(() => document.activeElement?.matches('#nestedPublicPreview .np-detail-title'));
      const opened = await page.locator('#nestedPublicPreview').evaluate(dialog => dialog.scrollTop); assert(opened > before.top + 50);
      await page.locator('#nestedPublicPreview .np-detail-close').click();
      await page.waitForFunction(() => document.activeElement?.matches('#nestedPublicPreview .np-tile[data-index="0"]'));
      const after = await page.locator('#nestedPublicPreview').evaluate(dialog => {
        const tile = dialog.querySelector('.np-tile[data-index="0"]'), box = tile.getBoundingClientRect(), frame = dialog.getBoundingClientRect();
        return { top: dialog.scrollTop, left: dialog.scrollLeft, visible: box.top >= frame.top && box.bottom <= frame.bottom };
      });
      report.nestedScroll = { before, opened, after };
      assert(Math.abs(after.top - before.top) <= 2, 'The dialog stayed at the detail instead of the selected tile');
      assert.equal(after.left, before.left); assert.equal(after.visible, true);
      await page.evaluate(() => { __nestedPublicView.dispose(); document.querySelector('#nestedPublicPreview').close(); document.querySelector('#nestedPublicPreview').remove(); }); await f.close();
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.unexpected, []); assert.deepEqual(report.routeErrors, []); report.pass = true;
  } catch (error) {
    report.pass = false; report.error = error.stack;
    await active?.pages().at(-1)?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(cause => { report.captureError = cause.message; }); throw error;
  } finally { await active?.close(); await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

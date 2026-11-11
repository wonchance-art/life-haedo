/* 2026-11-11 뉴스 카드 피드 1단계: 20건·더 보기, 카드 구조와 글 옵션, 기사 이미지 보기(기본 꺼짐), 추가 출처.
 * npm run dev; node tests/news-card-feed-browser.cjs
 * Actual application bytes with synthetic Auth and an anonymous synthetic catalog. Article images are flat
 * colour files generated here and served for the registered image hosts by the test; no publisher, image
 * host or production request leaves the machine. Chromium viewport widths are not Apple-device checks. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, nav } = require('./unified-home-browser.cjs');
const { harnessFrameError } = require('./helpers/news-reader.cjs');
const out = path.resolve(process.env.NEWS_CARD_FEED_OUTPUT || path.join(__dirname, '../.local/news-card-feed'));
const report = { createdAt: new Date().toISOString(), scope: 'Local Chromium, synthetic Auth, synthetic catalog and generated flat-colour images only.', checks: [], consoleErrors: [], pageErrors: [], external: [], captures: [] };
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const idle = page => page.waitForFunction(() => document.querySelector('#discoveryReview')?.getAttribute('aria-busy') === 'false');
async function until(page, predicate, value, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const result = await page.evaluate(predicate, value); if (result) return result; await page.waitForTimeout(50); }
  throw new Error('Condition did not settle: ' + label);
}
// A flat three-band PNG (no photograph, no generated picture).
function png(width, height, [r, g, b]) {
  const crc = buffer => { let value = 0xffffffff; for (const byte of buffer) { let c = (value ^ byte) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; value = (value >>> 8) ^ c; } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const head = Buffer.alloc(4); head.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body)); return Buffer.concat([head, body, tail]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.alloc(1 + width * 3); for (let x = 0; x < width; x++) { const shade = x < width / 3 ? .82 : x < 2 * width / 3 ? 1 : .9; row[1 + x * 3] = r * shade; row[2 + x * 3] = g * shade; row[3 + x * 3] = b * shade; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}
const colours = [[176, 196, 188], [201, 186, 160], [160, 178, 204], [206, 170, 170], [170, 200, 170], [190, 180, 205]];
const imageHosts = { 'yna-news': 'img.yna.co.kr', 'sbs-news': 'img.sbs.co.kr', 'mit-linguistics': 'news.mit.edu' };
const articleHosts = { 'readersnews-books': 'www.readersnews.com/news/articleView.html?idxno=', 'seoul-culture': 'news.seoul.go.kr/culture/archives/', 'mit-linguistics': 'news.mit.edu/2026/synthetic-', 'yna-news': 'www.yna.co.kr/view/AKR', 'sbs-news': 'news.sbs.co.kr/news/endPage.do?news_id=N', 'nocut-news': 'www.nocutnews.co.kr/news/' };
const names = { 'readersnews-books': '독서신문', 'seoul-culture': '서울시 문화', 'mit-linguistics': 'MIT News · 언어학 · 영문', 'naver-d2': 'NAVER D2', 'yna-news': '연합뉴스', 'sbs-news': 'SBS 뉴스', 'nocut-news': '노컷뉴스' };
const titles = ['동네 도서관이 주말 낭독 모임을 다시 연다', '가을 전시 일정이 한 주 늦춰졌다는 안내가 나왔다', '새 번역으로 다시 나온 산문집', 'A synthetic note on reading aloud in small groups', '검색 색인을 다시 만든 과정', '공원 산책로 야간 조명 시범 운영'];
// Catalog in the published two-part form: the first registry in `sources`/`articles`, later sources in `extended`.
function feed({ count = 57, images = true, extended = true, extra = [] } = {}) {
  const now = Date.now(), iso = minutes => new Date(now - minutes * 60000 - 30000).toISOString();
  const rights = { mode: 'metadata_only', label: '합성 제목·링크', url: null };
  const source = (id, status = 'ok') => ({ id, name: names[id], url: 'https://' + (id === 'naver-d2' ? 'd2.naver.com' : articleHosts[id].split('/')[0]) + '/', feedUrl: 'https://' + (id === 'naver-d2' ? 'd2.naver.com' : articleHosts[id].split('/')[0]) + '/feed',
    language: id === 'mit-linguistics' ? 'en' : 'ko', rights, ...(images && imageHosts[id] ? { images: { label: '합성 이미지 주소 · 매체 서버에서 직접 표시', url: null } } : {}),
    status, stale: status !== 'ok', error: status === 'error' ? '합성 수집 실패' : null, lastSuccessAt: status === 'ok' ? iso(1) : null, lastAttemptAt: iso(1) });
  const order = extended ? ['yna-news', 'readersnews-books', 'sbs-news', 'seoul-culture', 'nocut-news', 'mit-linguistics'] : ['readersnews-books', 'seoul-culture', 'mit-linguistics'];
  const rows = Array.from({ length: count }, (_, i) => {
    const sourceId = order[i % order.length];
    return { id: 'card-' + i, sourceId, url: 'https://' + articleHosts[sourceId] + (90000 + i), title: titles[i % titles.length] + ' ' + (i + 1), language: sourceId === 'mit-linguistics' ? 'en' : 'ko', tags: [], author: null,
      publishedAt: iso(i * 3), fetchedAt: iso(1), summary: '', coverage: 'link_only', rights,
      ...(images && imageHosts[sourceId] ? { imageUrl: 'https://' + imageHosts[sourceId] + '/synthetic/' + i + '.png' } : {}) };
  }).concat(extra);
  const first = ['readersnews-books', 'seoul-culture', 'mit-linguistics'], later = ['yna-news', 'sbs-news', 'nocut-news'];
  return { schemaVersion: 1, generatedAt: iso(1), sources: [...first.map(id => source(id)), source('naver-d2', 'error')], articles: rows.filter(row => first.includes(row.sourceId)),
    ...(extended ? { extended: { sources: later.map(id => source(id)), articles: rows.filter(row => later.includes(row.sourceId)) } } : {}) };
}
const cards = page => page.locator('#discoveryList > .discovery-article');
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
async function capture(page, name) {
  const file = path.join(out, name + '.png'); await page.screenshot({ path: file }); report.captures.push(file);
  assert.equal(await overflow(page), false, name + ': horizontal overflow');
}
async function setImages(page, on) {
  await page.locator('#discoveryNewsSettings').click();
  if (!await page.locator('#discoveryOptions').evaluate(node => node.open)) await page.locator('#discoveryOptions > summary').click();
  await page.locator('#discoveryShowImages').setChecked(on); await idle(page);
  await until(page, async on => HaedoLife.DiscoverySettings.showImages(await HaedoLife.Shell.storage.readDiscoverySettings(await HaedoLife.Shell.storage.getActive())) === on, on, 'image setting saved');
  await page.locator('#discoveryNewsSettingsBack').click(); await idle(page); await frames(page);
}
const sizes = { 1440: 960, 820: 1180, 390: 844 };
// NEWS_CARD_FEED_ONLY=<part of a check name> runs just those checks (used for mutation checks while developing).
const only = process.env.NEWS_CARD_FEED_ONLY || '';

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, run, { width = 1440, catalog = feed(), oldShell = false } = {}) {
    if (only && !name.includes(only)) return;
    const server = new FakeCloud(), context = await makeContext(browser, server, 'news-card-' + report.checks.length, accounts.a, { viewport: { width, height: sizes[width] } });
    const state = { catalog, catalogRequests: 0, images: [], publisher: [], hold: null, broken: new Set(), tiny: new Set() };
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback();
      if (Object.values(imageHosts).includes(url.hostname) && url.pathname.startsWith('/synthetic/')) {
        state.images.push({ url: url.href, referer: request.headers().referer || null, cookie: request.headers().cookie || null, type: request.resourceType() });
        if (state.hold) await state.hold;
        if (state.broken.has(url.href)) return route.fulfill({ status: 404, body: '' });
        const index = Number(url.pathname.match(/(\d+)\.png$/)[1]);
        return route.fulfill({ contentType: 'image/png', body: state.tiny.has(url.href) ? png(1, 1, [0, 0, 0]) : png(640, 360, colours[index % colours.length]) });
      }
      // Opening an article from a checked source frames its publisher page (existing behaviour): a synthetic page answers.
      if (url.hostname === 'www.readersnews.com' && request.resourceType() === 'document') { state.publisher.push(url.pathname + url.search); return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>합성 출판사 응답</title><p>합성 원문 페이지</p>' }); }
      report.external.push({ check: name, url: url.origin + url.pathname }); return route.abort('blockedbyclient');
    });
    await context.route(base + '/assets/life/discovery-feed.json', route => { state.catalogRequests++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify(state.catalog) }); });
    if (oldShell) {
      // The screen as shipped before this change: the four files this work changed, from the committed fixture.
      const digests = { 'discovery.js': 'ee284b29696fc6fdaadf8efc63cd2ebf4305030514411150e009fa2321ff234b', 'discovery-ui.js': 'a03cd2f1bab7f63585897f0d121a386cc6468a3b678e239b4f0192d877b5870b',
        'discovery.css': '07a0fa3d5f27e2a418fa82e692bc8d76a8e26705168b6a6b054238eb61013127', 'discovery-settings.js': 'f6d8f710d848b15ec4b9fa4f7df2b5e295fcac5a2d1b05aee4737110606708bc' };
      for (const [file, digest] of Object.entries(digests)) {
        const body = zlib.gunzipSync(await fs.readFile(path.join(__dirname, 'fixtures/discovery-old-client', file + '.gz')));
        assert.equal(crypto.createHash('sha256').update(body).digest('hex'), digest, file + ' fixture bytes');
        await context.route(base + '/assets/life/' + file, route => route.fulfill({ contentType: file.endsWith('.css') ? 'text/css' : 'application/javascript', body }));
      }
    }
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ check: name, text: message.text() }); });
    page.on('pageerror', error => { if (harnessFrameError(error.message)) (report.harnessFrameErrors ||= []).push(name); else report.pageErrors.push({ check: name, text: error.message }); });
    try {
      await page.goto(base + '/index.html'); await ready(page);
      await nav(page, 'news'); await idle(page); await frames(page);
      await run({ page, state, server });
      report.checks.push({ name, pass: true }); console.log('PASS ' + name);
    } catch (error) {
      report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack);
      await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {});
    } finally { await context.close(); }
  }
  try {
    // ---- S1 -------------------------------------------------------------------------------------
    await check('S1 the list shows 20 of every candidate; 더 보기 adds 20, focuses the first added card and ends with the list', async ({ page, state }) => {
      assert.equal(await cards(page).count(), 20);
      assert.match(await page.locator('#discoveryDiscover').innerText(), /^전체\s*57$/, 'the tab counts every candidate, not the page');
      assert.equal(await page.locator('.discovery-page-count').innerText(), '57건 중 20건');
      const more = page.locator('#discoveryShowMore'); assert.equal(await more.innerText(), '더 보기');
      const box = await more.boundingBox(); assert(box.height >= 44 && box.width >= 44);
      // Nothing loads by scrolling to the end.
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await frames(page); await page.waitForTimeout(300);
      assert.equal(await cards(page).count(), 20); assert.equal(state.catalogRequests, 1);
      await more.focus(); await page.keyboard.press('Enter'); await frames(page);
      assert.equal(await cards(page).count(), 40);
      assert.deepEqual(await page.evaluate(() => { const card = document.activeElement.closest('#discoveryList > .discovery-article'); return [[...card.parentElement.children].indexOf(card), document.activeElement.matches('[data-discovery-select]')]; }), [20, true], 'focus on the first added card');
      const visible = await page.evaluate(() => { const rect = document.activeElement.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; }); assert.equal(visible, true, 'the focused card is on screen');
      assert.equal(await page.locator('.discovery-page-count').innerText(), '57건 중 40건');
      await page.locator('#discoveryShowMore').click(); await frames(page);
      assert.equal(await cards(page).count(), 57); assert.equal(await page.locator('#discoveryShowMore').count(), 0, 'no button when nothing is left');
      assert.equal(await page.locator('.discovery-page-count').count(), 0);
      assert.equal(await page.evaluate(() => { const card = document.activeElement.closest('#discoveryList > .discovery-article'); return [...card.parentElement.children].indexOf(card); }), 40);
      // A1: to the end every article exactly once; each page of 20 newest first with at most three of one publisher
      // (a page is filled past that only when too few publishers are left to fill it).
      const shown = await cards(page).evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.discoveryId, time: node.querySelector('time')?.getAttribute('datetime'), url: node.dataset.discoveryUrl })));
      assert.equal(shown.length, 57); assert.deepEqual(new Set(shown.map(card => card.id)), new Set(Array.from({ length: 57 }, (_, i) => 'card-' + i)), 'no card missing or twice');
      const publisherOf = await page.evaluate(urls => urls.map(url => { const article = [...document.querySelectorAll('#discoveryList > .discovery-article')].find(node => node.dataset.discoveryUrl === url); return article.querySelector('.discovery-source-name').textContent; }), shown.map(card => card.url));
      for (let at = 0; at < 57; at += 20) {
        const page_ = shown.slice(at, at + 20), names_ = publisherOf.slice(at, at + 20), tally = {};
        for (const name of names_) tally[name] = (tally[name] || 0) + 1;
        assert.deepEqual(page_.map(card => card.time), [...page_.map(card => card.time)].sort().reverse(), 'page ' + at / 20 + ' newest first');
        const left = {}; for (const name of publisherOf.slice(at)) left[name] = (left[name] || 0) + 1;
        if (Object.values(left).reduce((sum, count) => sum + Math.min(3, count), 0) >= page_.length) assert(Math.max(...Object.values(tally)) <= 3, 'page ' + at / 20 + ': ' + JSON.stringify(tally));
      }
      assert.deepEqual(shown.map(card => card.id), await page.evaluate(() => HaedoLife.Discovery.spreadLatest([...document.querySelectorAll('#discoveryList > .discovery-article')]
        .map(node => ({ id: node.dataset.discoveryId, article: { sourceId: node.dataset.sourceId || '', sourceName: node.querySelector('.discovery-source-name').textContent, canonicalUrl: node.dataset.discoveryUrl, sortDate: node.querySelector('time')?.getAttribute('datetime') || null } }))).map(row => row.id)), 'the shared rule');
    });
    await check('S1 a short list has no 더 보기', async ({ page }) => {
      assert.equal(await cards(page).count(), 20); assert.equal(await page.locator('#discoveryShowMore').count(), 0); assert.equal(await page.locator('.discovery-page-count').count(), 0);
    }, { catalog: feed({ count: 20 }) });
    await check('S1 tab, order, source, language and a requested refresh start again at 20', async ({ page, state }) => {
      const expand = async () => { await page.locator('#discoveryShowMore').click(); await frames(page); assert.equal(await cards(page).count(), 40); };
      await expand();
      await page.locator('#discoveryBookmarked').click(); await frames(page); await page.locator('#discoveryDiscover').click(); await frames(page);
      assert.equal(await cards(page).count(), 20, 'tab');
      await expand();
      await page.locator('#discoveryFilterToggle').click(); await page.locator('#discoverySort').selectOption('related'); await frames(page);
      await page.locator('#discoveryFilterToggle').click(); await page.locator('#discoverySort').selectOption('latest'); await frames(page);
      assert.equal(await cards(page).count(), 20, 'order');
      await expand();
      await page.locator('#discoveryFilterToggle').click(); await page.locator('#discoveryRefreshNow').click(); await idle(page); await frames(page);
      assert.equal(state.catalogRequests, 2); assert.equal(await cards(page).count(), 20, 'refresh');
      await expand();
      await page.locator('#discoveryNewsSettings').click(); await page.locator('#discoveryOptions > summary').click();
      await page.locator('#discoverySource-nocut-news').uncheck(); await idle(page); await page.locator('#discoveryNewsSettingsBack').click(); await idle(page); await frames(page);
      assert.equal(await cards(page).count(), 20, 'source'); assert.match(await page.locator('#discoveryDiscover').innerText(), /^전체\s*48$/);
      await expand();
      await page.locator('#discoveryNewsSettings').click(); await page.locator('#discoveryLanguageSummary').click();
      await page.locator('#discoveryLanguage-all').uncheck(); await idle(page); await page.locator('#discoveryLanguage-ko').check(); await idle(page);
      await page.locator('#discoveryNewsSettingsBack').click(); await idle(page); await frames(page);
      assert.equal(await cards(page).count(), 20, 'language'); assert.match(await page.locator('#discoveryDiscover').innerText(), /^전체\s*39$/);
    });
    await check('S1 담기 and 읽음 keep the opened count, the scroll position and focus', async ({ page }) => {
      await page.locator('#discoveryShowMore').click(); await frames(page);
      const ids = () => cards(page).evaluateAll(nodes => nodes.map(node => node.dataset.discoveryId));
      const drawn = await ids(), targetId = drawn[30], nextId = drawn[31];
      const target = cards(page).nth(30); await target.scrollIntoViewIfNeeded(); await frames(page);
      const before = await page.evaluate(() => scrollY);
      await target.locator('[data-discovery-reaction=bookmarked]').click(); await idle(page); await frames(page);
      assert.equal(await cards(page).count(), 40); assert(Math.abs(await page.evaluate(() => scrollY) - before) <= 2, 'scroll kept after 담기');
      assert.deepEqual(await page.evaluate(() => [document.activeElement.dataset.discoveryReaction, document.activeElement.closest('[data-discovery-id]').dataset.discoveryId, document.activeElement.getAttribute('aria-pressed')]), ['bookmarked', targetId, 'true']);
      assert.deepEqual(await ids(), drawn, 'A1: 담기 moves no card');
      assert.match(await page.locator('#discoveryBookmarked').innerText(), /^담은 글\s*1$/);
      await target.locator('.discovery-card-more > summary').click(); await frames(page);
      await target.locator('[data-discovery-feedback=already_read]').click(); await idle(page); await frames(page);
      assert.equal(await cards(page).count(), 40, 'the next article fills the page'); assert.equal(await page.locator('#discoveryList [data-discovery-id="' + targetId + '"]').count(), 0);
      assert.deepEqual((await ids()).slice(0, 39), drawn.filter(id => id !== targetId), 'A1: the cards already drawn keep their places after 읽음');
      assert(Math.abs(await page.evaluate(() => scrollY) - before) <= 2, 'scroll kept after 읽음');
      assert.equal(await page.evaluate(() => document.activeElement.closest('#discoveryList > .discovery-article')?.dataset.discoveryId), nextId, 'focus moves to the card now in that place');
      assert.equal(await page.locator('#discoveryUndoToast').count(), 1);
    });
    for (const width of [1440, 820, 390]) {
      await check('S1 returning from the reader keeps the place and the opened count at ' + width, async ({ page }) => {
        await page.locator('#discoveryShowMore').click(); await frames(page);
        const target = cards(page).nth(33); await target.scrollIntoViewIfNeeded(); await frames(page);
        const before = await page.evaluate(() => scrollY); assert(before > 0);
        await target.locator('[data-discovery-select]').click(); await idle(page); await page.locator('#discoveryReader').waitFor();
        await page.locator('#discoveryReaderBack').click(); await idle(page); await frames(page); await frames(page);
        assert.equal(await cards(page).count(), 40);
        assert(Math.abs(await page.evaluate(() => scrollY) - before) <= 2, 'scroll restored');
        assert.equal(await page.evaluate(() => document.activeElement.closest('[data-discovery-id]')?.dataset.discoveryId), 'card-33');
      }, { width });
    }

    // ---- S2 -------------------------------------------------------------------------------------
    await check('S2 card structure, tab order, elapsed time and what a card does not show', async ({ page }) => {
      const shape = await cards(page).first().evaluate(card => ({ card: [...card.children].map(child => child.className), foot: [...card.querySelector('.discovery-card-foot').children].map(child => child.tagName + '.' + child.className.split(' ').slice(-1)[0]),
        open: [...card.querySelector('[data-discovery-select]').children].map(child => child.className), nested: card.querySelectorAll('button button, button a, button summary, button details, a button, summary button').length,
        describedBy: card.querySelector('[data-discovery-select]').getAttribute('aria-describedby'), metaId: card.querySelector('.discovery-meta').id }));
      assert.deepEqual(shape.card, ['discovery-row-open', 'discovery-card-foot']);
      assert.deepEqual(shape.foot, ['SPAN.discovery-meta', 'BUTTON.discovery-reaction', 'DETAILS.discovery-card-more']);
      assert.deepEqual(shape.open, ['discovery-title'], 'a text card when images are off'); assert.equal(shape.nested, 0, 'no control inside another control');
      assert(shape.describedBy && shape.describedBy === shape.metaId, 'the open control is described by its source and time');
      // Keyboard: card, 담기, ⋯, then the next card.
      await cards(page).first().locator('[data-discovery-select]').focus();
      const stops = [];
      for (let i = 0; i < 4; i++) { stops.push(await page.evaluate(() => { const el = document.activeElement, card = el.closest('#discoveryList > .discovery-article'); return [[...card.parentElement.children].indexOf(card), el.matches('[data-discovery-select]') ? 'card' : el.dataset.discoveryReaction ? '담기' : el.tagName === 'SUMMARY' ? '⋯' : el.tagName]; })); await page.keyboard.press('Tab'); }
      assert.deepEqual(stops, [[0, 'card'], [0, '담기'], [0, '⋯'], [1, 'card']]);
      assert.equal(await cards(page).first().locator('.discovery-card-more > summary').getAttribute('aria-label'), '글 옵션: ' + await cards(page).first().locator('.discovery-title').innerText());
      assert.equal(await cards(page).first().locator('[data-discovery-reaction]').getAttribute('aria-label'), '담기');
      // Elapsed time with the exact time kept in <time>.
      const meta = id => page.locator('#discoveryList [data-discovery-id="' + id + '"] .discovery-meta');
      const time = async id => { const node = meta(id).locator('time'); return await node.count() ? { text: await node.innerText(), iso: await node.getAttribute('datetime'), title: await node.getAttribute('title') } : null; };
      assert.equal((await time('age-now')).text, '방금'); assert.equal((await time('age-minutes')).text, '7분 전'); assert.equal((await time('age-hours')).text, '3시간 전');
      assert.equal((await time('age-days')).text, '3일 전'); assert.equal((await time('age-week')).text, '7일 전');
      const old = await time('age-old'); assert.match(old.text, /^(\d{4}\.)?\d{1,2}\.\d{1,2}$/, 'a date after a week'); assert.doesNotMatch(old.text, /전|:/);
      for (const id of ['age-now', 'age-minutes', 'age-hours', 'age-days', 'age-week', 'age-old']) { const value = await time(id); assert.match(value.iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); assert.match(value.title, /\d{4}년 \d{1,2}월 \d{1,2}일.*\d{2}:\d{2}/, 'exact time in title'); }
      assert.equal(await time('age-unknown'), null, 'an unknown publication date shows no time');
      assert.match(await meta('age-minutes').innerText(), /^연합뉴스\s*7분 전$/);
      assert.equal(await meta('age-minutes').locator('time').evaluate(node => getComputedStyle(node, '::before').content.includes('·')), true, 'source · time');
      assert.match(await meta('age-english').innerText(), /EN/);
      // Not on a card: counts, publisher icons, summaries, placeholder pictures, shadows or boxes.
      const plain = await cards(page).evaluateAll(nodes => nodes.map(node => ({ images: node.querySelectorAll('img, picture, canvas, [style*="background-image"]').length, shadow: getComputedStyle(node).boxShadow, background: getComputedStyle(node).backgroundColor, radius: getComputedStyle(node).borderRadius,
        border: getComputedStyle(node).borderBottomWidth, text: node.innerText })));
      for (const card of plain) { assert.equal(card.images, 0); assert.equal(card.shadow, 'none'); assert.equal(card.background, 'rgba(0, 0, 0, 0)'); assert.equal(card.radius, '0px'); assert.equal(card.border, '1px'); assert.doesNotMatch(card.text, /조회|공유\s*\d|댓글|좋아요\s*\d/); }
      // Two-line title in Korean word units.
      const title = await page.locator('#discoveryList [data-discovery-id="age-long"] .discovery-title').evaluate(node => ({ lines: Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)), clipped: node.scrollHeight > node.clientHeight + 1, wordBreak: getComputedStyle(node).wordBreak }));
      assert.deepEqual(title, { lines: 2, clipped: true, wordBreak: 'keep-all' });
    }, { width: 390, catalog: (() => {
      const now = Date.now(), at = minutes => new Date(now - minutes * 60000 - 30000).toISOString(), rights = { mode: 'metadata_only', label: '합성 제목·링크', url: null };
      const row = (id, minutes, extra = {}) => ({ id, sourceId: 'yna-news', url: 'https://www.yna.co.kr/view/' + id, title: '경과 시간 표기 ' + id, language: 'ko', tags: [], author: null, publishedAt: minutes === null ? null : at(minutes), fetchedAt: at(1), summary: '', coverage: 'link_only', rights, ...extra });
      const catalog = feed({ count: 6, images: false });
      catalog.extended.articles.push(row('age-now', 0), row('age-minutes', 7), row('age-hours', 190), row('age-days', 3 * 1440 + 60), row('age-week', 7 * 1440 + 60), row('age-old', 9 * 1440), row('age-unknown', null),
        row('age-english', 20, { language: 'en', title: 'Synthetic English headline' }), row('age-long', 25, { title: '아주 긴 제목이 두 줄을 넘어갈 때 말줄임이 어떻게 보이는지 확인하려고 일부러 길게 적은 합성 문장입니다 끝까지 읽히지 않아야 하며 낱말 가운데에서 줄이 바뀌지 않아야 합니다 그래서 더 길게 적습니다' }));
      return catalog;
    })() });
    await check('S2 a card ⋯ opens the reader\'s 글 옵션; Escape and an outside press close it; a choice acts on that article', async ({ page }) => {
      const list = page.locator('#discoveryList');
      assert.equal(await list.locator('[data-discovery-feedback], [data-discovery-import], .discovery-more-body').count(), 0, 'a closed menu adds no hidden controls');
      const first = cards(page).nth(1), summary = first.locator('.discovery-card-more > summary');
      await summary.click(); await frames(page);
      assert.equal(await first.locator('.discovery-card-more').evaluate(node => node.open), true);
      const labels = async scope => scope.locator('.discovery-more-body').evaluate(body => [...body.children].map(child => (child.matches('details') ? child.querySelector('summary') : child).textContent.trim()));
      const cardLabels = await labels(first); assert.deepEqual(cardLabels, ['링크를 자료에 보관', '읽음', '관련 없음', '기사 정보']);
      const panel = await first.locator('.discovery-more-body').boundingBox(), viewport = page.viewportSize();
      assert(panel.x >= 0 && panel.x + panel.width <= viewport.width + 1, 'menu inside the screen');
      for (const item of await first.locator('.discovery-more-body .life-button').all()) assert((await item.boundingBox()).height >= 44);
      await page.keyboard.press('Escape'); await frames(page);
      assert.equal(await first.locator('.discovery-card-more').evaluate(node => node.open), false);
      assert.equal(await summary.evaluate(node => node === document.activeElement), true, 'Escape returns focus to ⋯');
      assert.equal(await list.locator('.discovery-more-body').count(), 0);
      // Outside press, and one menu at a time.
      // (The open panel covers the next two cards, so the other ⋯ is one further down.)
      await summary.click(); await frames(page); await cards(page).nth(6).locator('.discovery-card-more > summary').click(); await frames(page);
      assert.deepEqual(await list.locator('.discovery-card-more').evaluateAll(nodes => nodes.map((node, index) => node.open ? index : -1).filter(index => index >= 0)), [6]);
      await page.locator('#discoveryDiscover').dispatchEvent('pointerdown'); await frames(page);
      assert.equal(await list.locator('.discovery-card-more[open]').count(), 0, 'pressing elsewhere closes the menu');
      // The menu survives a redraw of the list (담기 on another card) and keeps its place in the document.
      await summary.click(); await frames(page); await first.locator('.discovery-article-info > summary').click(); await frames(page);
      assert.match(await first.locator('.discovery-article-info').innerText(), /링크와 제목만 확보/);
      // The same choices as the reader of that article.
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await frames(page);
      const url = await first.getAttribute('data-discovery-url'), id = await first.getAttribute('data-discovery-id');
      await first.locator('[data-discovery-select]').click(); await idle(page); await page.locator('#discoveryReader').waitFor();
      await page.locator('#discoveryReader .discovery-more > summary').click(); await frames(page);
      assert.deepEqual(await labels(page.locator('#discoveryReader')), cardLabels, 'card menu and reader menu offer the same choices');
      await page.locator('#discoveryReaderBack').click(); await idle(page); await frames(page);
      // 관련 없음 from the card: the card leaves, 되돌리기 puts it back.
      await summary.click(); await frames(page); await first.locator('[data-discovery-feedback=not_relevant]').click(); await idle(page); await frames(page);
      assert.equal(await list.locator('[data-discovery-id="' + id + '"]').count(), 0); assert.equal(await cards(page).count(), 20);
      assert.match(await page.locator('#discoveryExcluded').innerText(), /^제외한 글\s*1$/);
      await page.locator('#discoveryUndoToast').click(); await idle(page); await frames(page);
      assert.equal(await list.locator('[data-discovery-url="' + url + '"]').count(), 1);
      // 제외한 글 tab keeps the card shape with 되돌리기.
      await summary.click(); await frames(page); await first.locator('[data-discovery-feedback=already_read]').click(); await idle(page);
      await page.locator('#discoveryExcluded').click(); await frames(page);
      const excluded = cards(page).first();
      assert.deepEqual(await excluded.evaluate(card => [...card.querySelector('.discovery-card-foot').children].map(child => child.className.split(' ').slice(-1)[0])), ['discovery-meta', 'discovery-restore']);
      assert.match(await excluded.locator('.discovery-meta').innerText(), /^읽음/);
      await excluded.locator('[data-discovery-restore]').click(); await idle(page); await frames(page);
      assert.equal(await cards(page).count(), 0);
    }, { width: 390 });
    for (const width of [1440, 820, 390]) {
      await check('S2 no horizontal overflow, 44px targets and the reading split at ' + width, async ({ page }) => {
        const targets = async () => page.evaluate(() => [...document.querySelectorAll('#discoveryList [data-discovery-select], #discoveryList .discovery-reaction, #discoveryList .discovery-card-more > summary, #discoveryShowMore')]
          .filter(node => node.getClientRects().length).map(node => { const rect = node.getBoundingClientRect(); return [node.className, Math.round(rect.width), Math.round(rect.height)]; }).filter(([, w, h]) => w < 44 || h < 44));
        assert.deepEqual(await targets(), [], 'text cards'); await capture(page, 'cards-off-' + width);
        const columns = await page.evaluate(() => { const first = document.querySelector('#discoveryList > .discovery-article').getBoundingClientRect(); return { width: Math.round(first.width), lefts: new Set([...document.querySelectorAll('#discoveryList > .discovery-article')].map(node => Math.round(node.getBoundingClientRect().left))).size }; });
        assert.equal(columns.lefts, 1, 'one column'); assert(columns.width <= 680, 'card width up to 680px');
        // A2: with the list alone, the tabs and tools, the cards and 더 보기 share one column; at 1440 it is 680px and
        // the last header icon and a card's ⋯ end on the same line. 820 and 390 use the screen width.
        const a2 = await page.evaluate(() => {
          const visible = nodes => [...nodes].filter(node => node.getClientRects().length).map(node => node.getBoundingClientRect());
          const pane = document.querySelector('#discoveryListPane').getBoundingClientRect(), toolbar = document.querySelector('.discovery-news-toolbar').getBoundingClientRect();
          const controls = visible(document.querySelectorAll('.discovery-news-toolbar button, .discovery-news-toolbar summary'));
          const card = document.querySelector('#discoveryList > .discovery-article').getBoundingClientRect(), more = document.querySelector('#discoveryList .discovery-card-more > summary').getBoundingClientRect();
          const row = document.querySelector('.discovery-page-row').getBoundingClientRect(), layout = document.querySelector('.discovery-layout').getBoundingClientRect();
          return { pane: Math.round(pane.width), layout: Math.round(layout.width), toolbar: [Math.round(toolbar.left), Math.round(toolbar.right)], card: [Math.round(card.left), Math.round(card.right)], row: [Math.round(row.left), Math.round(row.right)],
            iconRight: Math.round(Math.max(...controls.map(rect => rect.right))), moreRight: Math.round(more.right) };
        });
        (report.columns ||= {})[width] = a2;
        assert.deepEqual(a2.toolbar, a2.card, 'the header row and the cards share both edges'); assert.deepEqual(a2.row, a2.card, '더 보기 row in the same column');
        assert(Math.abs(a2.iconRight - a2.moreRight) <= 1, 'header icon and card ⋯ on one vertical line: ' + a2.iconRight + ' / ' + a2.moreRight);
        if (width === 1440) assert.equal(a2.pane, 680, 'one 680px column');
        else assert.equal(a2.pane, a2.layout, 'the screen width is used');
        await setImages(page, true); await page.waitForLoadState('networkidle'); await frames(page);
        assert.deepEqual(await targets(), [], 'image cards');
        const media = await page.locator('#discoveryList .discovery-card-media').first().evaluate(node => { const rect = node.getBoundingClientRect(), card = node.closest('.discovery-article').getBoundingClientRect(); return { ratio: rect.width / rect.height, width: Math.round(rect.width), card: Math.round(card.width), radius: getComputedStyle(node).borderRadius, fit: getComputedStyle(node.firstElementChild).objectFit }; });
        assert(Math.abs(media.ratio - 16 / 9) < 0.02, '16:9 box'); assert.equal(media.width, media.card); assert.equal(media.radius, '14px'); assert.equal(media.fit, 'cover');
        await capture(page, 'cards-on-' + width);
        await cards(page).nth(1).locator('.discovery-card-more > summary').click(); await frames(page); await capture(page, 'card-menu-' + width); await page.keyboard.press('Escape');
        await cards(page).first().locator('[data-discovery-select]').click(); await idle(page); await page.locator('#discoveryReader').waitFor(); await frames(page);
        assert.equal(await overflow(page), false, 'reader open');
        if (width === 1440) {
          // Beside the reader the list narrows: the image becomes a thumbnail next to the title.
          const split = await page.evaluate(() => { const card = document.querySelector('#discoveryList > .discovery-article[data-image]'), media = card.querySelector('.discovery-card-media').getBoundingClientRect(), title = card.querySelector('.discovery-title').getBoundingClientRect(), pane = document.querySelector('#discoveryListPane').getBoundingClientRect(); return { media: Math.round(media.width), beside: media.left >= title.right - 1 && media.top < title.bottom, pane: Math.round(pane.width) }; });
          assert.equal(split.media, 96); assert.equal(split.beside, true); assert(split.pane <= 440 + 1);
          await capture(page, 'cards-split-' + width);
          // At the narrowest list the card still fits.
          await page.locator('.discovery-layout > .haedo-split-handle').focus(); await page.keyboard.press('Home'); await frames(page); await frames(page);
          assert.equal(await overflow(page), false); assert.deepEqual(await targets(), [], 'narrowest split');
          const narrow = await page.evaluate(() => ({ pane: Math.round(document.querySelector('#discoveryListPane').getBoundingClientRect().width),
            cards: [...document.querySelectorAll('#discoveryList > .discovery-article')].slice(0, 6).map(card => { const box = card.getBoundingClientRect(), foot = card.querySelector('.discovery-card-foot'), last = foot.lastElementChild.getBoundingClientRect();
              return { foot: foot.scrollWidth <= foot.clientWidth + 1, inside: last.right <= box.right + 1, title: Math.round(card.querySelector('.discovery-title').getBoundingClientRect().width) }; }) }));
          assert.equal(narrow.pane, 280, 'the list at its narrowest');
          for (const card of narrow.cards) { assert.equal(card.foot, true); assert.equal(card.inside, true, '⋯ stays inside the card'); assert(card.title >= 160, 'title keeps a readable width: ' + card.title); }
          await capture(page, 'cards-split-narrow-' + width);
        }
      }, { width });
    }

    // ---- S3 -------------------------------------------------------------------------------------
    await check('S3 off by default: one same-origin catalog request, no image element and no image request', async ({ page, state }) => {
      assert.equal(await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return HaedoLife.DiscoverySettings.showImages(await s.readDiscoverySettings(await s.getActive())); }), false);
      assert.equal(state.catalog.extended.articles.some(article => article.imageUrl), true, 'the catalog does carry image addresses');
      await page.locator('#discoveryShowMore').click(); await frames(page); await page.locator('#discoveryShowMore').click(); await frames(page);
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(400);
      await cards(page).nth(2).locator('[data-discovery-select]').click(); await idle(page); await page.locator('#discoveryReader').waitFor(); await page.waitForTimeout(300);
      assert.equal(await page.locator('#discoveryReview img, #discoveryReview .discovery-card-media').count(), 0);
      assert.equal(await page.evaluate(() => /img\.yna\.co\.kr|img\.sbs\.co\.kr/.test(document.querySelector('#discoveryReview').innerHTML)), false, 'no image address in the page');
      assert.deepEqual(state.images, []); assert.equal(state.catalogRequests, 1);
      assert.deepEqual(state.publisher, [], 'the article opened here (card-2, SBS) is not a framed source: no publisher request at all');
      assert.deepEqual(report.external.filter(entry => entry.check.startsWith('S3 off')), [], 'no request left the app origin');
      // The setting says what turning it on does, and is off.
      await page.locator('#discoveryReaderBack').click(); await idle(page);
      await page.locator('#discoveryFilterToggle').click(); await page.locator('#discoveryFilterImages').click(); await frames(page);
      const toggle = page.locator('#discoveryShowImages');
      assert.equal(await toggle.isChecked(), false); assert.equal(await toggle.evaluate(node => node === document.activeElement), true, 'the filter link lands on the setting');
      assert.equal(await page.locator('label:has(#discoveryShowImages)').innerText(), '기사 이미지 보기');
      assert.match(await page.locator('#' + await toggle.getAttribute('aria-describedby')).innerText(), /각 매체 서버에서 기사 이미지를 받습니다.*접속 사실을 알 수 있습니다.*꺼 두면 이미지를 요청하지 않습니다/);
      const box = await page.locator('label:has(#discoveryShowImages)').boundingBox(); assert(box.height >= 44);
      assert.deepEqual(state.images, []);
    });
    await check('S3 on: lazy no-referrer images in a reserved box; failed and empty images leave text cards; off removes them', async ({ page, state, server }) => {
      const catalog = state.catalog, withImage = [...catalog.articles, ...catalog.extended.articles].filter(article => article.imageUrl);
      const broken = withImage.find(article => article.id === 'card-2').imageUrl, tiny = withImage.find(article => article.id === 'card-6').imageUrl;
      state.broken.add(broken); state.tiny.add(tiny);
      let release; state.hold = new Promise(resolve => { release = resolve; });
      const position = () => page.evaluate(() => [...document.querySelectorAll('#discoveryList > .discovery-article')].slice(0, 2).map(card => [Math.round(card.getBoundingClientRect().top + scrollY), Math.round(card.getBoundingClientRect().height)]));
      await setImages(page, true);
      await until(page, () => document.querySelectorAll('#discoveryList .discovery-card-media').length > 0, null, 'image boxes');
      const reserved = await position();
      const attributes = await page.locator('#discoveryList .discovery-card-media > img').evaluateAll(nodes => nodes.map(node => ({ loading: node.getAttribute('loading'), decoding: node.getAttribute('decoding'), referrer: node.getAttribute('referrerpolicy'), alt: node.getAttribute('alt'), cross: node.getAttribute('crossorigin'), inButton: !!node.closest('[data-discovery-select]') })));
      assert(attributes.length >= 10);
      for (const image of attributes) assert.deepEqual(image, { loading: 'lazy', decoding: 'async', referrer: 'no-referrer', alt: '', cross: null, inButton: true });
      const listed = await cards(page).evaluateAll(nodes => nodes.map(node => [node.dataset.discoveryId, !!node.querySelector('.discovery-card-media'), node.dataset.image || null]));
      for (const [id, has, flag] of listed) { const article = [...catalog.articles, ...catalog.extended.articles].find(value => value.id === id); assert.equal(has, !!article.imageUrl, id); assert.equal(flag, article.imageUrl ? 'true' : null); }
      assert(listed.some(([, has]) => !has), 'articles without an image are text cards in the same list');
      release(); state.hold = null; await page.waitForLoadState('networkidle'); await frames(page);
      assert.deepEqual(await position(), reserved, 'a loading image moves nothing');
      // Only images near the screen were requested.
      const firstPass = state.images.length; assert(firstPass > 0 && firstPass < withImage.slice(0, 20).length, 'images far below wait: ' + firstPass);
      for (const request of state.images) { assert.equal(request.referer, null, 'no Referer'); assert.equal(request.cookie, null); assert.equal(request.type, 'image'); }
      // A missing image and a 1px image leave a text card.
      await cards(page).nth(6).scrollIntoViewIfNeeded();
      await until(page, () => ['card-2', 'card-6'].every(id => { const card = document.querySelector('#discoveryList [data-discovery-id="' + id + '"]'); return card && !card.querySelector('.discovery-card-media') && !card.dataset.image && card.querySelector('.discovery-title').textContent; }), null, 'failed images removed');
      // A redraw (담기) neither recreates an image element nor asks for it again.
      await page.evaluate(() => scrollTo(0, 0)); await frames(page);
      await page.evaluate(() => { for (const node of document.querySelectorAll('#discoveryList .discovery-card-media > img')) node.dataset.probe = 'kept'; });
      const before = state.images.length, shown = await page.locator('#discoveryList .discovery-card-media > img').count();
      await cards(page).first().locator('[data-discovery-reaction=bookmarked]').click(); await idle(page); await frames(page); await page.waitForTimeout(300);
      assert.equal(await page.locator('#discoveryList .discovery-card-media > img[data-probe=kept]').count(), shown); assert.equal(state.images.length, before, 'no repeat request on redraw');
      assert.equal(state.images.filter(request => request.url === broken).length, 1, 'a failed image is not retried');
      // The choice is the account's news setting (same document as the other news options).
      const stored = await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.readDiscoverySettings(await s.getActive()); });
      assert.deepEqual(stored.disabledSourceIds, ["option-images-on"]); assert.deepEqual(Object.keys(stored).sort(), ["autoRefresh", "deleted", "disabledInterestIds", "disabledSourceIds", "revision", "schemaVersion", "updatedAt", "workspaceId"]); assert.equal(stored.schemaVersion, 1); assert.equal(stored.autoRefresh, false);
      report.settingsUploads = server.writes().filter(write => /discoverySettings/.test(JSON.stringify(write))).length;
      await page.reload(); await ready(page); await nav(page, 'news'); await idle(page);
      await until(page, () => document.querySelectorAll('#discoveryList .discovery-card-media > img').length > 0, null, 'images after reload');
      // 기사 정보 states the image terms of that source.
      const imageCard = page.locator('#discoveryList > .discovery-article[data-image]').first();
      await imageCard.locator('.discovery-card-more > summary').click(); await imageCard.locator('.discovery-article-info > summary').click(); await frames(page);
      assert.match(await imageCard.locator('.discovery-article-info').innerText(), /합성 이미지 주소 · 매체 서버에서 직접 표시/); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
      // Off: elements go, pending loads stop, and nothing is requested afterwards.
      await setImages(page, false);
      assert.equal(await page.locator('#discoveryReview img, #discoveryReview .discovery-card-media').count(), 0);
      const after = state.images.length;
      await page.locator('#discoveryShowMore').click(); await frames(page); await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(400);
      assert.equal(state.images.length, after, 'no image request after turning it off');
      assert.deepEqual(await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return (await s.readDiscoverySettings(await s.getActive())).disabledSourceIds; }), ["option-images-off"]);
    }, { width: 390 });
    await check('S3 a catalog without image fields shows text cards with the setting on', async ({ page, state }) => {
      await setImages(page, true); await page.waitForTimeout(300);
      assert.equal(await cards(page).count(), 20); assert.equal(await page.locator('#discoveryReview img, #discoveryReview .discovery-card-media').count(), 0); assert.deepEqual(state.images, []);
      assert.equal(await page.locator('#discoveryError').isVisible(), false);
    }, { catalog: feed({ images: false, extended: false }) });
    await check('S3 an image address outside the registered host or on an unreviewed source is never requested', async ({ page, state }) => {
      await setImages(page, true); await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
      const has = id => page.locator('#discoveryList [data-discovery-id="' + id + '"] .discovery-card-media').count();
      assert.equal(await has('bad-host'), 0); assert.equal(await has('bad-scheme'), 0); assert.equal(await has('bad-data'), 0); assert.equal(await has('unreviewed'), 0); assert.equal(await has('good'), 1);
      assert.equal(await page.locator('#discoveryList [data-discovery-id]').count(), 5, 'every article is still listed');
      assert.deepEqual(state.images.map(request => request.url), ['https://img.yna.co.kr/synthetic/1.png']);
      assert.deepEqual(report.external.filter(entry => entry.check.startsWith('S3 an image address')), []);
    }, { catalog: (() => {
      const catalog = feed({ count: 0 }), now = Date.now(), at = minutes => new Date(now - minutes * 60000).toISOString(), rights = { mode: 'metadata_only', label: '합성 제목·링크', url: null };
      const row = (id, sourceId, host, imageUrl, minutes) => ({ id, sourceId, url: 'https://' + host + '/view/' + id, title: '이미지 주소 검증 ' + id, language: 'ko', tags: [], author: null, publishedAt: at(minutes), fetchedAt: at(1), summary: '', coverage: 'link_only', rights, imageUrl });
      catalog.extended.articles.push(row('good', 'yna-news', 'www.yna.co.kr', 'https://img.yna.co.kr/synthetic/1.png', 5), row('bad-host', 'yna-news', 'www.yna.co.kr', 'https://tracker.example/synthetic/2.png', 6),
        row('bad-scheme', 'yna-news', 'www.yna.co.kr', 'http://img.yna.co.kr/synthetic/3.png', 7), row('bad-data', 'yna-news', 'www.yna.co.kr', 'data:image/png;base64,iVBORw0KGgo=', 8), row('unreviewed', 'nocut-news', 'www.nocutnews.co.kr', 'https://img.yna.co.kr/synthetic/4.png', 9));
      return catalog;
    })() });
    await check('S3 the screen shipped before this change still lists articles from the new catalog', async ({ page, state }) => {
      // The older screen: five rows, the row layout, the first registry only. Its list is not empty and shows no error.
      assert.equal(await page.locator('#discoveryList > .discovery-article').count(), 5);
      assert.equal(await page.locator('#discoveryList .discovery-card-foot').count(), 0, 'this is the older row layout');
      const sources = await page.locator('#discoveryList .discovery-source-name').evaluateAll(nodes => [...new Set(nodes.map(node => node.textContent))]);
      assert(sources.length > 0 && sources.every(name => ['독서신문', '서울시 문화', 'MIT News · 언어학 · 영문'].includes(name)), 'first-registry sources: ' + sources.join(','));
      assert.equal(await page.locator('#discoveryError').isVisible(), false);
      assert.equal(await page.locator('#discoveryReview img').count(), 0); assert.deepEqual(state.images, []);
      assert.equal(state.catalog.extended.sources.length, 3, 'the catalog served is the new two-part form with image addresses');
    }, { oldShell: true });

    await check('S3 a reading comparison starts with images on and added sources; image links stay out of the saved comparison', async ({ page }) => {
      await setImages(page, true);
      await page.locator('#discoveryNewsSettings').click();
      if (!await page.locator('#discoveryNewsPreferences').evaluate(node => node.open)) await page.locator('#discoveryNewsPreferences > summary').click();
      if (!await page.locator('#discoveryReadingComparison').evaluate(node => node.open)) await page.locator('#discoveryReadingSummary').click();
      await page.locator('#discoveryReadingStart').click();
      const saved = await until(page, async () => { const s = HaedoLife.Shell.storage, value = await s.readDiscoveryReading(await s.getActive()); return value.session ? JSON.stringify(value) : null; }, null, 'comparison saved');
      const session = JSON.parse(saved).session;
      assert.deepEqual(session.conditions.sourceIds, ['readersnews-books', 'seoul-culture', 'mit-linguistics', 'naver-d2', 'yna-news', 'sbs-news', 'nocut-news']);
      assert.equal(session.lists.latest.length, 2); assert.equal(/imageUrl|"images"|synthetic\/\d+\.png/.test(saved), false, 'no image link in the comparison');
      assert.equal(await page.locator('#discoveryReadingError').innerText(), '');
    });

    // ---- S4 -------------------------------------------------------------------------------------
    await check('S4 added sources are listed with the first registry, can be turned off, and an unregistered source is refused', async ({ page, state }) => {
      const sources = await cards(page).evaluateAll(nodes => nodes.map(node => node.querySelector('.discovery-source-name').textContent));
      assert.deepEqual([...new Set(sources)].sort(), ['MIT News · 언어학 · 영문', 'SBS 뉴스', '노컷뉴스', '독서신문', '서울시 문화', '연합뉴스'].sort(), 'both parts in one list');
      assert(Math.max(...Object.values(sources.reduce((count, name) => ({ ...count, [name]: (count[name] || 0) + 1 }), {}))) <= 4, 'no source holds the first page of this catalog');
      await page.locator('#discoveryNewsSettings').click(); await page.locator('#discoveryOptions > summary').click();
      const choices = await page.locator('.discovery-source-choices input').evaluateAll(nodes => nodes.map(node => [node.dataset.discoverySource, node.checked]));
      assert.deepEqual(choices, [['readersnews-books', true], ['seoul-culture', true], ['mit-linguistics', true], ['naver-d2', true], ['yna-news', true], ['sbs-news', true], ['nocut-news', true]]);
      await page.locator('#discoverySource-yna-news').uncheck(); await idle(page); await page.locator('#discoverySource-sbs-news').uncheck(); await idle(page);
      await page.locator('#discoveryNewsSettingsBack').click(); await idle(page); await frames(page);
      const remaining = await cards(page).evaluateAll(nodes => [...new Set(nodes.map(node => node.querySelector('.discovery-source-name').textContent))]);
      assert.equal(remaining.includes('연합뉴스') || remaining.includes('SBS 뉴스'), false); assert.match(await page.locator('#discoveryDiscover').innerText(), /^전체\s*37$/);
      assert.deepEqual((await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return (await s.readDiscoverySettings(await s.getActive())).disabledSourceIds; })).sort(), ['sbs-news', 'yna-news']);
      // A catalog naming a source outside the registry is refused whole; the list already shown stays.
      const bad = structuredClone(state.catalog); bad.extended.sources.push({ ...bad.extended.sources[0], id: 'unregistered-source' }); state.catalog = bad;
      await page.locator('#discoveryFilterToggle').click(); await page.locator('#discoveryRefreshNow').click(); await idle(page); await frames(page);
      assert.match(await page.locator('#discoveryError').innerText(), /이전 목록/); assert.equal(await cards(page).count(), 20);
    });

    assert.deepEqual(report.consoleErrors.filter(entry => !/404/.test(entry.text)), [], 'console errors');
    assert.deepEqual(report.pageErrors, [], 'page errors');
    assert.deepEqual(report.external, [], 'no request outside the app, the synthetic cloud and the synthetic image hosts');
  } catch (error) {
    report.checks.push({ name: 'cross-check totals', pass: false, error: error.stack }); console.error('FAIL cross-check totals\n' + error.stack);
  } finally {
    await browser.close();
    report.pass = report.checks.length > 0 && report.checks.every(entry => entry.pass);
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ pass: report.pass, checks: report.checks.length, failed: report.checks.filter(entry => !entry.pass).map(entry => entry.name), report: path.join(out, 'report.json') }));
    if (!report.pass) process.exitCode = 1;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

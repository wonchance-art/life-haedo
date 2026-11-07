/* 부드러운 판 묶음 C: 자료 목록·읽기 칸과 뉴스 목록·앱 안 원문 보기.
 * npm run dev; node tests/records-news-browser.cjs
 * Actual application bytes, bundled SDK and account-scoped IndexedDB with synthetic Auth and
 * anonymous fixtures. Publisher pages are synthetic responses; no real publisher, Google or
 * production request. Chromium viewport widths are not Apple-device checks. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, nav } = require('./unified-home-browser.cjs');
const { harnessFrameError } = require('./helpers/news-reader.cjs');
const out = path.resolve(process.env.RECORDS_NEWS_OUTPUT || path.join(__dirname, '../.local/records-news'));
const report = { createdAt: new Date().toISOString(), scope: 'Local Chromium, synthetic Auth and feed, synthetic publisher responses only.', checks: [], consoleErrors: [], pageErrors: [], external: [], publisherRequests: [], captures: [] };
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const idle = page => page.waitForFunction(() => document.querySelector('#discoveryReview')?.getAttribute('aria-busy') === 'false');
async function until(page, predicate, value, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const result = await page.evaluate(predicate, value); if (result) return result; await page.waitForTimeout(50); }
  throw new Error('Condition did not settle: ' + label);
}
const quote = '조용한 방은 생각을 오래 붙잡는다.';
const oldText = '주말에는 도서관에 가기로 했다. 빌린 책 목록을 정리한다.';
const newText = '『도서관의 시간』을 다시 빌렸다.\n\n' + quote + '\n\n' + Array.from({ length: 40 }, (_, i) => (i + 1) + '번째 문단. 토요일 오후 동네 도서관 2층 창가에서 3장을 다시 읽었다. 같은 문장인데 집에서 읽을 때와 무게가 다르다.').join('\n\n');
async function seedRecords(page) {
  const ids = await page.evaluate(async ({ oldText, newText, quote }) => {
    const storage = HaedoLife.Shell.storage, core = HaedoLife.Core;
    let b = await storage.read(await storage.getActive());
    const put = async input => { const prepared = await core.prepareImport(input, b); await storage.commitLocal({ operationId: core.id(), workspaceId: b.workspaceId, baseRevision: b.revision, changes: core.buildImportChanges(b, prepared, []) }); b = await storage.read(b.workspaceId); return prepared; };
    const first = await put({ origin: 'obsidian', title: '독서 메모 — 10월', text: oldText, forceSeparate: true });
    await new Promise(resolve => setTimeout(resolve, 20));
    const second = await put({ origin: 'obsidian', title: '독서 메모 — 10월', text: newText, existingSourceId: first.source.id });
    await new Promise(resolve => setTimeout(resolve, 20));
    const rain = await put({ origin: 'apple_notes', title: '비 오는 날 동네 도서관', text: '비가 굵어져서 도서관 2층 창가에 앉았다.', forceSeparate: true });
    await new Promise(resolve => setTimeout(resolve, 20));
    const article = await put({ ...HaedoLife.Discovery.toImportInput({ title: '작은 도서관이 버티는 법', url: 'https://www.readersnews.com/news/articleView.html?idxno=200771', author: null, publishedAt: '2026-10-19T03:00:00Z' }), forceSeparate: true });
    const start = newText.indexOf(quote), now = new Date().toISOString(), record = core.id();
    await storage.commitLocal({ operationId: core.id(), workspaceId: b.workspaceId, baseRevision: b.revision, changes: { put: { records: [{ id: record, kind: 'excerpt', text: quote, topic: '다시 읽기', note: '', sourceRefs: [{ sourceId: first.source.id, sourceVersionId: second.version.id, locator: { start, end: start + quote.length } }], provenance: { kind: 'user' }, revision: 1, createdAt: now, updatedAt: now }] } } });
    return { memo: first.source.id, oldVersion: first.version.id, newVersion: second.version.id, rain: rain.source.id, rainVersion: rain.version.id, article: article.source.id, record, quoteStart: start };
  }, { oldText, newText, quote });
  await page.reload(); await ready(page); await settle(page); return ids;
}
// Synthetic public metadata feed: one checked in-app source, one source that refuses frames, one failed source.
function feed(extra = []) {
  const now = Date.now(), iso = offset => new Date(now - offset * 60000).toISOString();
  const rights = { mode: 'metadata_only', label: '합성 제목·링크', url: 'https://www.readersnews.com/' };
  const source = (id, name, url, status = 'ok') => ({ id, name, url, feedUrl: url + 'feed', language: 'ko', rights: { ...rights, url }, status, stale: false, error: status === 'error' ? '합성 수집 실패' : null, lastSuccessAt: status === 'ok' ? iso(1) : null, lastAttemptAt: iso(1) });
  const article = (id, sourceId, url, title, minutes, language = 'ko') => ({ id, sourceId, url, title, language, tags: [], author: null, publishedAt: iso(minutes), fetchedAt: iso(1), summary: '', coverage: 'link_only', rights });
  return { schemaVersion: 1, generatedAt: iso(1), sources: [source('readersnews-books', '독서신문', 'https://www.readersnews.com/'), source('seoul-culture', '서울시 문화', 'https://news.seoul.go.kr/culture/'), source('naver-d2', 'NAVER D2', 'https://d2.naver.com/', 'error')],
    articles: [article('frame-ok', 'readersnews-books', 'https://www.readersnews.com/news/articleView.html?idxno=900001', '합성 신간 소개 기사', 10),
      article('frame-no', 'seoul-culture', 'https://news.seoul.go.kr/culture/archives/900002', '합성 전시 안내 기사', 20),
      article('english', 'readersnews-books', 'https://www.readersnews.com/news/articleView.html?idxno=900003', 'A synthetic English reading note', 30, 'en'), ...extra] };
}
async function horizontalOverflow(page) { return page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); }
async function capture(page, name) {
  const file = path.join(out, name + '.png'); await page.screenshot({ path: file }); report.captures.push(file);
  assert.equal(await horizontalOverflow(page), false, name + ': horizontal overflow');
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, run, viewport = { width: 1440, height: 960 }) {
    const server = new FakeCloud(), context = await makeContext(browser, server, 'records-news-' + report.checks.length, accounts.a, { viewport });
    let currentFeed = feed(), hold = null;
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback();
      if (url.hostname === 'www.readersnews.com') { report.publisherRequests.push({ check: name, path: url.pathname + url.search, referer: route.request().headers().referer || null }); return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>합성 출판사 응답</title><p>실제 기사 내용이 아닌 검사용 응답입니다.</p>' }); }
      report.external.push({ check: name, origin: url.origin }); return route.abort('blockedbyclient');
    });
    await context.route(base + '/assets/life/discovery-feed.json', async route => { if (hold) await hold; return route.fulfill({ contentType: 'application/json', body: JSON.stringify(currentFeed) }); });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ check: name, text: message.text() }); });
    page.on('pageerror', error => { if (harnessFrameError(error.message)) (report.harnessFrameErrors ||= []).push(name); else report.pageErrors.push({ check: name, text: error.message }); });
    try {
      await page.goto(base + '/index.html'); await ready(page);
      await run({ page, context, setFeed: value => { currentFeed = value; }, holdFeed: () => { let release; hold = new Promise(resolve => { release = resolve; }); return () => { hold = null; release(); }; } });
      assert.equal(server.writes().length, 0, 'No account upload from these local flows');
      report.checks.push({ name, pass: true }); console.log('PASS ' + name);
    } catch (error) {
      report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack);
      await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {});
    } finally { await context.close(); }
  }
  try {
    await check('records rows put date and time left, newest first, with stored-fact badges only', async ({ page }) => {
      const ids = await seedRecords(page); await nav(page, 'records'); await page.locator('#lifeSearch').fill('도서관'); await frames(page);
      const rows = await page.locator('#lifeSearchResults > .records-row').evaluateAll(nodes => nodes.map(row => {
        const when = row.querySelector(':scope > .records-when'), title = row.querySelector('.life-source-open');
        return { version: row.dataset.versionId, iso: when?.dateTime, whenRight: when?.getBoundingClientRect().right, titleLeft: title?.getBoundingClientRect().left, titleHeight: title?.getBoundingClientRect().height,
          badges: [...row.querySelectorAll('.records-badge')].map(badge => badge.textContent) };
      }));
      assert(rows.length >= 3);
      for (const row of rows) { assert(row.iso && row.whenRight < row.titleLeft, 'date column sits left of the title'); assert(row.titleHeight >= 44, 'row target at least 44px'); }
      const times = rows.map(row => Date.parse(row.iso)); assert.deepEqual([...times].sort((a, b) => b - a), times, 'newest stored version first');
      const old = rows.find(row => row.version === ids.oldVersion); assert(old.badges.includes('버전 1/2') && old.badges.includes('이전 버전'));
      assert.equal(rows.find(row => row.version === ids.newVersion).badges.includes('이전 버전'), false);
      for (const width of [1440, 820, 390]) { await page.setViewportSize({ width, height: width === 390 ? 844 : width === 820 ? 1180 : 960 }); await frames(page); await capture(page, 'records-list-' + width); }
      await page.setViewportSize({ width: 390, height: 844 }); await frames(page);
      // 2026-11-07 owner rule: no reading-column placeholder at any width (was: shown at 1101px+).
      assert.equal(await page.locator('#lifeRecordsReaderEmpty, .records-reader-empty').count(), 0, 'no reading placeholder');
      await page.locator(`#lifeSearchResults .life-source-card[data-version-id="${ids.rainVersion}"] .life-source-open`).click(); await settle(page);
      assert.equal(await page.locator('#lifeRecordsPane').isVisible(), false); assert.equal(await page.locator('#lifeSourceText').isVisible(), true);
    });
    await check('kind tab and search together open the exact earlier version and the exact excerpt range', async ({ page }) => {
      const ids = await seedRecords(page); await nav(page, 'records');
      await page.locator('#lifeRecordKind-article').click(); await frames(page);
      assert.deepEqual(await page.locator('#lifeSearchResults .life-source-card').evaluateAll(nodes => nodes.map(node => node.dataset.sourceId)), [ids.article]);
      assert.equal(await page.locator('#lifeRecordKind-article').getAttribute('aria-selected'), 'true');
      await page.locator('#lifeRecordKind-article').press('ArrowLeft'); await frames(page);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'lifeRecordKind-excerpt');
      assert.equal(await page.locator('#lifeSearchResults .records-excerpt-row').count(), 1);
      await page.locator('#lifeRecordKind-original').click(); await page.locator('#lifeSearch').fill('주말에는'); await frames(page);
      assert.deepEqual(await page.locator('#lifeSearchResults .life-source-card').evaluateAll(nodes => nodes.map(node => node.dataset.versionId)), [ids.oldVersion]);
      await page.locator(`#lifeSearchResults .life-source-card[data-version-id="${ids.oldVersion}"] .life-source-open`).click(); await settle(page);
      assert.equal(await page.locator('#lifeVersion').inputValue(), ids.oldVersion); assert.equal(await page.locator('#lifeSourceText').textContent(), oldText);
      assert.equal(await page.locator('#lifeRecordKind-original').getAttribute('aria-selected'), 'true', 'the reading pane keeps the chosen kind');
      await page.locator('#lifeSearchReturn').click(); await settle(page);
      assert.equal(await page.locator('#lifeSearch').inputValue(), '주말에는'); assert.equal(await page.locator('#lifeRecordKind-original').getAttribute('aria-selected'), 'true');
      await page.locator('#lifeSearchClear').click(); await page.locator('#lifeRecordKind-excerpt').click(); await frames(page);
      await page.locator('#lifeSearchResults .records-excerpt-open').click(); await settle(page); await frames(page);
      assert.equal(await page.locator('#lifeVersion').inputValue(), ids.newVersion);
      assert.equal(await page.evaluate(() => getSelection().toString()), quote, 'excerpt opens its exact range');
    });
    await check('two-column reading keeps the durable reading position while the list scrolls; match moves stay out of it', async ({ page }) => {
      const ids = await seedRecords(page); await nav(page, 'records'); await page.locator('#lifeSearch').fill('도서관'); await frames(page);
      // 2026-11-07 owner rule: the list view has no reading column until an original is opened.
      assert.equal(await page.locator('#lifeRecordsReaderEmpty, .records-reader-empty').count(), 0, 'no reading placeholder before opening');
      await page.locator(`#lifeSearchResults .life-source-card[data-version-id="${ids.newVersion}"] .life-source-open`).click(); await settle(page); await frames(page);
      const pane = page.locator('#lifeRecordsPane'); assert.equal(await pane.isVisible(), true);
      // Saved passage and list matches are painted over the unchanged text node (not split into marks), and survive the move into the reading column.
      assert.deepEqual(await page.evaluate(() => ['haedo-excerpt', 'haedo-search'].map(name => { const ranges = [...(CSS.highlights.get(name) || [])]; return [ranges.length > 0, ranges.every(range => !range.collapsed && range.startContainer === document.querySelector('#lifeSourceText').firstChild)]; })), [[true, true], [true, true]]);
      assert.equal(await page.locator('#lifeSourceText').evaluate(node => node.childNodes.length), 1);
      assert.equal(await pane.locator('[data-version-id="' + ids.newVersion + '"] .records-row-open').getAttribute('aria-current'), 'true');
      const layout = await page.evaluate(() => ({ pane: document.querySelector('#lifeRecordsPane').getBoundingClientRect().right, reader: document.querySelector('#lifeSourceText').getBoundingClientRect().left }));
      assert(layout.pane < layout.reader, 'list beside the reader');
      // Opened from a search hit: the reader starts on that exact match and moves through the others.
      const [, total] = (await page.locator('#lifeReaderMatchCount').innerText()).match(/^일치 1 \/ (\d+)$/); assert(Number(total) > 2);
      await page.locator('#lifeReaderMatchNext').click(); await frames(page);
      assert.equal(await page.locator('#lifeReaderMatchCount').innerText(), '일치 2 / ' + total); assert.equal(await page.evaluate(() => getSelection().toString()), '도서관');
      await page.locator('#lifeReaderMatchPrevious').click(); await page.locator('#lifeReaderMatchPrevious').click(); await frames(page);
      assert.equal(await page.locator('#lifeReaderMatchCount').innerText(), '일치 ' + total + ' / ' + total, 'previous wraps to the last match');
      await page.waitForTimeout(400);
      assert.equal((await page.evaluate(async () => HaedoLife.Shell.storage.readReadingPosition(await HaedoLife.Shell.storage.getActive()))).status, 'empty', 'match moves are not reading');
      const box = await page.locator('#lifeSourceText').boundingBox(); await page.mouse.move(box.x + box.width / 2, 500); await page.mouse.wheel(0, -900); // the last match sits at the end, so read upward
      const saved = await until(page, async version => { const row = await HaedoLife.Shell.storage.readReadingPosition(await HaedoLife.Shell.storage.getActive()); return row.status === 'available' && row.position?.sourceVersionId === version ? row : null; }, ids.newVersion, 'reading position after a real wheel');
      const windowY = await page.evaluate(() => scrollY), paneBox = await pane.boundingBox();
      await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + 200); await page.mouse.wheel(0, 300); await page.waitForTimeout(600);
      assert.equal(await page.evaluate(() => scrollY), windowY, 'the list scrolls on its own');
      assert.deepEqual(await page.evaluate(async () => HaedoLife.Shell.storage.readReadingPosition(await HaedoLife.Shell.storage.getActive())), saved, 'list scrolling never writes a reading position');
      await pane.locator('[data-version-id="' + ids.rainVersion + '"] .records-row-open').click(); await settle(page);
      assert.equal(await page.locator('#lifeSourceText').textContent(), '비가 굵어져서 도서관 2층 창가에 앉았다.');
      await pane.locator('[data-version-id="' + ids.newVersion + '"] .records-row-open').click(); await settle(page); await frames(page);
      assert.equal(await page.locator('#lifeVersion').inputValue(), ids.newVersion);
      assert.deepEqual(await page.evaluate(async () => HaedoLife.Shell.storage.readReadingPosition(await HaedoLife.Shell.storage.getActive())), saved, 'reopening from the list keeps the saved point');
      await page.locator('#lifePaneSearch').focus(); await page.keyboard.type('창가'); await frames(page);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'lifePaneSearch', 'search focus stays while the list updates');
      await capture(page, 'records-split-1440');
      await page.locator('#lifeSearchReturn').click(); await settle(page);
      assert.equal(await page.locator('#lifeSearch').inputValue(), '도서관창가');
    });
    await check('news rows, checked in-app frame, new-tab fallback and failed source state at 1440', async ({ page }) => {
      await nav(page, 'news'); await idle(page);
      const row = page.locator('#discoveryList [data-discovery-id="frame-ok"]');
      const shape = await row.evaluate(node => ({ cells: [...node.children].map(child => child.className), title: node.querySelector('.discovery-title').textContent, meta: node.querySelector('.discovery-meta').textContent }));
      assert.deepEqual(shape.cells, ['discovery-topic', 'discovery-row-open', 'life-button discovery-reaction']); assert.match(shape.meta, /독서신문/);
      assert.match(await page.locator('#discoveryList [data-discovery-id="english"] .discovery-meta').innerText(), /EN/);
      assert.equal(await page.locator('#discoveryFailedSources').isVisible(), true); assert.match(await page.locator('#discoveryFailedSources').innerText(), /출처 1곳 갱신 실패/);
      assert.match(await page.locator('#discoveryDiscover').innerText(), /전체 3/);
      const historyLength = await page.evaluate(() => history.length);
      await row.locator('[data-discovery-select]').click(); await idle(page);
      const frame = page.locator('#discoveryReaderFrame');
      assert.deepEqual(await frame.evaluate(node => ({ src: node.src, referrer: node.getAttribute('referrerpolicy'), sandbox: node.getAttribute('sandbox') })),
        { src: 'https://www.readersnews.com/news/articleView.html?idxno=900001', referrer: 'no-referrer', sandbox: 'allow-scripts allow-popups' });
      assert.equal(await page.evaluate(() => history.length), historyLength, 'the wide reading column stays on the same history entry');
      assert.match(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'), /^frame-src 'self' blob: https:\/\/www\.youtube-nocookie\.com https:\/\/www\.readersnews\.com https:\/\/www\.frontiersin\.org$/);
      await until(page, () => true, null, 'frame'); await page.waitForTimeout(300);
      assert(report.publisherRequests.some(request => request.path.includes('900001') && request.referer === null), 'publisher request without referrer');
      const external = page.locator('#discoveryReader [data-discovery-open]');
      assert.equal(await external.getAttribute('target'), '_blank'); assert.match(await external.getAttribute('rel'), /noreferrer/);
      await capture(page, 'news-reader-1440');
      // Re-drawing for a reaction keeps the same frame element (no reload).
      await page.evaluate(() => { window.__frame = document.querySelector('#discoveryReaderFrame'); });
      await page.locator('#discoveryReader [data-discovery-reaction="liked"]').click(); await idle(page);
      assert.equal(await page.evaluate(() => document.querySelector('#discoveryReaderFrame') === window.__frame), true);
      assert.equal(await page.locator('#discoveryReader [data-discovery-reaction="liked"]').getAttribute('aria-pressed'), 'true');
      await page.locator('#discoveryList [data-discovery-id="frame-no"] [data-discovery-select]').click(); await idle(page);
      assert.equal(await page.locator('#discoveryReaderFrame').count(), 0);
      assert.equal(await page.locator('#discoveryReader .discovery-reader-page').getAttribute('data-frame'), 'blocked');
      assert.equal(await page.locator('#discoveryReader [data-discovery-open]').getAttribute('href'), 'https://news.seoul.go.kr/culture/archives/900002');
      assert.equal(report.external.filter(item => item.check.startsWith('news rows')).length, 0, 'a refused source is never loaded in the app');
      await page.locator('#discoveryFailedSources').click();
      assert.equal(await page.locator('#discoveryNewsSettingsPanel').isVisible(), true); assert.equal(await page.locator('#discoveryOptions').evaluate(node => node.open), true);
    });
    await check('phone reading is full screen without the bottom tabs and returns to the same row', async ({ page }) => {
      await nav(page, 'news'); await idle(page); await capture(page, 'news-list-390');
      const tabs = page.locator('[data-haedo-navigation]'); assert.equal(await tabs.isVisible(), true);
      await page.locator('#discoveryList [data-discovery-id="frame-ok"] [data-discovery-select]').click(); await idle(page); await frames(page);
      assert.equal(await page.evaluate(() => document.body.dataset.haedoImmersive), 'news'); assert.equal(await tabs.isVisible(), false);
      const reader = await page.locator('#discoveryReader').boundingBox(); assert.deepEqual([reader.x, reader.y, reader.width, reader.height], [0, 0, 390, 844]);
      const tools = await page.locator('#discoveryReader .discovery-reader-tools').evaluate(node => [...node.children].filter(child => child.getClientRects().length && getComputedStyle(child).position !== 'fixed').map(child => child.getAttribute('aria-label') || child.textContent));
      assert.deepEqual(tools.map(label => label.split(' ')[0]), ['담기', '좋아요', '새']);
      const bar = await page.locator('#discoveryReader .discovery-reader-tools').boundingBox(); assert(bar.y + bar.height >= 843, 'tools at the bottom edge');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'discoveryReaderBack');
      // Everything behind the full-screen reader is inert while it is open.
      assert.equal(await page.evaluate(() => [document.querySelector('.life-toolbar'), document.querySelector('.discovery-list-pane'), document.querySelector('[data-haedo-navigation]')].every(element => element.closest('[inert]'))), true);
      assert.equal(await page.evaluate(() => !!document.querySelector('#discoveryReader').closest('[inert]')), false);
      await capture(page, 'news-reader-390');
      // The browser's back closes the reader and returns to the list; forward reopens the same article.
      const opened = await page.evaluate(() => history.state?.haedo);
      assert.equal(opened.entry.newsArticle, 'frame-ok'); assert.equal(opened.back.mode, 'external-discovery'); assert.equal(opened.back.newsArticle, undefined);
      await page.goBack(); await idle(page); await frames(page);
      assert.equal(await page.locator('#discoveryReader').count(), 0); assert.equal(await tabs.isVisible(), true);
      assert.equal(await page.evaluate(() => document.querySelectorAll('[inert]').length), 0, 'closing releases inert');
      assert.equal(await page.evaluate(() => history.state?.haedo?.entry?.newsArticle), undefined);
      assert.equal(new URL(page.url()).searchParams.get('section'), 'news');
      await page.goForward(); await idle(page); await frames(page);
      assert.equal(await page.evaluate(() => document.body.dataset.haedoImmersive), 'news'); assert.match(await page.locator('#discoveryReaderTitle').innerText(), /합성 신간 소개 기사/);
      await page.locator('#discoveryReaderBack').focus();
      await page.keyboard.press('Enter'); await idle(page); await frames(page);
      // ‹ 뉴스 also goes back to the list entry, so one more back leaves news as before.
      await page.waitForFunction(key => history.state?.haedo?.key === key, opened.back.key);
      assert.equal(await page.evaluate(() => document.body.dataset.haedoImmersive), undefined); assert.equal(await tabs.isVisible(), true);
      assert.equal(await page.evaluate(() => document.activeElement.closest('[data-discovery-id]')?.dataset.discoveryId), 'frame-ok');
      await page.setViewportSize({ width: 820, height: 1180 }); await page.locator('#discoveryList [data-discovery-id="frame-no"] [data-discovery-select]').click(); await idle(page);
      assert.equal(await page.locator('.discovery-list-pane').isVisible(), false); assert.equal(await page.locator('#discoveryReaderBack').isVisible(), true); assert.equal(await tabs.isVisible(), true);
      assert.equal(await page.evaluate(() => document.querySelectorAll('[inert]').length), 0, 'iPad reading keeps the menu usable');
      await page.goBack(); await idle(page); assert.equal(await page.locator('.discovery-list-pane').isVisible(), true, 'back returns to the list at 820 too');
      await page.goForward(); await idle(page); assert.equal(await page.locator('#discoveryReaderBack').isVisible(), true);
      await capture(page, 'news-reader-820'); await page.locator('#discoveryReaderBack').click(); await idle(page);
      assert.equal(await page.locator('.discovery-list-pane').isVisible(), true); await capture(page, 'news-list-820');
    }, { width: 390, height: 844 });
    await check('empty tab, refreshing state, new article count and 관련 없음 undo', async ({ page, setFeed, holdFeed }) => {
      await nav(page, 'news'); await idle(page);
      await page.locator('#discoveryBookmarked').click(); await idle(page);
      assert.equal(await page.locator('#discoveryBookmarked').getAttribute('aria-selected'), 'true');
      assert.match(await page.locator('#discoveryList').innerText(), /담은 글이 없습니다/);
      await page.locator('#discoveryShowAll').click(); await idle(page); assert.equal(await page.locator('#discoveryDiscover').getAttribute('aria-selected'), 'true');
      setFeed(feed([{ id: 'fresh', sourceId: 'seoul-culture', url: 'https://news.seoul.go.kr/culture/archives/900009', title: '새로 들어온 합성 기사', language: 'ko', tags: [], author: null, publishedAt: new Date(Date.now() - 60000).toISOString(), fetchedAt: new Date().toISOString(), summary: '', coverage: 'link_only', rights: { mode: 'metadata_only', label: '합성', url: 'https://news.seoul.go.kr/' } }]));
      const release = holdFeed(); await page.locator('#discoveryFilterToggle').click(); await page.locator('#discoveryRefreshNow').click();
      await page.locator('#discoveryProgress').waitFor(); assert.equal((await page.locator('#discoveryProgress').innerText()).trim(), '새로 고치는 중');
      assert.equal(await page.locator('#discoveryRefreshNow').isDisabled(), true); release(); await idle(page);
      await page.waitForFunction(() => document.querySelector('#discoveryProgress')?.hidden);
      assert.match(await page.locator('#discoveryNewArticles').innerText(), /새 글 1건/);
      await page.locator('#discoveryNewArticles').click(); await idle(page); assert.equal(await page.locator('#discoveryNewArticles').count(), 0);
      await page.locator('#discoveryList [data-discovery-id="frame-no"] [data-discovery-select]').click(); await idle(page);
      await page.locator('#discoveryReader .discovery-more > summary').click();
      await page.locator('#discoveryReader [data-discovery-feedback="not_relevant"]').click(); await idle(page);
      assert.equal(await page.locator('#discoveryList [data-discovery-id="frame-no"]').count(), 0);
      assert.match(await page.locator('.discovery-undo-toast').innerText(), /관련 없음으로 제외/);
      await page.locator('#discoveryExcluded').click(); await idle(page);
      assert.equal(await page.locator('#discoveryList [data-discovery-restore]').count(), 1); assert.match(await page.locator('#discoveryExcluded').innerText(), /제외한 글 1/);
      await page.locator('#discoveryDiscover').click(); await idle(page);
      assert.equal(await page.locator('.discovery-undo-toast').count(), 0, 'switching lists dismisses the toast');
      await page.locator('#discoveryExcluded').click(); await idle(page); await page.locator('#discoveryList [data-discovery-restore]').click(); await idle(page);
      assert.match(await page.locator('#discoveryList').innerText(), /제외한 글이 없습니다/);
      await page.locator('#discoveryDiscover').click(); await idle(page);
      await page.locator('#discoveryList [data-discovery-id="frame-no"] [data-discovery-select]').click(); await idle(page);
      await page.locator('#discoveryReader .discovery-more > summary').click(); await page.locator('#discoveryReader [data-discovery-feedback="not_relevant"]').click(); await idle(page);
      await page.locator('#discoveryUndoToast').click(); await idle(page);
      assert.equal(await page.locator('#discoveryList [data-discovery-id="frame-no"]').count(), 1, '되돌리기 restores the row');
      assert.deepEqual((await page.evaluate(async () => HaedoLife.Shell.storage.readDiscoveryProfile(await HaedoLife.Shell.storage.getActive()))).feedback, []);
    });
    await check('a cached older shell without records-list.js still opens the records list and an original', async ({ page, context }) => {
      // Mixed update: the new pages reference records-list.js/records.css, an older offline cache cannot serve them.
      await context.route(/\/assets\/life\/records(-list\.js|\.css)(\?.*)?$/, route => route.fulfill({ status: 404, body: '' }));
      const mixed = report.consoleErrors.length;
      await page.reload(); await ready(page);
      assert.equal(await page.evaluate(() => !!HaedoLife.RecordsList), false);
      const ids = await seedRecords(page); await nav(page, 'records'); await page.locator('#lifeSearch').fill('도서관'); await frames(page);
      assert.equal(await page.locator('#lifeRecordKind-all').count(), 0, 'no kind tabs without the module');
      assert(await page.locator('#lifeSearchResults .life-source-card').count() >= 3);
      await page.locator(`#lifeSearchResults .life-source-card[data-version-id="${ids.oldVersion}"] .life-source-open`).click(); await settle(page);
      assert.equal(await page.locator('#lifeVersion').inputValue(), ids.oldVersion); assert.equal(await page.locator('#lifeRecordsPane').count(), 0);
      await page.locator('#lifeSearchReturn').click(); await settle(page);
      assert.equal(await page.locator('#lifeSearch').inputValue(), '도서관');
      // Only the two refused resources may log a load error; nothing throws.
      const added = report.consoleErrors.splice(mixed);
      assert(added.every(entry => /Failed to load resource/.test(entry.text)), JSON.stringify(added));
    });
  } finally {
    await browser.close();
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  const failed = report.checks.filter(item => !item.pass).length;
  console.log(JSON.stringify({ passed: report.checks.length - failed, failed, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length }));
  if (failed || report.consoleErrors.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });

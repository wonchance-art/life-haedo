/* 2026-11-16 AI 추천 (news_pick, docs/design-review/news-pick.md).
 * npm run dev; node tests/news-pick-browser.cjs
 * Actual application bytes with synthetic Auth and an anonymous synthetic catalog. The haedo-ai function and the
 * 넓게 찾기 server are stand-ins defined here; no request reaches Anthropic, Google, a publisher or production.
 * Every topic, title and publisher name below is made up. Chromium viewport widths are not Apple-device checks. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, nav } = require('./unified-home-browser.cjs');
const { harnessFrameError } = require('./helpers/news-reader.cjs');
const out = path.resolve(process.env.NEWS_PICK_OUTPUT || path.join(__dirname, '../.local/news-pick'));
const report = { createdAt: new Date().toISOString(), scope: 'Local Chromium, synthetic Auth, synthetic catalog, stand-in haedo-ai and 넓게 찾기 servers only.', checks: [], consoleErrors: [], pageErrors: [], external: [], captures: [] };
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const idle = page => page.waitForFunction(() => document.querySelector('#discoveryReview')?.getAttribute('aria-busy') === 'false');
async function until(page, predicate, value, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const result = await page.evaluate(predicate, value); if (result) return result; await page.waitForTimeout(50); }
  throw new Error('Condition did not settle: ' + label);
}
async function settled(read, expected, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await read() === expected) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.equal(await read(), expected, label);
}
const sizes = { 1440: 960, 820: 1180, 390: 844 };
const only = process.env.NEWS_PICK_ONLY || '';

// The fixed catalog: three publishers that are not conditional sources, newest first every three minutes.
const fixedNames = { 'readersnews-books': '독서신문', 'seoul-culture': '서울시 문화', 'nasa-news': 'NASA' };
const fixedUrls = { 'readersnews-books': 'www.readersnews.com/news/articleView.html?idxno=', 'seoul-culture': 'news.seoul.go.kr/culture/archives/', 'nasa-news': 'www.nasa.gov/news-release/synthetic-' };
const fixedTitle = index => '고정 출처 합성 제목 ' + (index + 1);
const fixedUrl = index => 'https://' + fixedUrls[['readersnews-books', 'seoul-culture', 'nasa-news'][index % 3]] + (70000 + index);
function feed(count = 12) {
  const now = Date.now(), iso = minutes => new Date(now - minutes * 60000 - 30000).toISOString(), rights = { mode: 'metadata_only', label: '합성 제목·링크', url: null };
  const source = id => ({ id, name: fixedNames[id], url: 'https://' + fixedUrls[id].split('/')[0] + '/', feedUrl: 'https://' + fixedUrls[id].split('/')[0] + '/feed', language: 'ko', rights, status: 'ok', stale: false, error: null, lastSuccessAt: iso(1), lastAttemptAt: iso(1) });
  const order = ['readersnews-books', 'seoul-culture', 'nasa-news'];
  const rows = Array.from({ length: count }, (_, i) => ({ id: 'fixed-' + i, sourceId: order[i % 3], url: fixedUrl(i), title: fixedTitle(i), language: 'ko', tags: [], author: null,
    publishedAt: iso(10 + i * 3), fetchedAt: iso(1), summary: '', coverage: 'link_only', rights }));
  return { schemaVersion: 1, generatedAt: iso(1), sources: order.slice(0, 2).map(source), articles: rows.filter(row => row.sourceId !== 'nasa-news'), extended: { sources: [source('nasa-news')], articles: rows.filter(row => row.sourceId === 'nasa-news') } };
}
// The stand-in's default answer: the three oldest candidates, oldest first, so the order visibly changes.
function answer(body) {
  const total = body.candidates.length, picks = [total, total - 1, total - 2].filter(n => n >= 1).map((n, i) => ({ n, reason: '합성 이유 ' + (i + 1) }));
  return { status: 'ok', requestId: body.requestId, task: 'news_pick', model: 'claude-haiku-5-5', picks, clusters: [], usage: { inputTokens: 900, outputTokens: 120, remainingMicroUsd: 9000000 } };
}
const PREFIX = 'https://news.google.com/';
const hex = text => crypto.createHash('md5').update(text).digest('hex');
function wideItem(topic, index, hoursOld) {
  const id = hex(topic + '\n' + index);
  return { id, title: '넓게 합성 ' + topic + ' ' + (index + 1), link: PREFIX + 'rss/articles/SYN' + id + '?oc=5', publishedAt: new Date(Date.now() - hoursOld * 3600000).toISOString(),
    sourceName: '합성매체 ' + (index + 1), sourceUrl: 'https://publisher' + (index + 1) + '.example', topic, language: 'ko' };
}
function wideAnswer(body) {
  const fetchedAt = new Date(Date.now() - 60000).toISOString(), items = [];
  for (const topic of body.topics) { items.push(wideItem(topic, 0, 2), wideItem(topic, 1, 80)); }
  return { supplier: 'google-news-rss', items, fetchedAt, stale: false, topics: body.topics.flatMap(topic => body.languages.map(language => ({ topic, language, status: 'fresh', fetchedAt, count: 2 }))) };
}
const cards = page => page.locator('#discoveryList > .discovery-article');
const shownIds = page => cards(page).evaluateAll(nodes => nodes.map(node => node.dataset.discoveryId));
const picked = page => page.locator('#discoveryList > .discovery-article .discovery-pick-mark');
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
async function capture(page, name) {
  const file = path.join(out, name + '.png'); await page.screenshot({ path: file }); report.captures.push(file);
  assert.equal(await overflow(page), false, name + ': horizontal overflow');
}
async function openSettings(page) {
  if (!await page.locator('#discoveryNewsSettingsPanel').isVisible()) await page.locator('#discoveryNewsSettings').click();
  if (!await page.locator('#discoveryTopics').evaluate(node => node.open)) await page.locator('#discoveryTopics > summary').click();
  await frames(page);
}
async function closeSettings(page) { if (await page.locator('#discoveryNewsSettingsPanel').isVisible()) await page.locator('#discoveryNewsSettingsBack').click(); await idle(page); await frames(page); }
async function addTopic(page, text) {
  await openSettings(page);
  await page.locator('#discoveryTopicInput').fill(text); await page.locator('#discoveryTopicAdd').click(); await idle(page);
  await until(page, async text => (await HaedoLife.Shell.storage.readInterestProfile(await HaedoLife.Shell.storage.getActive())).manual.some(row => row.label === text), text, 'topic saved: ' + text);
}
async function setOption(page, id, check, on) {
  await openSettings(page);
  await page.locator('#' + id).setChecked(on); await idle(page);
  await until(page, async ([name, on]) => HaedoLife.DiscoverySettings[name](await HaedoLife.Shell.storage.readDiscoverySettings(await HaedoLife.Shell.storage.getActive())) === on, [check, on], id + ' saved ' + on);
}
const setPick = (page, on) => setOption(page, 'discoveryNewsPick', 'newsPick', on);
async function refreshNow(page) { await page.locator('#discoveryFilterToggle').click(); await page.locator('#discoveryRefreshNow').click(); await idle(page); await frames(page); }
async function sortBy(page, value) { await page.locator('#discoveryFilterToggle').click(); await page.locator('#discoverySort').selectOption(value); await idle(page); await frames(page); }
const notice = page => page.locator('#discoveryPickNotice').textContent().catch(() => null);
// The candidate records the device sent, by number.
const sentTitle = (request, n) => request.body.candidates.find(row => row.n === n)?.title;

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, run, { width = 1440, catalog = feed() } = {}) {
    if (only && !name.includes(only)) return;
    const server = new FakeCloud(), context = await makeContext(browser, server, 'news-pick-' + report.checks.length, accounts.a, { viewport: { width, height: sizes[width] } });
    // ai.reply(body) returns { status, body } or 'abort'; ai.hold delays the answer.
    const ai = { requests: [], reply: body => ({ status: 200, body: answer(body) }), hold: null };
    const wide = { requests: [], reply: body => ({ status: 200, body: wideAnswer(body) }) };
    const state = { catalog, catalogRequests: 0, ai, wide };
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback();
      // The in-app reader frames this publisher's page: a synthetic page answers it.
      if (url.hostname === 'www.readersnews.com' && request.resourceType() === 'document') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>합성 출판사 응답</title><p>합성 원문 페이지</p>' });
      report.external.push({ check: name, url: url.origin + url.pathname }); return route.abort('blockedbyclient');
    });
    await context.route(base + '/assets/life/discovery-feed.json', route => { state.catalogRequests++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify(state.catalog) }); });
    const serve = (target, hold) => async route => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
      const headers = request.headers(), entry = { raw: request.postData(), body: request.postDataJSON(), authorization: /^Bearer .+/.test(headers.authorization || ''), cookie: headers.cookie || null, referer: headers.referer || null, at: Date.now() };
      target.requests.push(entry);
      if (hold && target.hold) await target.hold;
      const result = target.reply(entry.body);
      if (result === 'abort') return route.abort('failed');
      return route.fulfill({ status: result.status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(result.body) });
    };
    await context.route(cloud + '/functions/v1/haedo-ai', serve(ai, true));
    await context.route(cloud + '/functions/v1/haedo-news-wide', serve(wide, false));
    await context.route(cloud + '/rest/v1/rpc/life_news_wide_clear', route => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: '{"status":"cleared","removed":0}' }));
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const messages = [];
    page.on('console', message => { messages.push(message.text()); if (message.type() === 'error') report.consoleErrors.push({ check: name, text: message.text() }); });
    page.on('pageerror', error => { if (harnessFrameError(error.message)) (report.harnessFrameErrors ||= []).push(name); else report.pageErrors.push({ check: name, text: error.message }); });
    try {
      await page.goto(base + '/index.html'); await ready(page);
      await nav(page, 'news'); await idle(page); await frames(page);
      await run({ page, state, ai, wide, context, messages });
      report.checks.push({ name, pass: true }); console.log('PASS ' + name);
    } catch (error) {
      report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack);
      await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {});
    } finally { await context.close(); }
  }
  // Typed topics, AI 추천 on, back on the list with the answer drawn.
  async function start(page, ai, topics = ['합성 도서관', '합성 기후'], expected = 1) {
    for (const topic of topics) await addTopic(page, topic);
    await setPick(page, true); await settled(async () => ai.requests.length, expected, 'one request after turning on');
    await closeSettings(page); await until(page, () => !document.querySelector('#discoveryPickNotice')?.textContent.includes('고르는 중'), null, 'answer drawn');
  }
  try {
    await check('off by default: opening, refresh and topics send nothing to Anthropic; the order needs the setting; the setting says what is sent', async ({ page, ai }) => {
      assert.deepEqual(await page.evaluate(async () => (await HaedoLife.Shell.storage.readDiscoverySettings(await HaedoLife.Shell.storage.getActive())).disabledSourceIds), []);
      await addTopic(page, '합성 도서관');
      const box = page.locator('#discoveryNewsPick');
      assert.equal(await box.isChecked(), false); assert.equal(await box.isEnabled(), true);
      const help = await page.locator('#discoveryPickHelp').innerText();
      for (const part of ['Anthropic', '관심 주제', '제목·매체 이름·발행 시각', '좋아요·담은 글·읽은 글과 계정 정보는 보내지 않습니다', '30일', '학습에는 쓰지 않습니다', '저장하지 않습니다', '15분 자동 갱신 때는 묻지 않고', '하루 12번']) assert(help.includes(part), 'settings text names: ' + part);
      assert.equal(await box.getAttribute('aria-describedby'), 'discoveryPickHelp');
      await closeSettings(page);
      await refreshNow(page); await nav(page, 'schedule'); await nav(page, 'news'); await idle(page); await page.waitForTimeout(400);
      await page.locator('#discoveryFilterToggle').click();
      assert.equal(await page.locator('#discoverySort option[value="pick"]').isDisabled(), true, 'AI 추천 cannot be chosen while off');
      assert.equal(ai.requests.length, 0, 'no request while off'); assert.equal(await picked(page).count(), 0); assert.equal(await page.locator('#discoveryPickNotice').count(), 0);
    });

    await check('on: one request with exactly the four fields; typed topics; candidates are list metadata only; liked, saved and read articles are not sent', async ({ page, ai, messages }) => {
      // Reactions first: a saved card, a liked article and a read one. None of them may be sent.
      await page.locator('#discoveryList [data-discovery-id="fixed-0"] [data-discovery-reaction=bookmarked]').click(); await idle(page);
      await page.locator('#discoveryList [data-discovery-id="fixed-3"] [data-discovery-select]').click(); await frames(page);
      await page.locator('#discoveryReaderHost [data-discovery-reaction=liked]').click(); await idle(page);
      await page.locator('#discoveryReaderHost .discovery-reader-back').click(); await frames(page);
      const menu = page.locator('#discoveryList [data-discovery-id="fixed-5"] .discovery-card-more'); await menu.locator('summary').click(); await menu.locator('[data-discovery-feedback=already_read]').click(); await idle(page);
      await start(page, ai);
      assert.equal(ai.requests.length, 1);
      const sent = ai.requests[0];
      assert.equal(sent.authorization, true); assert.equal(sent.cookie, null); assert.equal(sent.referer, null);
      assert.deepEqual(Object.keys(sent.body), ['requestId', 'task', 'topics', 'candidates'], 'four fields; no language');
      assert.equal(sent.body.task, 'news_pick'); assert.deepEqual(sent.body.topics, ['합성 도서관', '합성 기후']);
      assert.match(sent.body.requestId, /^[0-9a-f-]{36}$/);
      sent.body.candidates.forEach((row, index) => { assert.deepEqual(Object.keys(row), ['n', 'title', 'publisher', 'publishedAt']); assert.equal(row.n, index + 1); });
      const titles = sent.body.candidates.map(row => row.title);
      assert.equal(titles.length, 9, 'twelve articles less the saved, liked and read ones');
      for (const index of [0, 3, 5]) assert(!titles.includes(fixedTitle(index)), 'not sent: ' + fixedTitle(index));
      for (const word of ['https://', 'fixed-', 'readersnews.com', accounts.a.id]) assert(!sent.raw.includes(word), 'not in the request: ' + word);
      // The list: the three picks first in the answer's order, each marked; then the latest order.
      assert.equal(await page.locator('#discoverySort').inputValue(), 'pick');
      const last = sent.body.candidates.length, expected = [last, last - 1, last - 2].map(n => sentTitle(sent, n));
      assert.deepEqual(await cards(page).locator('.discovery-title').evaluateAll(nodes => nodes.slice(0, 3).map(node => node.textContent)), expected);
      assert.equal(await picked(page).count(), 3);
      assert.equal(await notice(page), 'AI 추천 3건 · 그 뒤는 최신순');
      const first = cards(page).first().locator('.discovery-card-more'); await first.locator('summary').click(); await first.locator('.discovery-article-info > summary').click();
      assert.match(await first.locator('.discovery-article-info').innerText(), /AI 추천 · 합성 이유 1 · 제목·매체 이름·발행 시각만 보고 고른 것입니다/);
      // Console output never carries a topic or a title.
      for (const text of messages) for (const word of ['합성 도서관', '합성 기후', '고정 출처 합성', '합성 이유']) assert(!text.includes(word), 'console is silent about ' + word);
      // Nothing of the answer is kept in browser storage or caches; the only stored value is today's count.
      const kept = await page.evaluate(async () => {
        // The answer's words (its reasons and fields); the public catalog may be cached as before.
        const words = ['합성 이유', '"picks"', 'claude-haiku'], hit = text => words.some(word => String(text).includes(word));
        const local = Object.entries(localStorage).filter(([key, value]) => hit(key) || hit(value)).map(([key]) => key), session = Object.entries(sessionStorage).filter(([key, value]) => hit(key) || hit(value)).map(([key]) => key);
        const cached = []; for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) { const text = await (await (await caches.open(name)).match(request)).clone().text().catch(() => ''); if (hit(request.url) || hit(text) && !request.url.endsWith('.js')) cached.push(request.url); }
        return { local, session, cached, count: JSON.parse(localStorage.getItem(HaedoLife.DiscoveryPick.COUNT_KEY)) };
      });
      assert.deepEqual({ ...kept, count: Object.keys(kept.count) }, { local: [], session: [], cached: [], count: ['day', 'count'] });
      assert.equal(kept.count.count, 1);
    });

    await check('the answer brings no address, title or date: unsent and repeated numbers are dropped, cards are the list\'s own records', async ({ page, ai }) => {
      ai.reply = body => ({ status: 200, body: { status: 'ok', requestId: body.requestId, task: 'news_pick', model: 'claude-haiku-5-5', clusters: [[2, 4]],
        picks: [{ n: 999, reason: '없는 번호' }, { n: 2, reason: '자세히 https://evil.example/a', url: 'https://evil.example/a', title: '지어낸 제목', publishedAt: '2030-01-01T00:00:00Z' }, { n: 2, reason: '다시' }, { n: 4, reason: '같은 사건' }, { n: 0, reason: '영' }] } });
      await start(page, ai, ['합성 도서관']);
      const sent = ai.requests[0];
      assert.equal(await picked(page).count(), 1, 'one pick: 999 and 0 were not sent, 2 came twice, 4 is the same story as 2');
      const card = cards(page).first();
      assert.equal(await card.locator('.discovery-title').textContent(), sentTitle(sent, 2));
      const article = await page.evaluate(title => document.querySelector('#discoveryList > .discovery-article').dataset.discoveryUrl, null);
      assert(article.startsWith('https://www.readersnews.com/') || article.startsWith('https://news.seoul.go.kr/') || article.startsWith('https://www.nasa.gov/'), 'the card is the list\'s own article: ' + article);
      assert.equal(await page.evaluate(() => document.body.innerText.includes('evil') || document.body.innerText.includes('지어낸') || document.body.innerHTML.includes('evil.example')), false);
      assert.equal(await card.locator('.discovery-pick-mark').getAttribute('title'), 'AI 추천', 'a reason with an address is dropped');
    });

    await check('failures fall back to the latest order with one status line: busy, network, malformed, the monthly limit', async ({ page, ai }) => {
      await start(page, ai, ['합성 도서관']);
      await sortBy(page, 'latest'); const latest = await shownIds(page); await sortBy(page, 'pick');
      for (const [reply, text] of [[{ status: 503, body: { error: 'ai_busy' } }, '추천을 가져오지 못했어요 · 최신순으로 보여 줘요'], ['abort', '추천을 가져오지 못했어요 · 최신순으로 보여 줘요'],
        [{ status: 200, body: { status: 'ok', requestId: 'x', picks: [] } }, '추천을 가져오지 못했어요 · 최신순으로 보여 줘요'], [{ status: 429, body: { error: 'ai_monthly_limit' } }, '이번 달 AI 추천에 쓸 금액을 다 썼어요 · 최신순으로 보여 줘요']]) {
        const before = ai.requests.length; ai.reply = () => reply;
        await refreshNow(page); await settled(async () => ai.requests.length, before + 1, '지금 갱신 asks');
        await until(page, text => document.querySelector('#discoveryPickNotice')?.textContent === text, text, 'fallback line: ' + text);
        assert.equal(await page.locator('#discoveryPickNotice').getAttribute('role'), 'status');
        assert.deepEqual(await shownIds(page), latest, 'the latest order: ' + text); assert.equal(await picked(page).count(), 0);
      }
      // Working again: the next refresh asked for draws picks again.
      ai.reply = body => ({ status: 200, body: answer(body) });
      await refreshNow(page); await until(page, () => document.querySelectorAll('#discoveryList .discovery-pick-mark').length === 3, null, 'picks back');
    });

    await check('asked on opening, 지금 갱신, topic and language changes; reopening soon reuses; the 15-minute refresh never asks', async ({ page, ai, state }) => {
      await start(page, ai, ['합성 도서관']);
      await nav(page, 'schedule'); await nav(page, 'news'); await idle(page); await page.waitForTimeout(400);
      assert.equal(ai.requests.length, 1, 'reopening the tab soon reuses the answer'); assert.equal(await picked(page).count(), 3);
      await refreshNow(page); await settled(async () => ai.requests.length, 2, '지금 갱신 asks');
      await addTopic(page, '합성 기후'); await settled(async () => ai.requests.length, 3, 'a new topic asks');
      assert.deepEqual(ai.requests[2].body.topics, ['합성 도서관', '합성 기후']);
      // Content language: Korean only (the choice is a key, not a field).
      await page.evaluate(async () => {
        const storage = HaedoLife.Shell.storage, id = await storage.getActive(), current = await storage.readDiscoveryLanguageSettings(id);
        await storage.saveDiscoveryLanguageSettings(id, HaedoLife.DiscoveryLanguageSettings.update(current, { contentLanguages: ['ko'] }, { expectedRevision: current.revision }), current.revision);
      });
      await closeSettings(page); await nav(page, 'schedule'); await nav(page, 'news'); await idle(page);
      await settled(async () => ai.requests.length, 4, 'a changed language asks when news opens');
      assert(!('language' in ai.requests[3].body), 'the language is not sent');
      // The timer.
      await page.clock.install({ time: new Date() });
      await page.locator('#discoveryNewsSettings').click();
      if (!await page.locator('#discoveryOptions').evaluate(node => node.open)) await page.locator('#discoveryOptions > summary').click();
      await page.locator('#discoveryAutoRefresh').setChecked(true); await idle(page);
      await until(page, async () => (await HaedoLife.Shell.storage.readDiscoverySettings(await HaedoLife.Shell.storage.getActive())).autoRefresh === true, null, 'auto refresh saved');
      await closeSettings(page);
      const catalogBefore = state.catalogRequests, aiBefore = ai.requests.length;
      for (let round = 0; round < 3; round++) { await page.clock.fastForward(15 * 60000 + 2000); await page.waitForTimeout(150); await idle(page); }
      assert(state.catalogRequests >= catalogBefore + 2, 'the catalog was refreshed on the timer: ' + (state.catalogRequests - catalogBefore));
      assert.equal(ai.requests.length, aiBefore, 'the timer never asks for a pick');
      assert.equal(await picked(page).count(), 3, 'the picks stay through the catalog refresh');
    });

    await check('a late answer: kept back while the list is in use, dropped after switching off or signing out', async ({ page, ai }) => {
      await start(page, ai, ['합성 도서관']);
      // In use: the answer waits behind a button and the cards do not move.
      let release; ai.hold = new Promise(resolve => { release = resolve; });
      await refreshNow(page); await settled(async () => ai.requests.length, 2, 'asked');
      await page.mouse.move(400, 500); await page.mouse.wheel(0, 300); await frames(page);
      const before = await shownIds(page);
      ai.reply = body => ({ status: 200, body: { ...answer(body), picks: [{ n: 1, reason: '새 답' }] } });
      release(); ai.hold = null;
      await until(page, () => !!document.querySelector('#discoveryPickShow'), null, 'the button for the new answer');
      assert.deepEqual(await shownIds(page), before, 'the cards stay where they were');
      await page.locator('#discoveryPickShow').click(); await frames(page);
      assert.equal(await picked(page).count(), 1); assert.equal(await page.locator('#discoveryPickShow').count(), 0);
      // Switched off while waiting: the late answer is not drawn.
      let release2; ai.hold = new Promise(resolve => { release2 = resolve; });
      await refreshNow(page); await settled(async () => ai.requests.length, 3, 'asked again');
      await setPick(page, false); release2(); ai.hold = null; await page.waitForTimeout(500); await closeSettings(page);
      assert.equal(await picked(page).count(), 0, 'nothing picked after turning off'); assert.equal(await page.locator('#discoverySort').inputValue(), 'latest');
      // Signing out with an answer on the way: the next document shows none of it.
      await setPick(page, true); await settled(async () => ai.requests.length, 4, 'asked after turning on'); await closeSettings(page);
      let release3; ai.hold = new Promise(resolve => { release3 = resolve; });
      await refreshNow(page); await settled(async () => ai.requests.length, 5, 'asked before signing out');
      await page.evaluate(() => { window.__signedOut = HaedoAuth.signOut().catch(() => null); });
      await page.waitForFunction(() => !globalThis.HaedoAuth?.user, null, { timeout: 15000 }).catch(() => {});
      release3(); ai.hold = null; await page.waitForTimeout(600);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.discovery-pick-mark').length), 0, 'no pick after signing out');
      assert.equal(await page.evaluate(() => document.body.innerText.includes('합성 이유')), false);
    });

    await check('with 넓게 찾기 on: found links of the last 72 hours are candidates after its answer; a found link can be liked from ⋯ and is then not sent', async ({ page, ai, wide }) => {
      await addTopic(page, '합성 도서관');
      await setOption(page, 'discoveryWideSearch', 'wideSearch', true); await settled(async () => wide.requests.length, 1, 'wide asked');
      await setPick(page, true); await settled(async () => ai.requests.length, 1, 'pick asked'); await closeSettings(page);
      const titles = ai.requests[0].body.candidates.map(row => row.title);
      assert(titles.includes('넓게 합성 합성 도서관 1'), 'a found link of two hours ago is a candidate');
      assert(!titles.includes('넓게 합성 합성 도서관 2'), 'a found link of eighty hours ago is not');
      assert.equal(wide.requests[0].raw, '{"topics":["합성 도서관"],"languages":["ko","en"]}', '넓게 찾기 still sends its two fields only');
      // 좋아요 on a found link (owner decision 6): in the account's reactions, from the card's ⋯.
      const card = page.locator('#discoveryList > .discovery-article[data-wide]').first(), menu = card.locator('.discovery-card-more');
      const id = await card.getAttribute('data-discovery-id');
      await menu.locator('summary').click(); await menu.locator('[data-discovery-like]').click(); await idle(page);
      const entry = await page.evaluate(async id => (await HaedoLife.Shell.storage.readDiscoveryActions(await HaedoLife.Shell.storage.getActive())).entries.find(entry => entry.snapshot.id === id), id);
      assert.equal(entry.liked, true); assert.equal(entry.snapshot.sourceId, 'google-news');
      assert.equal(await page.locator(`#discoveryList [data-discovery-id="${id}"] .discovery-liked-mark`).count(), 1, 'the card shows the like');
      await refreshNow(page); await settled(async () => ai.requests.length, 2, 'asked again');
      assert(!ai.requests[1].body.candidates.some(row => row.title === entry.snapshot.title), 'the liked link is not a candidate');
      assert.equal(wide.requests.every(request => !request.raw.includes(entry.snapshot.title)), true, 'the like goes to no server');
      // Undo from the same menu.
      await page.locator(`#discoveryList [data-discovery-id="${id}"] .discovery-card-more > summary`).click();
      assert.equal(await page.locator(`#discoveryList [data-discovery-id="${id}"] [data-discovery-like]`).getAttribute('aria-pressed'), 'true');
    });

    await check('지금 갱신 pressed again while a pick is on its way sends nothing more: one request, one count', async ({ page, ai }) => {
      await start(page, ai, ['합성 도서관']);
      const counted = () => page.evaluate(() => JSON.parse(localStorage.getItem(HaedoLife.DiscoveryPick.COUNT_KEY)).count);
      assert.equal(await counted(), 1);
      let release; ai.hold = new Promise(resolve => { release = resolve; });
      await refreshNow(page); await settled(async () => ai.requests.length, 2, 'asked');
      await refreshNow(page); await refreshNow(page); await page.waitForTimeout(500);
      assert.equal(ai.requests.length, 2, 'the request on its way is not cut and sent again');
      assert.equal(await counted(), 2, 'counted once for the day');
      release(); ai.hold = null;
      await until(page, () => !document.querySelector('#discoveryPickNotice')?.textContent.includes('고르는 중'), null, 'answer drawn');
      assert.equal(await picked(page).count(), 3);
    });

    await check('articles marked read in the reading comparison are not candidates', async ({ page, ai }) => {
      // A real comparison record (DiscoveryReading.createComparison over the shown catalog), saved to the account:
      // its first article marked 일부 읽음, the second 본문을 읽음, the rest left unanswered.
      const marked = await page.evaluate(async () => {
        const st = HaedoLife.Shell.storage, id = await st.getActive(), Reading = HaedoLife.DiscoveryReading;
        const raw = await (await fetch('assets/life/discovery-feed.json', { cache: 'no-store' })).json(), checked = HaedoLife.Discovery.validateFeed(raw, { now: Date.now() });
        const feed = { schemaVersion: checked.schemaVersion, generatedAt: checked.generatedAt, sources: checked.sources.map(({ images, ...source }) => source), articles: checked.articles.map(({ imageUrl, ...article }) => article) };
        const [profile, feedback, actions, language, reading] = await Promise.all([st.readInterestProfile(id), st.readDiscoveryProfile(id), st.readDiscoveryActions(id), st.readDiscoveryLanguageSettings(id), st.readDiscoveryReading(id)]);
        const input = { feed, profile: { workspaceId: id, revision: profile.revision, manual: profile.manual.map(({ id, label }) => ({ id, label })) }, feedback, knownUrls: [], contentLanguages: language.contentLanguages,
          actions, translationTarget: language.translationTarget, baselineMode: 'latest', personalAllowed: false };
        let now = new Date().toISOString(), next = await Reading.createComparison(reading, structuredClone(input), { expectedRevision: reading.revision, now, sessionId: 'synthetic-pick-reading' });
        const urls = next.session.reviews.map(review => review.canonicalUrl);
        // Each step is saved as the reading UI saves it: one revision at a time.
        const save = async (value, base) => { const result = await st.saveDiscoveryReading(id, value, base); if (result.status !== 'stored') throw new Error('comparison not stored: ' + result.status); return value; };
        await save(next, reading.revision);
        next = await save(Reading.setReview(next, urls[0], { reading: 'partial' }, { expectedRevision: next.revision, now }), next.revision);
        next = await save(Reading.setReview(next, urls[1], { reading: 'full' }, { expectedRevision: next.revision, now }), next.revision);
        return { read: urls.slice(0, 2), other: urls.slice(2) };
      });
      assert.equal(marked.read.length, 2);
      await start(page, ai, ['합성 도서관']);
      const sent = ai.requests[0].body.candidates.map(row => row.title);
      const titleOf = url => feed().articles.concat(feed().extended.articles).find(row => row.url === url)?.title;
      for (const url of marked.read) assert(!sent.includes(titleOf(url)), 'a read article is not sent: ' + titleOf(url));
      for (const url of marked.other) assert(sent.includes(titleOf(url)), 'an unanswered article is a candidate: ' + titleOf(url));
      assert.equal(sent.length, 12 - marked.read.length, 'every other article is still a candidate');
    });

    await check('picks of found links only: after 넓게 찾기 is turned off the line says so and offers to ask again; the switch alone asks nothing', async ({ page, ai, wide }) => {
      ai.reply = body => ({ status: 200, body: { ...answer(body), picks: body.candidates.filter(row => row.title.startsWith('넓게 합성')).map(row => ({ n: row.n, reason: '넓게' })) } });
      await addTopic(page, '합성 도서관');
      await setOption(page, 'discoveryWideSearch', 'wideSearch', true); await settled(async () => wide.requests.length, 1, 'wide asked');
      await setPick(page, true); await settled(async () => ai.requests.length, 1, 'pick asked'); await closeSettings(page);
      await until(page, () => document.querySelectorAll('#discoveryList .discovery-pick-mark').length === 1, null, 'the found link is picked');
      await setOption(page, 'discoveryWideSearch', 'wideSearch', false); await closeSettings(page); await page.waitForTimeout(500);
      assert.equal(ai.requests.length, 1, 'turning 넓게 찾기 off asks nothing by itself');
      assert.equal(await picked(page).count(), 0);
      assert.equal(await notice(page), '추천한 글이 지금 목록에 없어요');
      ai.reply = body => ({ status: 200, body: answer(body) });
      await page.locator('#discoveryPickAgain').click(); await settled(async () => ai.requests.length, 2, '다시 추천받기 asks');
      await until(page, () => document.querySelectorAll('#discoveryList .discovery-pick-mark').length === 3, null, 'new picks drawn');
      assert.equal(await page.locator('#discoveryPickAgain').count(), 0);
      // 넓게 찾기 on/off is part of the key: the next opening asks for the new state.
      await setOption(page, 'discoveryWideSearch', 'wideSearch', true); await settled(async () => wide.requests.length, 2, 'wide asked again'); await closeSettings(page);
      await page.waitForTimeout(400); assert.equal(ai.requests.length, 2, 'not on the switch');
      await nav(page, 'schedule'); await nav(page, 'news'); await idle(page);
      await settled(async () => ai.requests.length, 3, 'the next opening asks');
      assert(ai.requests[2].body.candidates.some(row => row.title.startsWith('넓게 합성')), 'found links are candidates again');
    });

    for (const width of [820, 390]) await check('AI 추천 at ' + width + 'px: marked cards, 44px targets, no overflow', async ({ page, ai }) => {
      await start(page, ai, ['합성 도서관']);
      const card = cards(page).first();
      assert.equal(await card.locator('.discovery-pick-mark').count(), 1);
      for (const control of [card.locator('.discovery-row-open'), card.locator('[data-discovery-reaction=bookmarked]'), card.locator('.discovery-card-more > summary')]) assert((await control.boundingBox()).height >= 44);
      assert.equal(await overflow(page), false);
      await capture(page, 'pick-' + width);
      await openSettings(page); await page.locator('#discoveryNewsPick').scrollIntoViewIfNeeded(); await capture(page, 'pick-settings-' + width);
    }, { width });
    await check('AI 추천 at 1440px (capture)', async ({ page, ai }) => { await start(page, ai, ['합성 도서관', '합성 기후']); await capture(page, 'pick-1440'); });
  } finally {
    await browser.close();
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
  const failed = report.checks.filter(check => !check.pass);
  console.log(JSON.stringify({ checks: report.checks.length, failed: failed.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length }));
  // 4xx/5xx answers of the stand-ins are logged by the browser as failed resources; they are the point of those checks.
  const unexpectedConsole = report.consoleErrors.filter(row => !/Failed to load resource/.test(row.text));
  if (failed.length || unexpectedConsole.length || report.pageErrors.length || report.external.length) { console.error(JSON.stringify({ unexpectedConsole, pageErrors: report.pageErrors, external: report.external }, null, 2)); process.exitCode = 1; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

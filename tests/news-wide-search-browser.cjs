/* 2026-11-11 뉴스 2단계 화면 연결: 넓게 찾기(기본 꺼짐).
 * npm run dev; node tests/news-wide-search-browser.cjs
 * Actual application bytes with synthetic Auth and an anonymous synthetic catalog. The 넓게 찾기 server is a
 * stand-in defined here that answers as docs/design-review/news-wide-feed.md describes; no request reaches a
 * search supplier, a publisher or production. Every topic, title and publisher name below is made up.
 * Chromium viewport widths are not Apple-device checks. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, nav } = require('./unified-home-browser.cjs');
const { harnessFrameError } = require('./helpers/news-reader.cjs');
const out = path.resolve(process.env.NEWS_WIDE_OUTPUT || path.join(__dirname, '../.local/news-wide-search'));
const report = { createdAt: new Date().toISOString(), scope: 'Local Chromium, synthetic Auth, synthetic catalog and a stand-in 넓게 찾기 server only.', checks: [], consoleErrors: [], pageErrors: [], external: [], captures: [] };
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
const PREFIX = 'https://news.google.com/';
const hex = text => crypto.createHash('md5').update(text).digest('hex');
const sizes = { 1440: 960, 820: 1180, 390: 844 };
const only = process.env.NEWS_WIDE_ONLY || '';

// The fixed catalog: three publishers, newest first every three minutes.
const fixedNames = { 'readersnews-books': '독서신문', 'seoul-culture': '서울시 문화', 'yna-news': '연합뉴스' };
const fixedUrls = { 'readersnews-books': 'www.readersnews.com/news/articleView.html?idxno=', 'seoul-culture': 'news.seoul.go.kr/culture/archives/', 'yna-news': 'www.yna.co.kr/view/AKR' };
const fixedTitle = index => '고정 출처 합성 제목 ' + (index + 1);
function feed(count = 12) {
  const now = Date.now(), iso = minutes => new Date(now - minutes * 60000 - 30000).toISOString(), rights = { mode: 'metadata_only', label: '합성 제목·링크', url: null };
  const source = id => ({ id, name: fixedNames[id], url: 'https://' + fixedUrls[id].split('/')[0] + '/', feedUrl: 'https://' + fixedUrls[id].split('/')[0] + '/feed', language: 'ko', rights, status: 'ok', stale: false, error: null, lastSuccessAt: iso(1), lastAttemptAt: iso(1) });
  const order = ['readersnews-books', 'seoul-culture', 'yna-news'];
  const rows = Array.from({ length: count }, (_, i) => ({ id: 'fixed-' + i, sourceId: order[i % 3], url: 'https://' + fixedUrls[order[i % 3]] + (70000 + i), title: fixedTitle(i), language: 'ko', tags: [], author: null,
    publishedAt: iso(10 + i * 3), fetchedAt: iso(1), summary: '', coverage: 'link_only', rights }));
  return { schemaVersion: 1, generatedAt: iso(1), sources: order.slice(0, 2).map(source), articles: rows.filter(row => row.sourceId !== 'yna-news'), extended: { sources: [source('yna-news')], articles: rows.filter(row => row.sourceId === 'yna-news') } };
}
// The reviewer's order probe (2026-11-11): six sources, half of the rows from 연합뉴스, so the publisher cap reorders pages.
// `extra` newer articles are what a timed refresh brings.
const skewNames = { 'readersnews-books': ['독서신문', 'www.readersnews.com/news/articleView.html?idxno='], 'seoul-culture': ['서울시 문화', 'news.seoul.go.kr/culture/archives/'], 'yna-news': ['연합뉴스', 'www.yna.co.kr/view/AKR'],
  'sbs-news': ['SBS', 'news.sbs.co.kr/news/endPage.do?news_id=N'], 'nocut-news': ['노컷뉴스', 'www.nocutnews.co.kr/news/'], 'arxiv-cs-cl': ['arXiv', 'arxiv.org/abs/2611.'] };
function skewed(count, extra = 0) {
  const now = Date.now(), iso = minutes => new Date(now - minutes * 60000 - 30000).toISOString(), rights = { mode: 'metadata_only', label: '합성 제목·링크', url: null }, ids = Object.keys(skewNames);
  const host = id => skewNames[id][1].split('/')[0], legacy = id => ['readersnews-books', 'seoul-culture', 'arxiv-cs-cl'].includes(id);
  const source = id => ({ id, name: skewNames[id][0], url: 'https://' + host(id) + '/', feedUrl: 'https://' + host(id) + '/feed', language: 'ko', rights, status: 'ok', stale: false, error: null, lastSuccessAt: iso(1), lastAttemptAt: iso(1) });
  const row = (id, key, n, minutes, title) => ({ id: key, sourceId: id, url: 'https://' + skewNames[id][1] + n, title, language: 'ko', tags: [], author: null, publishedAt: iso(minutes), fetchedAt: iso(1), summary: '', coverage: 'link_only', rights });
  const rows = Array.from({ length: count }, (_, i) => { const id = i % 2 ? 'yna-news' : ids[(i >> 1) % ids.length]; return row(id, 'p-' + i, 90000 + i, 20 + i * 2, '합성 제목 ' + i); });
  for (let j = 0; j < extra; j++) rows.push(row(ids[j % ids.length], 'n-' + j, 80000 + j, 1 + j * 0.1, '새 합성 ' + j));
  return { schemaVersion: 1, generatedAt: iso(1), sources: ids.filter(legacy).map(source), articles: rows.filter(r => legacy(r.sourceId)), extended: { sources: ids.filter(id => !legacy(id)).map(source), articles: rows.filter(r => !legacy(r.sourceId)) } };
}
const shownIds = page => cards(page).evaluateAll(nodes => nodes.map(node => node.dataset.discoveryId));
// One found link as the server sends it.
function item(topic, language, index, extra = {}) {
  const id = hex(topic + '\n' + language + '\n' + index);
  return { id, title: '넓게 합성 ' + topic + ' ' + (index + 1), link: PREFIX + 'rss/articles/SYN' + id + '?oc=5', publishedAt: new Date(Date.now() - (index * 4 + 1) * 60000).toISOString(),
    sourceName: '합성매체 ' + (index % 4 + 1), sourceUrl: 'https://publisher' + (index % 4 + 1) + '.example', topic, language, ...extra };
}
// The answer the stand-in gives unless a check sets its own: two links for each topic and language.
function answer(body, { per = 2, status = 'fresh', stale = false } = {}) {
  const items = [], topics = [], fetchedAt = new Date(Date.now() - 60000).toISOString();
  for (const topic of body.topics) for (const language of body.languages) {
    for (let i = 0; i < per; i++) items.push(item(topic, language, i));
    topics.push({ topic, language, status, fetchedAt, count: per });
  }
  return { supplier: 'google-news-rss', items, fetchedAt, stale, topics };
}
// The stand-in refuses a topic with the server's own rule (supabase/functions/haedo-news-wide/topics.mjs), and also
// refuses SERVER_ONLY, a topic the rule takes: a server whose Unicode tables differ from the browser's would do that.
const SERVER_ONLY = new Set(['서버만 거절']);
let serverRule = null;
const refusedTopic = topic => { try { serverRule(topic); } catch (_) { return true; } return SERVER_ONLY.has(topic); };
const cards = page => page.locator('#discoveryList > .discovery-article');
const wideCards = page => page.locator('#discoveryList > .discovery-article[data-wide]');
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
const manual = page => page.evaluate(async () => (await HaedoLife.Shell.storage.readInterestProfile(await HaedoLife.Shell.storage.getActive())).manual.map(row => row.label));
async function addTopic(page, text) {
  await openSettings(page);
  await page.locator('#discoveryTopicInput').fill(text); await page.locator('#discoveryTopicAdd').click(); await idle(page);
  await until(page, async text => (await HaedoLife.Shell.storage.readInterestProfile(await HaedoLife.Shell.storage.getActive())).manual.some(row => row.label === text), text, 'topic saved: ' + text);
}
const storedOptions = page => page.evaluate(async () => (await HaedoLife.Shell.storage.readDiscoverySettings(await HaedoLife.Shell.storage.getActive())).disabledSourceIds);
async function setWide(page, on) {
  await openSettings(page);
  await page.locator('#discoveryWideSearch').setChecked(on); await idle(page);
  await until(page, async on => HaedoLife.DiscoverySettings.wideSearch(await HaedoLife.Shell.storage.readDiscoverySettings(await HaedoLife.Shell.storage.getActive())) === on, on, '넓게 찾기 saved ' + on);
}
async function refreshNow(page) { await page.locator('#discoveryFilterToggle').click(); await page.locator('#discoveryRefreshNow').click(); await idle(page); await frames(page); }

async function main() {
  await fs.mkdir(out, { recursive: true });
  serverRule = (await import('../supabase/functions/haedo-news-wide/topics.mjs')).normalizeTopic;
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, run, { width = 1440, catalog = feed() } = {}) {
    if (only && !name.includes(only)) return;
    const server = new FakeCloud(), context = await makeContext(browser, server, 'news-wide-' + report.checks.length, accounts.a, { viewport: { width, height: sizes[width] } });
    // wide.reply(body) returns { status, body } or 'abort'; wide.hold delays the answer.
    const wide = { requests: [], clears: [], reply: body => ({ status: 200, body: answer(body) }), clearReply: () => ({ status: 200, body: { status: 'cleared', removed: 3 } }), hold: null, supplier: [] };
    const state = { catalog, catalogRequests: 0, wide };
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback();
      // The supplier's address is opened only by a person's press, in a new tab: a synthetic page answers it.
      if (url.origin + '/' === PREFIX && request.resourceType() === 'document') { wide.supplier.push({ url: url.href, referer: request.headers().referer || null }); return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>합성 공급자 응답</title><p>합성 이동 페이지</p>' }); }
      if (url.hostname === 'www.readersnews.com' && request.resourceType() === 'document') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>합성 출판사 응답</title><p>합성 원문 페이지</p>' });
      report.external.push({ check: name, url: url.origin + url.pathname }); return route.abort('blockedbyclient');
    });
    await context.route(base + '/assets/life/discovery-feed.json', route => { state.catalogRequests++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify(state.catalog) }); });
    const serve = (list, reply) => async route => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
      const headers = request.headers(), entry = { method: request.method(), raw: request.postData(), body: request.postDataJSON(), authorization: /^Bearer .+/.test(headers.authorization || ''), apikey: !!headers.apikey, cookie: headers.cookie || null, referer: headers.referer || null, at: Date.now() };
      list.push(entry);
      if (wide.hold) await wide.hold;
      const result = reply(entry.body);
      if (result === 'abort') return route.abort('failed');
      return route.fulfill({ status: result.status, headers: { ...cors, 'content-type': result.contentType || 'application/json' }, body: typeof result.body === 'string' ? result.body : JSON.stringify(result.body) });
    };
    await context.route(cloud + '/functions/v1/haedo-news-wide', serve(wide.requests, body => body?.topics?.some(refusedTopic) ? { status: 400, body: { error: 'invalid_topic' } } : wide.reply(body)));
    await context.route(cloud + '/rest/v1/rpc/life_news_wide_clear', serve(wide.clears, body => wide.clearReply(body)));
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const messages = [];
    page.on('console', message => { messages.push(message.text()); if (message.type() === 'error') report.consoleErrors.push({ check: name, text: message.text() }); });
    page.on('pageerror', error => { if (harnessFrameError(error.message)) (report.harnessFrameErrors ||= []).push(name); else report.pageErrors.push({ check: name, text: error.message }); });
    try {
      await page.goto(base + '/index.html'); await ready(page);
      await nav(page, 'news'); await idle(page); await frames(page);
      await run({ page, state, wide, server, context, messages });
      report.checks.push({ name, pass: true }); console.log('PASS ' + name);
    } catch (error) {
      report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack);
      await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {});
    } finally { await context.close(); }
  }
  // Typed topics, 넓게 찾기 on, back on the list with the answer drawn.
  async function start(page, wide, topics = ['동네 도서관', '기후 정책'], expected = 1) {
    for (const topic of topics) await addTopic(page, topic);
    await setWide(page, true); await settled(async () => wide.requests.length, expected, 'one request after turning on');
    // The answer arrives while settings cover the list, so it takes its place in the order (a list looked at keeps its cards).
    await until(page, () => { const notes = [...document.querySelectorAll('#discoveryWideTopics .discovery-wide-topic-note')]; return notes.length && !notes.some(note => note.textContent === '받는 중'); }, null, 'answer received in settings');
    await closeSettings(page); await until(page, () => !document.querySelector('#discoveryWideNotice')?.textContent.includes('찾는 중'), null, 'answer drawn');
  }
  try {
    await check('off by default: topics, reactions, refresh and time send nothing', async ({ page, wide, state }) => {
      assert.deepEqual(await storedOptions(page), []);
      await addTopic(page, '동네 도서관'); await addTopic(page, '기후 정책');
      const box = page.locator('#discoveryWideSearch');
      assert.equal(await box.isChecked(), false); assert.equal(await box.isEnabled(), true);
      const help = await page.locator('#discoveryWideHelp').innerText();
      for (const part of ['Google 뉴스', '관심 주제와 콘텐츠 언어', '좋아요·담은 글·읽은 글은 보내지 않습니다', 'Google 주소를 거쳐 원문', '내 계정 서버에만 보관하고, 끄면 지웁니다', '담은 글과 읽음·관련 없음 기록은 남습니다']) assert(help.includes(part), 'settings text names: ' + part);
      assert.equal(await box.getAttribute('aria-describedby'), 'discoveryWideHelp');
      assert.equal(await page.locator('#discoveryWideTopics').count(), 0, 'nothing is listed as sent while off');
      await closeSettings(page);
      await cards(page).nth(0).locator('[data-discovery-reaction=bookmarked]').click(); await idle(page);
      await refreshNow(page); await nav(page, 'schedule'); await nav(page, 'news'); await idle(page); await page.waitForTimeout(400);
      assert.equal(wide.requests.length, 0, 'no 넓게 찾기 request while off'); assert.equal(wide.clears.length, 0);
      assert.equal(await wideCards(page).count(), 0); assert.equal(await page.locator('#discoveryWideNotice').count(), 0);
      assert.equal(await cards(page).count(), 12, 'a saved card stays in 전체'); assert(state.catalogRequests >= 2);
    });

    await check('on: the request carries the typed topics and the content languages, nothing else', async ({ page, wide, messages }) => {
      // Reactions first: a saved card, a liked article and a read one. None of their words may be sent.
      await cards(page).nth(0).locator('[data-discovery-reaction=bookmarked]').click(); await idle(page);
      await page.locator('#discoveryList [data-discovery-id="fixed-3"] [data-discovery-select]').click(); await frames(page);
      await page.locator('#discoveryReaderHost [data-discovery-reaction=liked]').click(); await idle(page);
      await page.locator('#discoveryReaderHost .discovery-reader-back').click(); await frames(page);
      const menu = page.locator('#discoveryList [data-discovery-id="fixed-5"] .discovery-card-more'); await menu.locator('summary').click(); await menu.locator('[data-discovery-feedback=already_read]').click(); await idle(page);
      await start(page, wide);
      assert.equal(wide.requests.length, 1);
      const sent = wide.requests[0];
      assert.equal(sent.method, 'POST'); assert.equal(sent.raw, '{"topics":["동네 도서관","기후 정책"],"languages":["ko","en"]}', 'the body is exactly the typed topics and the language codes');
      assert.equal(sent.authorization, true); assert.equal(sent.apikey, true); assert.equal(sent.cookie, null); assert.equal(sent.referer, null);
      for (const word of ['고정 출처', '독서신문', '서울시', '연합뉴스', 'fixed-']) assert(!sent.raw.includes(word), 'no reaction or catalog word in the request: ' + word);
      // Settings list what was sent, in the order typed.
      await openSettings(page);
      assert.deepEqual(await page.locator('#discoveryWideTopics > li').evaluateAll(nodes => nodes.map(node => [node.querySelector('.discovery-wide-topic').textContent, node.dataset.wideSent, node.querySelector('.discovery-wide-topic-note').textContent])),
        [['동네 도서관', 'true', '한국어 2건 · 영어 2건'], ['기후 정책', 'true', '한국어 2건 · 영어 2건']]);
      // An unchecked topic is not sent; the next answer is for the remaining topic.
      const first = (await manual(page)).indexOf('동네 도서관');
      await page.locator('#discoveryTopics .discovery-check input[id^="discoveryInterest-"]').nth(first).setChecked(false); await idle(page);
      await settled(async () => wide.requests.length, 2, 'a changed topic choice asks again');
      assert.equal(wide.requests[1].raw, '{"topics":["기후 정책"],"languages":["ko","en"]}');
      // Console output never carries a topic or a found title.
      for (const text of messages) for (const word of ['동네 도서관', '기후 정책', '넓게 합성']) assert(!text.includes(word), 'console is silent about ' + word);
    });

    await check('no typed topic: reactions alone send nothing', async ({ page, wide }) => {
      for (const index of [0, 1, 2, 3]) { await cards(page).nth(index).locator('[data-discovery-reaction=bookmarked]').click(); await idle(page); }
      await page.locator('#discoveryList [data-discovery-id="fixed-6"] [data-discovery-select]').click(); await frames(page);
      await page.locator('#discoveryReaderHost [data-discovery-reaction=liked]').click(); await idle(page);
      await page.locator('#discoveryReaderHost .discovery-reader-back').click(); await frames(page);
      await setWide(page, true); await closeSettings(page); await refreshNow(page); await page.waitForTimeout(400);
      assert.equal(wide.requests.length, 0, 'likes and saved articles are not topics');
      await openSettings(page);
      assert.match(await page.locator('.discovery-wide-settings').innerText(), /보낼 관심 주제가 없습니다/);
      assert.equal(await wideCards(page).count(), 0);
    });

    await check('topics outside the server rule are never sent and say so as typed; a server refusal is kept across openings', async ({ page, wide }) => {
      const typed = ['주제 하나', 'site:example.com', '주제 둘', '빼기 -제외', '서버만 거절', '주제 셋', '주제 넷', '주제 다섯', '주제 여섯', '주제 일곱', '주제 여덟', '주제 아홉'];
      for (const topic of typed) await addTopic(page, topic);
      // The screen checks the rule first (contract ab94caf, item 10): the first eight topics that pass it go.
      // Safety net: the server still refuses one of them; each is asked alone once and the refused one is left out.
      await setWide(page, true); await settled(async () => wide.requests.length, 10, 'one request, eight single ones, then the eight topics taken');
      const first = ['주제 하나', '주제 둘', '서버만 거절', '주제 셋', '주제 넷', '주제 다섯', '주제 여섯', '주제 일곱'];
      assert.deepEqual(wide.requests[0].body.topics, first);
      assert.deepEqual(wide.requests.slice(1, 9).map(request => request.body.topics), first.map(topic => [topic]));
      const taken = { topics: ['주제 하나', '주제 둘', '주제 셋', '주제 넷', '주제 다섯', '주제 여섯', '주제 일곱', '주제 여덟'], languages: ['ko', 'en'] };
      assert.deepEqual(wide.requests[9].body, taken);
      await page.waitForTimeout(400); assert.equal(wide.requests.length, 10, 'nothing more is asked');
      // A topic outside the rule never left the device, not even in a single request.
      for (const request of wide.requests) for (const topic of request.body.topics) assert.ok(!['site:example.com', '빼기 -제외'].includes(topic), 'sent: ' + topic);
      const rows = await page.locator('#discoveryWideTopics > li').evaluateAll(nodes => nodes.map(node => [node.querySelector('.discovery-wide-topic').textContent, node.dataset.wideSent, node.querySelector('.discovery-wide-topic-note').textContent]));
      assert.equal(rows.length, typed.length, 'every typed topic is listed');
      const unsent = rows.filter(row => row[1] === 'false');
      assert.deepEqual(unsent.map(row => row[0]), ['site:example.com', '빼기 -제외', '서버만 거절', '주제 아홉']);
      for (const row of unsent) assert.match(row[2], /^보내지 않음 · .{4,}/, 'a reason in words: ' + row[0]);
      assert.match(unsent[0][2], /받지 않는 글자나 기호/); assert.match(unsent[1][2], /받지 않는 글자나 기호/);
      assert.match(unsent[2][2], /서버가 받지 않는 주제/); assert.match(unsent[3][2], /8개/, 'the ninth says the limit');
      assert.match(await page.locator('.discovery-wide-settings').innerText(), /위에서부터 8개까지/, 'the order rule is on the screen');
      // The help names the examples of the contract.
      const help = await page.locator('.discovery-wide-settings').innerText();
      for (const example of ['K-pop', '3-1', '.NET', '10%', '1,000원', 'Yahoo!', '왜?', 'Portland OR', '"기후"', 'site:example.com', '50:50', '-날씨', 'a,-b', '1..10', '기후 OR 날씨', '기후*']) assert(help.includes(example), 'example ' + example);
      await capture(page, 'wide-settings-1440');
      // The refusal is kept in the account's news settings as a key, not as the topic's text.
      const kept = await until(page, async () => { const ids = (await HaedoLife.Shell.storage.readDiscoverySettings(await HaedoLife.Shell.storage.getActive())).disabledSourceIds.filter(id => id.startsWith('option-wide-refused-')); return ids.length ? ids : null; }, null, 'refusal kept');
      assert.equal(kept.length, 1); assert.match(kept[0], /^option-wide-refused-[0-9a-f]{16}$/);
      // As the topic is typed: the same rule, said under the input. A topic the rule takes says nothing.
      const note = page.locator('#discoveryTopicWideNote');
      assert.equal(await note.isVisible(), false);
      await page.locator('#discoveryTopicInput').fill('기후 OR 날씨');
      assert.equal(await note.isVisible(), true); assert.equal(await note.getAttribute('role'), 'status');
      assert.match(await note.innerText(), /^넓게 찾기에는 보내지 않습니다 · 받지 않는 글자나 기호가 있습니다/);
      await page.locator('#discoveryTopicInput').fill('기후 or 날씨'); assert.equal(await note.isVisible(), false, 'lower-case or is a word');
      await page.locator('#discoveryTopicInput').fill('가'.repeat(41)); assert.match(await note.innerText(), /40자까지/);
      await page.locator('#discoveryTopicDiscard').click(); assert.equal(await note.isVisible(), false);
      // The app opened again: the kept refusal is not asked again (one request, not 1 + 8 + 1).
      await page.reload(); await ready(page); await nav(page, 'news'); await idle(page);
      await settled(async () => wide.requests.length, 11, 'one request after opening again');
      await page.waitForTimeout(400); assert.equal(wide.requests.length, 11, 'no single-topic requests after opening again');
      assert.deepEqual(wide.requests[10].body, taken);
      // Turning 넓게 찾기 off takes the kept refusal away: a new choice asks again.
      await setWide(page, false);
      await until(page, async () => !(await HaedoLife.Shell.storage.readDiscoverySettings(await HaedoLife.Shell.storage.getActive())).disabledSourceIds.some(id => id.startsWith('option-wide-refused-')), null, 'refusal removed with off');
      assert.equal(await note.isVisible(), false, 'nothing is said while 넓게 찾기 is off');
      await page.locator('#discoveryTopicInput').fill('site:example.com'); assert.equal(await note.isVisible(), false, 'off: nothing is sent, nothing to say');
      await page.locator('#discoveryTopicDiscard').click();
    });

    await check('found links join 전체: marked in words, de-duplicated, at most three of one publisher on a page', async ({ page, wide, state }) => {
      wide.reply = body => {
        const base = answer(body, { per: 0 }), now = Date.now(), at = minutes => new Date(now - minutes * 60000).toISOString();
        const row = (index, extra) => item('동네 도서관', 'ko', index, extra);
        base.items = [
          ...Array.from({ length: 6 }, (_, i) => row(i, { sourceName: '합성일보', publishedAt: at(1 + i) })),          // six newest, one publisher
          row(10, { title: fixedTitle(2), sourceName: '연합뉴스', publishedAt: at(3) }),                                 // the same article as a fixed one: hidden
          row(11, { title: fixedTitle(4), sourceName: '다른 합성매체', publishedAt: at(4) }),                             // same title, another publisher: shown
          row(12, { title: fixedTitle(0) + ' ', sourceName: '독서신문', publishedAt: at(5) }),                            // not exactly the same title: shown
          row(13, { sourceName: null, publishedAt: null }),                                                               // no publisher name or time
          ...Array.from({ length: 6 }, (_, i) => row(20 + i, { sourceName: '추가 합성매체 ' + (i + 1), publishedAt: at(30 + i) })), // six more publishers, older
          { ...row(0), title: '같은 id의 두 번째 항목' }                                                                 // repeated id
        ];
        base.topics = [{ topic: '동네 도서관', language: 'ko', status: 'fresh', fetchedAt: base.fetchedAt, count: base.items.length }];
        return { status: 200, body: base };
      };
      state.catalog = feed(26); await page.reload(); await ready(page); await nav(page, 'news'); await idle(page);
      await start(page, wide, ['동네 도서관']);
      // 26 fixed + 15 found (one hidden as the same article, one repeated id).
      assert.match(await page.locator('#discoveryDiscover').innerText(), /^전체\s*41$/);
      const firstPage = await cards(page).evaluateAll(nodes => nodes.map(node => ({ wide: node.dataset.wide === 'true', publisher: node.querySelector('.discovery-source-name').textContent, title: node.querySelector('.discovery-title').textContent, time: node.querySelector('time')?.getAttribute('datetime') || null })));
      assert.equal(firstPage.length, 20);
      const tally = {}; for (const card of firstPage) tally[card.publisher] = (tally[card.publisher] || 0) + 1;
      assert.equal(tally['합성일보'], 3, 'three of six newest links of one publisher on the first page');
      for (const [publisher, count] of Object.entries(tally)) assert(count <= 3 || !firstPage.some(card => card.wide && card.publisher === publisher), publisher + ' holds ' + count);
      const times = firstPage.map(card => card.time).filter(Boolean); assert.deepEqual(times, [...times].sort().reverse(), 'a page reads newest first');
      // Marked in words, same text card, no picture, publisher name and elapsed time.
      const found = await wideCards(page).first().evaluate(node => ({ mark: node.querySelector('.discovery-wide-mark').textContent, markTitle: node.querySelector('.discovery-wide-mark').title, images: node.querySelectorAll('img, picture, .discovery-card-media').length,
        meta: node.querySelector('.discovery-meta').innerText, like: node.querySelectorAll('[data-discovery-reaction=liked]').length, save: node.querySelectorAll('[data-discovery-reaction=bookmarked]').length, topic: node.querySelector('.discovery-topic-badge')?.textContent }));
      assert.equal(found.mark, '넓게'); assert.equal(found.markTitle, '넓게 찾기로 받은 글'); assert.equal(found.images, 0); assert.match(found.meta, /^합성일보\s*·?\s*\d+분 전/); assert.equal(found.like, 0); assert.equal(found.save, 1); assert.equal(found.topic, '동네 도서관');
      // To the end: every row exactly once.
      while (await page.locator('#discoveryShowMore').count()) { await page.locator('#discoveryShowMore').click(); await frames(page); }
      const all = await cards(page).evaluateAll(nodes => nodes.map(node => node.dataset.discoveryId));
      assert.equal(all.length, 41); assert.equal(new Set(all).size, 41, 'no card twice');
      const titles = await wideCards(page).evaluateAll(nodes => nodes.map(node => node.querySelector('.discovery-title').textContent));
      assert.equal(titles.length, 15);
      assert(!titles.includes('같은 id의 두 번째 항목')); assert(titles.includes(fixedTitle(4)), 'same title from another publisher stays'); assert(titles.includes(fixedTitle(0) + ' ') || titles.includes(fixedTitle(0)), 'a near title stays');
      assert.equal(await page.locator('#discoveryList > .discovery-article:not([data-wide]) .discovery-title', { hasText: fixedTitle(2) }).count() >= 1, true, 'the fixed article itself stays');
      assert.equal(titles.filter(title => title === fixedTitle(2)).length, 0, 'the found copy of a fixed article is hidden');
      // 관심순 lists found links after the matched catalog rows; a topic that matches nothing in the catalog still shows them.
      await page.locator('#discoveryFilterToggle').click(); await page.locator('#discoverySort').selectOption('related'); await idle(page); await frames(page);
      assert.equal(await wideCards(page).count() > 0, true, 'found links are listed in 관심순');
    });

    await check('a found link opens in a new tab only, after its address is checked again', async ({ page, wide, context }) => {
      await start(page, wide, ['동네 도서관']);
      const card = wideCards(page).first(), link = card.locator('a.discovery-row-open');
      const shape = await link.evaluate(node => ({ href: node.getAttribute('href'), target: node.target, rel: node.rel.split(/\s+/).sort().join(' '), referrer: node.referrerPolicy, label: node.getAttribute('aria-label'), text: node.textContent, describedby: !!document.getElementById(node.getAttribute('aria-describedby')) }));
      assert(shape.href.startsWith(PREFIX)); assert.equal(shape.target, '_blank'); assert.equal(shape.rel, 'noopener noreferrer'); assert.equal(shape.referrer, 'no-referrer');
      assert.equal(shape.label, shape.text + ' · 새 탭에서 열림'); assert.equal(shape.describedby, true);
      assert.equal(await card.locator('[data-discovery-select]').count(), 0, 'no control opens the reading column');
      const [popup] = await Promise.all([context.waitForEvent('page'), link.click()]);
      await popup.waitForLoadState(); assert.equal(await popup.title(), '합성 공급자 응답'); assert.equal(await popup.evaluate(() => window.opener), null); await popup.close();
      assert.deepEqual(wide.supplier.map(row => [row.url, row.referer]), [[shape.href, null]], 'one visit, no referrer');
      assert.equal(await page.locator('.discovery-news').getAttribute('data-reading'), 'false'); assert.equal(await page.locator('#discoveryReaderHost').isVisible(), false);
      // Keyboard: Enter on the link does the same; a press on the rest of the card opens nothing.
      await link.focus(); const [second] = await Promise.all([context.waitForEvent('page'), page.keyboard.press('Enter')]); await second.close();
      await card.locator('.discovery-meta').click(); await frames(page); await page.waitForTimeout(200);
      assert.equal(context.pages().length, 1); assert.equal(await page.locator('.discovery-news').getAttribute('data-reading'), 'false');
      // An address changed after drawing is not followed.
      await link.evaluate(node => node.setAttribute('href', 'https://news.google.com.example.org/x')); await link.click(); await page.waitForTimeout(300);
      assert.equal(context.pages().length, 1, 'a link off the supplier host does not open'); assert.equal(wide.supplier.length, 2);
      await link.evaluate(node => node.setAttribute('href', 'javascript:window.__wideRan=1')); await link.click(); await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => window.__wideRan), undefined);
    });

    await check('a hostile answer is shown as text or dropped', async ({ page, wide }) => {
      const markup = '<script>window.__wideXss=1</script><img src=x onerror="window.__wideXss=1">굵게</b>';
      wide.reply = body => {
        const base = answer(body, { per: 0 }), row = (index, extra) => item('동네 도서관', 'ko', index, extra);
        base.items = [
          row(0, { title: markup, sourceName: '<b onmouseover="window.__wideXss=1">합성</b>' }),
          row(1, { link: 'javascript:window.__wideXss=1' }), row(2, { link: 'https://news.google.com.evil.example/rss/articles/x' }), row(3, { link: 'http://news.google.com/rss/articles/x' }),
          row(4, { link: 'https://news.google.com@evil.example/x' }), row(5, { link: 'https://evil.example/?next=https://news.google.com/' }), row(6, { link: 'https://news.google.com:8443/rss/articles/x' }),
          row(7, { title: '가'.repeat(501) }), row(8, { sourceName: '나'.repeat(201) }), row(9, { id: 'not-an-id' }), row(10, { title: '' }), row(11, { publishedAt: 'yesterday' }), row(12, { language: 'ja' }),
          row(13, { sourceUrl: 'javascript:window.__wideXss=1' }), row(14, { html: '<b>모르는 필드</b>', score: 99, image: 'https://evil.example/pixel.png' }),
          null, 'text', { id: hex('loose') }
        ];
        base.topics = [{ topic: '동네 도서관', language: 'ko', status: 'fresh', fetchedAt: base.fetchedAt, count: 3, extra: '<i>' }];
        return { status: 200, body: { ...base, html: '<script>window.__wideXss=1</script>', next: 'https://evil.example/' } };
      };
      await start(page, wide, ['동네 도서관']);
      const shown = await wideCards(page).evaluateAll(nodes => nodes.map(node => ({ title: node.querySelector('.discovery-title').textContent, publisher: node.querySelector('.discovery-source-name').textContent, href: node.querySelector('a.discovery-row-open')?.getAttribute('href') || null,
        elements: node.querySelectorAll('script, img, b, i, iframe, [onerror], [onmouseover]').length, links: [...node.querySelectorAll('a')].map(link => link.getAttribute('href')) })));
      // Shown: the markup title (as text), the bad sourceUrl row (its address is not used) and the row with unknown fields.
      assert.equal(shown.length, 3, JSON.stringify(shown.map(row => row.title)));
      const hostile = shown.find(row => row.title === markup); assert(hostile, 'markup is text'); assert.equal(hostile.publisher, '<b onmouseover="window.__wideXss=1">합성</b>');
      for (const row of shown) { assert.equal(row.elements, 0, 'no element built from the answer'); assert(row.href.startsWith(PREFIX)); for (const link of row.links) assert(link.startsWith(PREFIX), 'every address on the card is the supplier address'); }
      assert.equal(await page.evaluate(() => window.__wideXss), undefined);
      assert.equal(await page.locator('#discoveryList').evaluate(node => /evil\.example|javascript:/.test(node.innerHTML)), false);
      // The menu and its information panel are text too.
      const first = wideCards(page).first(); await first.locator('.discovery-card-more > summary').click(); await first.locator('.discovery-article-info > summary').click(); await frames(page);
      assert.match(await first.locator('.discovery-article-info').innerText(), /넓게 찾기로 받은 글[\s\S]*Google 주소를 거쳐 원문/);
      assert.equal(await first.locator('.discovery-more-body').evaluate(node => node.querySelectorAll('script, img, iframe').length), 0);
      assert.equal(await page.evaluate(() => window.__wideXss), undefined);
      // An answer that is not the contract at all: nothing of it is shown.
      wide.reply = () => ({ status: 200, body: { supplier: 'someone-else', items: [item('동네 도서관', 'ko', 20)], fetchedAt: null, stale: false, topics: [] } });
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await refreshNow(page);
      await until(page, () => document.querySelector('#discoveryWideNotice')?.textContent.includes('확인하지 못했습니다'), null, 'invalid answer notice');
      assert.equal(await cards(page).count() >= 12, true, 'the fixed list stays');
    });

    await check('stale, limited and failed answers say so above the list with the time; each topic says so in settings', async ({ page, wide }) => {
      const fetchedAt = new Date(Date.now() - 50 * 60000).toISOString();
      wide.reply = body => { const base = answer(body, { status: 'stale', stale: true }); base.fetchedAt = fetchedAt; for (const row of base.topics) row.fetchedAt = fetchedAt; return { status: 200, body: base }; };
      await start(page, wide, ['동네 도서관']);
      const notice = page.locator('#discoveryWideNotice');
      assert.equal(await notice.getAttribute('role'), 'status');
      assert.match(await notice.innerText(), /^넓게 찾기 · 일부 주제를 새로 받지 못했습니다\. .+ 기준 목록이 섞여 있습니다\.$/);
      assert.equal(await wideCards(page).count(), 4, 'the earlier links stay');
      await capture(page, 'wide-notice-stale-1440');
      await openSettings(page); assert.match(await page.locator('#discoveryWideTopics > li').first().innerText(), /한국어 2건\(이전 목록\) · 영어 2건\(이전 목록\)/); await closeSettings(page);
      wide.reply = body => { const base = answer(body, { status: 'limited' }); base.fetchedAt = fetchedAt; return { status: 200, body: base }; };
      await refreshNow(page); await until(page, () => document.querySelector('#discoveryWideNotice')?.textContent.includes('횟수를 다 썼습니다'), null, 'limited notice');
      assert.match(await notice.innerText(), /기준 목록입니다\.$/);
      wide.reply = body => { const base = answer(body, { per: 0, status: 'failed' }); base.fetchedAt = null; for (const row of base.topics) { row.fetchedAt = null; row.reason = 'upstream_error'; } return { status: 200, body: base }; };
      await refreshNow(page); await until(page, () => document.querySelector('#discoveryWideNotice')?.textContent.includes('새 글을 받지 못했습니다'), null, 'failed notice');
      assert.equal(await wideCards(page).count(), 0); assert.equal(await cards(page).count(), 12, 'the fixed list is as it was');
      await openSettings(page); assert.match(await page.locator('#discoveryWideTopics > li').first().innerText(), /한국어 받지 못함 · 영어 받지 못함/);
    });

    await check('403 not_enabled_for_account: said once, the switch is saved off, nothing asked again, the session stays', async ({ page, wide }) => {
      wide.reply = () => ({ status: 403, body: { error: 'not_enabled_for_account' } });
      wide.clearReply = () => ({ status: 200, body: { status: 'not_allowed' } });
      // The answer waits until the switch is saved on, so the test sees both states.
      let release; wide.hold = new Promise(resolve => { release = resolve; });
      await addTopic(page, '동네 도서관'); await setWide(page, true); await settled(async () => wide.requests.length, 1, 'asked once');
      release(); wide.hold = null;
      const refused = page.locator('#discoveryWideNotEnabled'); await refused.waitFor();
      assert.equal(await refused.innerText(), '이 계정에서는 넓게 찾기를 쓸 수 없어 꺼 두었습니다.'); assert.equal(await refused.getAttribute('role'), 'alert');
      // Contract 13: the setting is left off (saved), the erase is asked and `not_allowed` is an answer, not a failure.
      await until(page, async () => { const stored = (await HaedoLife.Shell.storage.readDiscoverySettings(await HaedoLife.Shell.storage.getActive())).disabledSourceIds; return stored.length === 1 && stored[0] === 'option-wide-off'; }, null, 'saved off, erase mark gone');
      assert.equal(await page.locator('#discoveryWideSearch').isChecked(), false);
      assert.equal(wide.clears.length, 1); assert.equal(await page.locator('#discoveryWideClearStatus').count(), 0, 'not_allowed is not shown as a failed erase');
      await capture(page, 'wide-not-enabled-settings-1440');
      await closeSettings(page);
      assert.equal(await page.locator('#discoveryWideNotice').innerText(), '이 계정에서는 넓게 찾기를 쓸 수 없어 꺼 두었습니다.');
      assert.equal(await cards(page).count(), 12, 'the fixed sources work as before'); assert.equal(await wideCards(page).count(), 0);
      await refreshNow(page); await nav(page, 'schedule'); await nav(page, 'news'); await idle(page); await addTopic(page, '기후 정책'); await page.waitForTimeout(400);
      assert.equal(wide.requests.length, 1, 'not asked again');
      assert.equal(await page.evaluate(() => !!HaedoAuth.user && !document.querySelector('#lifeApp').hidden), true, 'the session stays');
      // Turning it on again is a new choice: asked once more (this time the account is allowed).
      wide.reply = body => ({ status: 200, body: answer(body) });
      await setWide(page, true); await settled(async () => wide.requests.length, 2, 'on again asks once more');
      await closeSettings(page); await until(page, () => document.querySelectorAll('#discoveryList > .discovery-article[data-wide]').length > 0, null, 'links after turning on again');
      assert.equal(await page.locator('#discoveryWideNotice').count(), 0, 'the earlier refusal line is gone');
    });

    await check('503, 500, a broken connection and 401: the fixed list stays with one line; only 401 is about signing in', async ({ page, wide }) => {
      const unavailable = '넓게 찾기 · 지금 가져오지 못했습니다. 고정 출처의 글은 그대로 보입니다.';
      wide.reply = () => ({ status: 503, body: { error: 'auth_unavailable' } });
      await start(page, wide, ['동네 도서관']);
      const notice = page.locator('#discoveryWideNotice');
      assert.equal(await notice.innerText(), unavailable);
      wide.reply = () => ({ status: 503, body: { error: 'setup_required' } });
      await refreshNow(page); await settled(async () => wide.requests.length, 2, 'asked on 지금 갱신');
      assert.equal(await notice.innerText(), unavailable);
      assert.equal(await cards(page).count(), 12); assert.equal(await wideCards(page).count(), 0);
      assert.equal(await page.evaluate(() => !!HaedoAuth.user && !document.querySelector('#lifeApp').hidden), true, 'a 5xx keeps the session');
      await capture(page, 'wide-notice-unavailable-1440');
      wide.reply = () => 'abort';
      await refreshNow(page); await settled(async () => wide.requests.length, 3, 'asked on 지금 갱신');
      await until(page, () => document.querySelector('#discoveryWideNotice')?.textContent.includes('지금 가져오지 못했습니다'), null, 'network failure notice');
      assert.equal(await cards(page).count(), 12);
      wide.reply = () => ({ status: 500, body: { error: 'server_error' } });
      await refreshNow(page); await settled(async () => wide.requests.length, 4, 'asked again'); await until(page, () => document.querySelector('#discoveryWideNotice')?.textContent.includes('지금 가져오지 못했습니다'), null, '500 notice');
      assert.equal(await page.evaluate(() => !!HaedoAuth.user && !document.querySelector('#lifeApp').hidden), true, '5xx and a broken connection keep the session');
      wide.reply = () => ({ status: 401, body: { error: 'unauthorized' } });
      await refreshNow(page); await until(page, () => document.querySelector('#discoveryWideNotice')?.textContent.includes('로그인 계정을 다시 확인'), null, '401 notice');
      assert.equal(await cards(page).count(), 12);
      // A 5xx never turned the setting off; 401 neither (only 403 not_enabled_for_account does).
      assert.deepEqual(await storedOptions(page), ['option-wide-on']);
      // Back in service: the links arrive and the line goes.
      wide.reply = body => ({ status: 200, body: answer(body) });
      await refreshNow(page); await until(page, () => document.querySelectorAll('#discoveryList > .discovery-article[data-wide]').length === 4, null, 'links after recovery');
      assert.equal(await page.locator('#discoveryWideNotice').count(), 0);
    });

    await check('turning off erases the server copy and takes the links off the screen; a failed erase is tried again', async ({ page, wide }) => {
      await start(page, wide, ['동네 도서관']); assert.equal(await wideCards(page).count(), 4);
      assert.deepEqual(await storedOptions(page), ['option-wide-on']);
      wide.clearReply = () => ({ status: 500, body: { error: 'server_error' } });
      await setWide(page, false); await settled(async () => wide.clears.length, 1, 'erase asked once');
      assert.equal(wide.clears[0].raw, '{}'); assert.equal(wide.clears[0].authorization, true);
      const status = page.locator('#discoveryWideClearStatus'); await until(page, () => document.querySelector('#discoveryWideClearStatus')?.textContent.includes('아직 지우지 못했습니다'), null, 'failed erase is shown');
      assert.equal(await status.getAttribute('role'), 'status');
      assert.deepEqual((await storedOptions(page)).sort(), ['option-wide-clear', 'option-wide-off'], 'the erase stays marked in the account settings');
      await closeSettings(page); assert.equal(await wideCards(page).count(), 0, 'links leave the screen at once'); assert.equal(await page.locator('#discoveryWideNotice').count(), 0);
      assert.match(await page.locator('#discoveryDiscover').innerText(), /^전체\s*12$/);
      // Opening news again tries the erase again.
      wide.clearReply = () => ({ status: 200, body: { status: 'cleared', removed: 4 } });
      await nav(page, 'schedule'); await nav(page, 'news'); await idle(page); await settled(async () => wide.clears.length, 2, 'erase tried again on the next opening');
      await until(page, async () => !(await HaedoLife.Shell.storage.readDiscoverySettings(await HaedoLife.Shell.storage.getActive())).disabledSourceIds.includes('option-wide-clear'), null, 'mark removed after the erase');
      assert.deepEqual(await storedOptions(page), ['option-wide-off']);
      await openSettings(page); assert.equal(await page.locator('#discoveryWideClearStatus').count(), 0);
      assert.equal(wide.requests.length, 1, 'no search request after turning off');
      // The retry button after a failure in this opening.
      await setWide(page, true); await settled(async () => wide.requests.length, 2, 'on again asks');
      wide.clearReply = () => 'abort';
      await setWide(page, false); await settled(async () => wide.clears.length, 3, 'erase asked');
      await page.locator('#discoveryWideClearRetry').waitFor(); wide.clearReply = () => ({ status: 200, body: { status: 'cleared', removed: 0 } });
      await page.locator('#discoveryWideClearRetry').click(); await settled(async () => wide.clears.length, 4, 'retry asks');
      await until(page, async () => !(await HaedoLife.Shell.storage.readDiscoverySettings(await HaedoLife.Shell.storage.getActive())).disabledSourceIds.includes('option-wide-clear'), null, 'mark removed after retry');
    });

    await check('one request at a time; an answer that arrives after turning off or signing out is not used; nothing is kept outside the account', async ({ page, wide, context }) => {
      let release; wide.hold = new Promise(resolve => { release = resolve; });
      await addTopic(page, '동네 도서관'); await setWide(page, true); await settled(async () => wide.requests.length, 1, 'asked');
      await closeSettings(page);
      assert.equal(await page.locator('#discoveryWideNotice').innerText(), '넓게 찾는 중');
      await refreshNow(page); await refreshNow(page); await page.waitForTimeout(300);
      assert.equal(wide.requests.length, 1, 'no second request while one is in progress');
      // Turned off while waiting: the late answer is dropped.
      await setWide(page, false); release(); wide.hold = null; await page.waitForTimeout(500); await closeSettings(page);
      assert.equal(await wideCards(page).count(), 0, 'a late answer after turning off is not drawn');
      assert.equal(wide.requests.length, 1);
      // On again, drawn; then the same tab reopened soon does not ask again, 지금 갱신 does.
      await setWide(page, true); await settled(async () => wide.requests.length, 2, 'asked after turning on'); await closeSettings(page);
      await until(page, () => document.querySelectorAll('#discoveryList > .discovery-article[data-wide]').length === 4, null, 'links drawn');
      await nav(page, 'schedule'); await nav(page, 'news'); await idle(page); await page.waitForTimeout(400);
      assert.equal(wide.requests.length, 2, 'reopening the tab soon reuses the answer'); assert.equal(await wideCards(page).count(), 4);
      await refreshNow(page); await settled(async () => wide.requests.length, 3, '지금 갱신 asks');
      // Not in storage any other account or the public shell could read.
      const kept = await page.evaluate(async () => {
        const words = ['넓게 합성', 'news.google.com/rss/articles'], hit = text => words.some(word => String(text).includes(word));
        const local = Object.entries(localStorage).filter(([key, value]) => hit(key) || hit(value)).map(([key]) => key), session = Object.entries(sessionStorage).filter(([key, value]) => hit(key) || hit(value)).map(([key]) => key);
        const cached = []; for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) if (hit(request.url)) cached.push(request.url);
        return { local, session, cached };
      });
      assert.deepEqual(kept, { local: [], session: [], cached: [] });
      // Signing out with an answer on the way: the next document shows none of it.
      let release2; wide.hold = new Promise(resolve => { release2 = resolve; });
      await refreshNow(page).catch(() => {}); await settled(async () => wide.requests.length, 4, 'asked before signing out');
      await page.evaluate(() => { window.__signedOut = HaedoAuth.signOut().catch(() => null); });
      await page.waitForFunction(() => !globalThis.HaedoAuth?.user, null, { timeout: 15000 }).catch(() => {});
      release2(); wide.hold = null; await page.waitForTimeout(600);
      assert.equal(await page.locator('#discoveryList > .discovery-article[data-wide]').count(), 0, 'no found link after signing out');
      assert.equal(await page.evaluate(() => document.body.innerText.includes('넓게 합성')), false);
      assert.equal(context.pages().length, 1);
    });

    await check('the 15-minute refresh of the catalog does not ask 넓게 찾기', async ({ page, wide, state }) => {
      await start(page, wide, ['동네 도서관']);
      await page.clock.install({ time: new Date() });
      await page.locator('#discoveryNewsSettings').click();
      if (!await page.locator('#discoveryOptions').evaluate(node => node.open)) await page.locator('#discoveryOptions > summary').click();
      await page.locator('#discoveryAutoRefresh').setChecked(true); await idle(page);
      await until(page, async () => (await HaedoLife.Shell.storage.readDiscoverySettings(await HaedoLife.Shell.storage.getActive())).autoRefresh === true, null, 'auto refresh saved');
      await closeSettings(page);
      const catalogBefore = state.catalogRequests, wideBefore = wide.requests.length;
      for (let round = 0; round < 3; round++) { await page.clock.fastForward(15 * 60000 + 2000); await page.waitForTimeout(150); await idle(page); }
      assert(state.catalogRequests >= catalogBefore + 2, 'the catalog was refreshed on the timer: ' + (state.catalogRequests - catalogBefore));
      assert.equal(wide.requests.length, wideBefore, 'the timer never asks 넓게 찾기');
      assert.equal(await wideCards(page).count(), 4, 'the links stay through the catalog refresh');
    });

    await check('담기 keeps a link only; 관련 없음·읽음 use the shared list; 자료에 보관 makes a link-only item', async ({ page, wide }) => {
      await start(page, wide, ['동네 도서관']);
      const first = wideCards(page).nth(0), id = await first.getAttribute('data-discovery-id'), title = await first.locator('.discovery-title').innerText(), href = await first.locator('a.discovery-row-open').getAttribute('href');
      await first.locator('[data-discovery-reaction=bookmarked]').click(); await idle(page);
      const entry = await page.evaluate(async id => (await HaedoLife.Shell.storage.readDiscoveryActions(await HaedoLife.Shell.storage.getActive())).entries.find(entry => entry.snapshot.id === id), id);
      assert.equal(entry.bookmarked, true); assert.equal(entry.liked, false);
      assert.deepEqual(Object.keys(entry.snapshot).sort(), ['author', 'canonicalUrl', 'coverage', 'fetchedAt', 'id', 'language', 'publishedAt', 'rights', 'sourceId', 'sourceName', 'tags', 'title', 'updatedAt', 'url']);
      assert.equal(entry.snapshot.sourceId, 'google-news'); assert.equal(entry.snapshot.url, href); assert.equal(entry.snapshot.title, title); assert.match(entry.snapshot.sourceName, /^합성매체 \d$/);
      assert.equal(entry.snapshot.coverage, 'link_only'); assert.equal(entry.snapshot.rights.mode, 'metadata_only'); assert.deepEqual(entry.snapshot.tags, []); assert.match(entry.snapshot.fetchedAt, /^\d{4}-/);
      // The saved tab shows it as the same new-tab link; no 추천에 사용하지 않기 (a found link is never a recommendation basis).
      await page.locator('#discoveryBookmarked').click(); await frames(page);
      const saved = cards(page).first(); assert.equal(await saved.getAttribute('data-wide'), 'true'); assert.equal(await saved.locator('a.discovery-row-open').getAttribute('target'), '_blank');
      await saved.locator('.discovery-card-more > summary').click(); await frames(page);
      assert.equal(await saved.locator('[data-discovery-exclude-personal]').count(), 0); assert.equal(await saved.locator('[data-discovery-forget]').count(), 1);
      await page.keyboard.press('Escape'); await page.locator('#discoveryDiscover').click(); await frames(page);
      // 관련 없음: leaves the list, one row in the shared feedback list, shown under 제외한 글 as a new-tab link.
      const second = wideCards(page).nth(1), secondId = await second.getAttribute('data-discovery-id'), order = await cards(page).evaluateAll(nodes => nodes.map(node => node.dataset.discoveryId));
      await second.locator('.discovery-card-more > summary').click(); await second.locator('[data-discovery-feedback=not_relevant]').click(); await idle(page); await frames(page);
      assert.deepEqual(await cards(page).evaluateAll(nodes => nodes.map(node => node.dataset.discoveryId)), order.filter(value => value !== secondId), 'the other cards keep their places');
      const rows = await page.evaluate(async () => (await HaedoLife.Shell.storage.readDiscoveryProfile(await HaedoLife.Shell.storage.getActive())).feedback);
      assert.deepEqual(rows.map(row => [row.articleId, row.kind, row.canonicalUrl.startsWith('https://news.google.com/'), Object.keys(row).sort().join()]), [[secondId, 'not_relevant', true, 'articleId,canonicalUrl,kind,updatedAt']]);
      const third = wideCards(page).nth(1), thirdId = await third.getAttribute('data-discovery-id');
      await third.locator('.discovery-card-more > summary').click(); await third.locator('[data-discovery-feedback=already_read]').click(); await idle(page); await frames(page);
      assert.equal(await page.locator('#discoveryList [data-discovery-id="' + thirdId + '"]').count(), 0);
      await page.locator('#discoveryExcluded').click(); await frames(page);
      assert.equal(await cards(page).count(), 2); assert.equal(await cards(page).first().locator('a.discovery-row-open[target=_blank]').count(), 1); assert.equal(await cards(page).first().locator('[data-discovery-select]').count(), 0);
      // The answer still holds them; they stay out of 전체 after another refresh.
      await page.locator('#discoveryDiscover').click(); await refreshNow(page); await settled(async () => wide.requests.length, 2, 'asked'); await page.waitForTimeout(300);
      assert.equal(await page.locator('#discoveryList [data-discovery-id="' + secondId + '"], #discoveryList [data-discovery-id="' + thirdId + '"]').count(), 0);
      // 자료에 보관: a link-only item (title and the supplier address), nothing else of the answer.
      const last = wideCards(page).last(), lastTitle = await last.locator('.discovery-title').innerText(), lastHref = await last.locator('a.discovery-row-open').getAttribute('href');
      await last.locator('.discovery-card-more > summary').click(); const keep = last.locator('[data-discovery-import]'); assert.equal(await keep.innerText(), '링크를 자료에 보관'); await keep.click();
      await page.locator('#lifeImportTitle').waitFor();
      assert.equal(await page.locator('#lifeImportTitle').inputValue(), lastTitle); assert.equal(await page.locator('#lifeImportUrl').inputValue(), lastHref);
    });

    await check('a list looked at keeps every drawn card: a late 넓게 찾기 answer joins after them; 새 글 n건 puts it in place', async ({ page, wide, state }) => {
      wide.reply = body => { const base = answer(body, { per: 0 }); base.items = Array.from({ length: 12 }, (_, i) => item(body.topics[0], 'ko', i, { sourceName: '넓은 매체 ' + i, publishedAt: new Date(Date.now() - (i + 2) * 60000).toISOString() }));
        base.topics = [{ topic: body.topics[0], language: 'ko', status: 'fresh', fetchedAt: base.fetchedAt, count: 12 }]; return { status: 200, body: base }; };
      state.catalog = skewed(80); await page.reload(); await ready(page); await nav(page, 'news'); await idle(page);
      await addTopic(page, '합성 주제');
      let release; wide.hold = new Promise(resolve => { release = resolve; });
      await setWide(page, true); await settled(async () => wide.requests.length, 1, 'asked');
      await closeSettings(page); await page.locator('#discoveryShowMore').click(); await frames(page);
      const before = await shownIds(page); assert.equal(before.length, 40);
      release(); wide.hold = null;
      await page.locator('#discoveryNewArticles').waitFor(); await frames(page);
      assert.match(await page.locator('#discoveryNewArticles').innerText(), /새 글 12건/);
      assert.deepEqual(await shownIds(page), before, 'the 40 cards looked at keep their order and places');
      // To the end: the links joined right after the drawn cards, every row exactly once.
      while (await page.locator('#discoveryShowMore').count()) { await page.locator('#discoveryShowMore').click(); await frames(page); }
      const all = await shownIds(page), wideAt = await cards(page).evaluateAll(nodes => nodes.map((node, index) => node.dataset.wide === 'true' ? index : -1).filter(index => index >= 0));
      assert.deepEqual(all.slice(0, 40), before); assert.equal(all.length, 92); assert.equal(new Set(all).size, 92, 'no card twice');
      assert.equal(wideAt.length, 12); assert.ok(wideAt[0] >= 40 && wideAt[0] < 60, 'the links start on the next page: ' + wideAt[0]);
      // 새 글 n건 is a refresh the person asks for: the order is computed again and the newest links come first.
      await page.locator('#discoveryNewArticles').click(); await idle(page); await frames(page);
      assert.equal(await page.locator('#discoveryNewArticles').count(), 0);
      const first = await cards(page).evaluateAll(nodes => nodes.map(node => node.dataset.wide === 'true'));
      assert.equal(first.length, 20); assert.ok(first.slice(0, 3).every(Boolean), 'the newest links lead the recomputed first page');
    });
    await check('a list looked at keeps every drawn card through the 15-minute refresh; the new articles join after them', async ({ page, wide, state }) => {
      state.catalog = skewed(80); await page.reload(); await ready(page); await nav(page, 'news'); await idle(page);
      await page.clock.install({ time: new Date() });
      await page.locator('#discoveryNewsSettings').click();
      if (!await page.locator('#discoveryOptions').evaluate(node => node.open)) await page.locator('#discoveryOptions > summary').click();
      await page.locator('#discoveryAutoRefresh').setChecked(true); await idle(page);
      await until(page, async () => (await HaedoLife.Shell.storage.readDiscoverySettings(await HaedoLife.Shell.storage.getActive())).autoRefresh === true, null, 'auto refresh saved');
      await closeSettings(page); await page.locator('#discoveryShowMore').click(); await frames(page);
      const before = await shownIds(page), requests = state.catalogRequests; assert.equal(before.length, 40);
      state.catalog = skewed(80, 6);
      await page.clock.fastForward(15 * 60000 + 2000); await settled(async () => state.catalogRequests > requests, true, 'timed refresh'); await idle(page); await frames(page);
      await page.locator('#discoveryNewArticles').waitFor(); assert.match(await page.locator('#discoveryNewArticles').innerText(), /새 글 6건/);
      assert.deepEqual(await shownIds(page), before, 'the 40 cards looked at keep their order and places');
      while (await page.locator('#discoveryShowMore').count()) { await page.locator('#discoveryShowMore').click(); await frames(page); }
      const all = await shownIds(page), fresh = all.map((id, index) => id.startsWith('n-') ? index : -1).filter(index => index >= 0);
      assert.equal(all.length, 86); assert.equal(new Set(all).size, 86); assert.equal(fresh.length, 6); assert.ok(fresh[0] >= 40 && fresh[0] < 60, 'new articles start on the next page: ' + fresh[0]);
      assert.equal(wide.requests.length, 0);
    });

    // Re-review MAJOR-B: a list the person has not used yet takes a late answer in its order; once used, it keeps its cards.
    const twelve = body => { const base = answer(body, { per: 0 }); base.items = Array.from({ length: 12 }, (_, i) => item(body.topics[0], 'ko', i, { sourceName: '넓은 매체 ' + i, publishedAt: new Date(Date.now() - (i + 2) * 60000).toISOString() }));
      base.topics = [{ topic: body.topics[0], language: 'ko', status: 'fresh', fetchedAt: base.fetchedAt, count: 12 }]; return { status: 200, body: base }; };
    for (const delay of [1500, 0]) await check('news opened again with 넓게 찾기 on: an answer ' + (delay ? 'after ' + delay + 'ms' : 'at once') + ' takes its place on the first page', async ({ page, wide, state }) => {
      wide.reply = twelve; state.catalog = skewed(80); await page.reload(); await ready(page); await nav(page, 'news'); await idle(page);
      await start(page, wide, ['합성 주제']);
      let release; wide.hold = new Promise(resolve => { release = resolve; }); setTimeout(() => { release(); wide.hold = null; }, delay);
      await page.reload(); await ready(page); await nav(page, 'news'); await idle(page);
      await until(page, () => document.querySelectorAll('#discoveryList > .discovery-article[data-wide]').length > 0, null, 'found links drawn'); await frames(page);
      const first = await cards(page).evaluateAll(nodes => nodes.slice(0, 20).map(node => node.dataset.wide === 'true'));
      assert.ok(first.filter(Boolean).length >= 3, 'found links on the first page: ' + first.filter(Boolean).length);
      assert.ok(first.slice(0, 3).every(Boolean), 'the newest links lead it');
      assert.equal(await page.locator('#discoveryNewArticles').count(), 0, 'nothing to announce: the list took them');
      assert.equal(await page.evaluate(() => scrollY), 0, 'the page did not move');
    });
    await check('news opened again with 넓게 찾기 on: once the list is scrolled, a late answer joins after the drawn cards', async ({ page, wide, state }) => {
      wide.reply = twelve; state.catalog = skewed(80); await page.reload(); await ready(page); await nav(page, 'news'); await idle(page);
      await start(page, wide, ['합성 주제']);
      let release; wide.hold = new Promise(resolve => { release = resolve; });
      await page.reload(); await ready(page); await nav(page, 'news'); await idle(page); await frames(page);
      const before = await shownIds(page); assert.equal(before.length, 20);
      const box = await page.locator('#discoveryList').boundingBox(); await page.mouse.move(box.x + 40, box.y + 40); await page.mouse.wheel(0, 300); await frames(page);
      release(); wide.hold = null;
      await page.locator('#discoveryNewArticles').waitFor(); await frames(page);
      assert.match(await page.locator('#discoveryNewArticles').innerText(), /새 글 12건/);
      assert.deepEqual(await shownIds(page), before, 'the cards already drawn keep their places');
    });
    await check('a topic the server refuses (safety net) leaves the taken topics\' answer in place: no request beyond one per topic', async ({ page, wide }) => {
      for (const topic of ['주제 하나', '서버만 거절', '주제 둘']) await addTopic(page, topic);
      await setWide(page, true); await settled(async () => wide.requests.length, 4, 'one request, then one per topic');
      await page.waitForTimeout(500); assert.equal(wide.requests.length, 4, 'the answer already covers the topics taken');
      await closeSettings(page); await until(page, () => document.querySelectorAll('#discoveryList > .discovery-article[data-wide]').length > 0, null, 'links drawn');
      const links = await wideCards(page).count();
      await nav(page, 'schedule'); await nav(page, 'news'); await idle(page); await page.waitForTimeout(500);
      assert.equal(wide.requests.length, 4, 'reopening the tab reuses the answer'); assert.equal(await wideCards(page).count(), links, 'the links stay');
    });

    for (const width of [820, 390]) await check('found links at ' + width + 'px: full-width text cards, 44px targets, no overflow', async ({ page, wide }) => {
      await start(page, wide, ['동네 도서관']);
      const card = wideCards(page).first(), box = await card.boundingBox(), pane = await page.locator('#discoveryListPane').boundingBox();
      assert(Math.abs(box.width - pane.width) <= 1, 'the card uses the pane width');
      for (const control of [card.locator('a.discovery-row-open'), card.locator('[data-discovery-reaction=bookmarked]'), card.locator('.discovery-card-more > summary')]) assert((await control.boundingBox()).height >= 44);
      assert.equal(await overflow(page), false);
      await capture(page, 'wide-on-' + width);
      await openSettings(page); await page.locator('#discoveryWideSearch').scrollIntoViewIfNeeded(); await capture(page, 'wide-settings-' + width);
    }, { width });
    await check('found links at 1440px (capture)', async ({ page, wide }) => { await start(page, wide, ['동네 도서관', '기후 정책']); await capture(page, 'wide-on-1440'); });
  } finally {
    await browser.close();
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
  const failed = report.checks.filter(check => !check.pass);
  console.log(JSON.stringify({ checks: report.checks.length, failed: failed.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length }));
  // 4xx/5xx answers of the stand-in are logged by the browser as failed resources; they are the point of those checks.
  const unexpectedConsole = report.consoleErrors.filter(row => !/Failed to load resource/.test(row.text));
  if (failed.length || unexpectedConsole.length || report.pageErrors.length || report.external.length) { console.error(JSON.stringify({ unexpectedConsole, pageErrors: report.pageErrors, external: report.external }, null, 2)); process.exitCode = 1; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

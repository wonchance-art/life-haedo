/* 2026-11-11 뉴스 2단계 넓게 찾기: 화면 쪽 요청·응답 규칙(서버 계약 news/wide-server 5a9466c 「클라이언트가 지킬 계약」).
 * 가짜 Auth와 가짜 응답만 쓴다. 실제 서버·Google 뉴스·매체에 접속하지 않는다. 주제·제목·매체 이름은 모두 지어낸 값이다. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Wide = require('../assets/life/discovery-wide-remote.js');
const Discovery = require('../assets/life/discovery.js');
const Settings = require('../assets/life/discovery-settings.js');

const NOW = Date.parse('2026-11-11T13:00:00.000Z');
const userId = '11111111-1111-4111-8111-111111111111', projectUrl = 'https://synthetic.supabase.co', workspaceId = 'synthetic-wide';
const id = n => n.toString(16).padStart(32, '0');
const item = (n, change = {}) => ({ id: id(n), title: '합성 넓게 ' + n, link: 'https://news.google.com/rss/articles/SYN' + n + '?oc=5', publishedAt: '2026-11-11T12:0' + (n % 10) + ':00.000Z',
  sourceName: '합성매체', sourceUrl: 'https://www.synthetic-daily.example/', topic: '합성 주제', language: 'ko', ...change });
const answer = (items = [item(1)], change = {}) => ({ supplier: 'google-news-rss', items, fetchedAt: '2026-11-11T12:50:00.000Z', stale: false,
  topics: [{ topic: '합성 주제', language: 'ko', status: 'fresh', fetchedAt: '2026-11-11T12:50:00.000Z', count: items.length }], ...change });
const response = (data, init = {}) => new Response(typeof data === 'string' ? data : JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, ...init });
function harness(fetcher = async () => response(answer())) {
  const listeners = new Set(), owner = { userId, projectUrl };
  const auth = { config: { url: projectUrl, key: 'sb_publishable_synthetic_wide_key' }, user: { id: userId }, epoch: 1,
    getAccount: () => owner, verify: async () => ({ id: userId }), onAccountChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    client: { auth: { getSession: async () => ({ data: { session: { user: { id: userId }, access_token: 'synthetic-user-token' } }, error: null }) } } };
  let current = true;
  const remote = Wide.create({ auth, storage: { isAccountScoped: true, account: { ...owner } }, fetcher, isCurrent: () => current });
  return { auth, listeners, remote, leave() { current = false; },
    switchAccount() { owner.userId = '22222222-2222-4222-8222-222222222222'; auth.user.id = owner.userId; auth.epoch++; for (const fn of listeners) fn(); } };
}
const fails = async (promise, code) => assert.rejects(promise, error => error.code === code);

test('plan: only the typed topics, in their order, the first eight; the characters are the server\'s to judge', () => {
  const typed = ['동네 도서관', '  기후   정책 ', 'site:example.com', '동네 도서관', 'CLIMATE', 'climate', '', '가'.repeat(41), '10%', 'Portland OR', 'K-pop', 'C++', 'R&D', '왜?'];
  const { topics, rows } = Wide.plan(typed.map((label, index) => ({ id: 'interest-' + index, label })));
  assert.deepEqual(topics, ['동네 도서관', '기후 정책', 'site:example.com', 'CLIMATE', '10%', 'Portland OR', 'K-pop', 'C++']);
  assert.deepEqual(rows.filter(row => !row.sent).map(row => [row.label, row.reason]), [['동네 도서관', 'duplicate'], ['climate', 'duplicate'], ['', 'empty'], ['가'.repeat(41), 'too_long'], ['R&D', 'over_limit'], ['왜?', 'over_limit']]);
  assert.equal(rows.length, typed.length, 'every typed topic has a row');
  for (const reason of new Set(rows.filter(row => !row.sent).map(row => row.reason))) assert.ok(Wide.REASONS[reason].length > 5, 'reason in words: ' + reason);
  // A topic the server refused is not sent again and makes room for the next typed one.
  const again = Wide.plan(typed.map((label, index) => ({ id: 'interest-' + index, label })), { refused: new Set(['site:example.com']) });
  assert.deepEqual(again.topics, ['동네 도서관', '기후 정책', 'CLIMATE', '10%', 'Portland OR', 'K-pop', 'C++', 'R&D']);
  assert.equal(again.rows.find(row => row.label === 'site:example.com').reason, 'refused');
  // Nothing but { id, label } rows can be given; a liked article or a profile object is refused.
  for (const bad of [null, 'topics', [{ id: 'x' }], [{ id: 'x', label: 1 }]]) assert.throws(() => Wide.plan(bad), { code: 'wide_invalid' });
  assert.deepEqual(Wide.plan([]), { topics: [], rows: [] });
});

test('the typed topics come from the news settings only: likes and saved articles are never topics', () => {
  // The screen builds the plan from effectiveProfile(...).manual, the topics typed in news settings and left checked.
  const profile = { workspaceId: 'synthetic-wide', manual: [{ id: 'interest-a', label: '동네 도서관', aliases: [] }, { id: 'interest-b', label: '기후 정책', aliases: [] }], inferred: [{ id: 'auto-1', label: '자동 추출 낱말' }], liked: ['좋아요 제목'] };
  const settings = Settings.update(Settings.empty('synthetic-wide'), { disabledInterestIds: ['interest-b'], wideSearch: true }, { expectedRevision: 0, now: '2026-11-11T12:00:00.000Z' });
  const manual = Settings.effectiveProfile(profile, settings).manual.map(({ id, label }) => ({ id, label }));
  assert.deepEqual(Wide.plan(manual).topics, ['동네 도서관']);
  assert.deepEqual(Wide.plan(Settings.effectiveProfile({ workspaceId: 'synthetic-wide', manual: [] }, settings).manual).topics, []);
});

test('languages follow the content-language setting; only Korean and English editions exist', () => {
  assert.deepEqual(Wide.languages(null), ['ko', 'en']); assert.deepEqual(Wide.languages(['en', 'ja']), ['en']); assert.deepEqual(Wide.languages(['ja']), []);
  assert.deepEqual(Wide.languages(['ko', 'en']), ['ko', 'en']); assert.throws(() => Wide.languages('ko'));
});

test('the answer is read strictly: unknown fields ignored, malformed or off-host items dropped, text stays text', () => {
  const hostile = [
    item(1, { title: '<script>alert(1)</script> & 합성', sourceName: '<b>매체</b>', sourceUrl: "https://www.synthetic-daily.example/a'b", extra: '<i>모르는 필드</i>' }),
    item(2, { link: 'javascript:alert(1)' }), item(3, { link: 'https://news.google.com.evil.example/rss/articles/x' }), item(4, { link: 'http://news.google.com/rss/articles/x' }),
    item(5, { link: 'https://user@news.google.com/rss/articles/x' }), item(6, { link: 'https://news.google.com:8443/rss/articles/x' }), item(7, { link: 'https://evil.example/?u=https://news.google.com/' }),
    item(8, { title: '가'.repeat(501) }), item(9, { sourceName: '나'.repeat(201) }), item(10, { id: 'NOT-HEX' }), item(11, { title: '   ' }), item(12, { publishedAt: 'yesterday' }), item(13, { language: 'ja' }),
    item(14, { sourceUrl: 'javascript:alert(1)' }), item(15, { sourceUrl: 'http://plain.example/' }), item(16, { publishedAt: '2026-11-12T13:00:00.000Z' }), item(17, { sourceName: null, publishedAt: null }),
    item(1, { title: '같은 id' }), null, 'text', [], item(18, { title: '줄\u0000바꿈' })
  ];
  const result = Wide.validate({ ...answer(hostile), html: '<script>', next: 'https://evil.example/' }, { now: NOW });
  assert.deepEqual(result.items.map(row => row.id), [id(1), id(14), id(15), id(16), id(17)]);
  assert.equal(result.dropped, hostile.length - 5);
  const first = result.items[0];
  assert.deepEqual(Object.keys(first).sort(), ['id', 'language', 'link', 'publishedAt', 'sourceName', 'sourceUrl', 'title', 'topic']);
  assert.equal(first.title, '<script>alert(1)</script> & 합성'); assert.equal(first.sourceName, '<b>매체</b>'); assert.equal(first.sourceUrl, "https://www.synthetic-daily.example/a'b");
  assert.equal(result.items[1].sourceUrl, null, 'a script address is not kept'); assert.equal(result.items[2].sourceUrl, null, 'http is not kept');
  assert.equal(result.items[3].publishedAt, null, 'a time a day ahead is not shown as a time');
  assert.equal(result.items[4].sourceName, null);
  assert.equal(Object.hasOwn(result, 'html'), false); assert.equal(Object.hasOwn(result, 'next'), false);
  // Over 200 items: the rest are dropped.
  assert.equal(Wide.validate(answer(Array.from({ length: 230 }, (_, n) => item(n + 1))), { now: NOW }).items.length, 200);
  // Topic rows: known statuses only.
  const rows = Wide.validate(answer([item(1)], { topics: [{ topic: '합성', language: 'ko', status: 'limited', fetchedAt: null, count: 0, reason: 'hourly_limit' }, { topic: '합성', language: 'ko', status: 'boom', fetchedAt: null, count: 0 }, { topic: '합성', language: 'en', status: 'stale', fetchedAt: null, count: -1 }] }), { now: NOW }).topics;
  assert.deepEqual(rows, [{ topic: '합성', language: 'ko', status: 'limited', fetchedAt: null, count: 0, reason: 'hourly_limit' }]);
  for (const bad of [null, [], { ...answer(), supplier: 'someone-else' }, { ...answer(), items: 'x' }, { ...answer(), stale: 'no' }, { ...answer(), fetchedAt: 'now' }]) assert.throws(() => Wide.validate(bad, { now: NOW }), { code: 'wide_invalid' });
});

test('a found link becomes a link-only article on the supplier host that the saved-reaction model accepts', () => {
  const [found] = Wide.validate(answer([item(1, { title: "따옴표 ' 와 <꺾쇠>" })]), { now: NOW }).items;
  const article = Wide.toArticle(found, { sourceId: Discovery.WIDE_SOURCE.id, canonicalUrl: Discovery.canonicalUrl, fetchedAt: '2026-11-11T12:50:00.000Z' });
  assert.equal(article.coverage, 'link_only'); assert.equal(article.summary, ''); assert.equal(article.rights.mode, 'metadata_only'); assert.deepEqual(article.tags, []);
  assert.equal(new URL(article.canonicalUrl).hostname, 'news.google.com'); assert.equal(article.wide.topic, '합성 주제');
  const Actions = require('../assets/life/discovery-actions.js');
  const snapshot = Actions.capture(article, { id: article.sourceId, name: article.sourceName, rights: article.rights });
  assert.equal(snapshot.url, found.link); assert.equal(snapshot.title, "따옴표 ' 와 <꺾쇠>");
  assert.deepEqual(Object.keys(snapshot).sort(), ['author', 'canonicalUrl', 'coverage', 'fetchedAt', 'id', 'language', 'publishedAt', 'rights', 'sourceId', 'sourceName', 'tags', 'title', 'updatedAt', 'url']);
  for (const value of ['https://news.google.com.evil.example/', 'http://news.google.com/x', 'javascript:alert(1)', 'https://news.google.com/\u0000', 42]) assert.equal(Wide.link(value), null);
  assert.equal(Wide.link('https://news.google.com/rss/articles/SYN?oc=5'), 'https://news.google.com/rss/articles/SYN?oc=5');
});

test('the request is exactly the topics and the languages, with the session; nothing else leaves', async () => {
  const calls = [], h = harness(async (address, options) => { calls.push({ address, options }); return response(answer()); });
  const result = await h.remote.load({ topics: ['동네 도서관', '기후 정책'], languages: ['ko', 'en'], workspaceId });
  assert.equal(result.items.length, 1);
  assert.equal(calls.length, 1); const request = calls[0];
  assert.equal(request.address, projectUrl + '/functions/v1/haedo-news-wide');
  assert.equal(request.options.body, '{"topics":["동네 도서관","기후 정책"],"languages":["ko","en"]}');
  assert.equal(request.options.method, 'POST'); assert.equal(request.options.headers.Authorization, 'Bearer synthetic-user-token'); assert.equal(request.options.headers.apikey, 'sb_publishable_synthetic_wide_key');
  assert.deepEqual(Object.keys(request.options.headers).sort(), ['Accept', 'Authorization', 'Content-Type', 'apikey']);
  assert.equal(request.options.credentials, 'omit'); assert.equal(request.options.cache, 'no-store'); assert.equal(request.options.redirect, 'error'); assert.equal(request.options.referrerPolicy, 'no-referrer');
  assert(!request.options.body.includes(workspaceId) && !request.options.body.includes(userId));
  // Topics and languages outside the request shape never leave.
  await fails(h.remote.load({ topics: [], languages: ['ko'], workspaceId }), 'wide_invalid_topic');
  await fails(h.remote.load({ topics: Array.from({ length: 9 }, (_, n) => '주제 ' + n), languages: ['ko'], workspaceId }), 'wide_invalid_topic');
  await fails(h.remote.load({ topics: [' 공백 '], languages: ['ko'], workspaceId }), 'wide_invalid_topic');
  await fails(h.remote.load({ topics: ['합성'], languages: ['ja'], workspaceId }), 'wide_refused');
  await fails(h.remote.load({ topics: ['합성'], languages: ['ko', 'ko'], workspaceId }), 'wide_refused');
  assert.equal(calls.length, 1);
  h.remote.dispose(); assert.equal(h.listeners.size, 0);
});

test('errors: only 401 is a sign-in problem; 403 for this account, refused topics and 5xx are told apart', async () => {
  const cases = [
    [401, { error: 'unauthorized' }, 'wide_auth'], [403, { error: 'not_enabled_for_account' }, 'wide_not_enabled'], [403, { error: 'origin_not_allowed' }, 'wide_refused'],
    [400, { error: 'invalid_topic' }, 'wide_invalid_topic'], [400, { error: 'invalid_request' }, 'wide_refused'], [403, 'not json', 'wide_refused'],
    [503, { error: 'auth_unavailable' }, 'wide_unavailable'], [503, { error: 'setup_required' }, 'wide_unavailable'], [500, { error: 'server_error' }, 'wide_unavailable'], [502, '<html>', 'wide_unavailable']
  ];
  for (const [status, body, code] of cases) {
    const h = harness(async () => response(body, { status }));
    await fails(h.remote.load({ topics: ['합성'], languages: ['ko'], workspaceId }), code);
  }
  await fails(harness(async () => { throw new TypeError('Failed to fetch'); }).remote.load({ topics: ['합성'], languages: ['ko'], workspaceId }), 'wide_unavailable');
  await fails(harness(async () => response('{"supplier":', {})).remote.load({ topics: ['합성'], languages: ['ko'], workspaceId }), 'wide_invalid');
  await fails(harness(async () => response(answer(), { headers: { 'content-type': 'text/html' } })).remote.load({ topics: ['합성'], languages: ['ko'], workspaceId }), 'wide_invalid');
  // Messages for the screen are words, never the server's text.
  assert.equal(Wide.messages.wide_not_enabled, '이 계정에서는 넓게 찾기를 쓸 수 없습니다.');
});

test('an answer that arrives after the account changed or the screen left is not used', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const h = harness(async () => { await gate; return response(answer()); });
  const pending = h.remote.load({ topics: ['합성'], languages: ['ko'], workspaceId });
  await new Promise(resolve => setImmediate(resolve));
  h.switchAccount(); release();
  await fails(pending, 'wide_cancelled');
  let release2; const gate2 = new Promise(resolve => { release2 = resolve; });
  const h2 = harness(async () => { await gate2; return response(answer()); });
  const pending2 = h2.remote.load({ topics: ['합성'], languages: ['ko'], workspaceId });
  await new Promise(resolve => setImmediate(resolve)); h2.leave(); release2();
  await fails(pending2, 'wide_cancelled');
  const controller = new AbortController(), h3 = harness(async (_, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
  const pending3 = h3.remote.load({ topics: ['합성'], languages: ['ko'], workspaceId, signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  await fails(pending3, 'wide_cancelled');
});

test('erasing the server copy: an empty body; `not_allowed` is an answer, not a failure', async () => {
  const calls = [], h = harness(async (address, options) => { calls.push({ address, options }); return response(calls.length === 1 ? { status: 'cleared', removed: 3 } : { status: 'not_allowed' }); });
  assert.deepEqual(await h.remote.clear({ workspaceId }), { status: 'cleared', removed: 3 });
  assert.deepEqual(await h.remote.clear({ workspaceId }), { status: 'not_allowed', removed: 0 });
  assert.equal(calls[0].address, projectUrl + '/rest/v1/rpc/life_news_wide_clear'); assert.equal(calls[0].options.body, '{}');
  await fails(harness(async () => response({ status: 'done' })).remote.clear({ workspaceId }), 'wide_invalid');
  await fails(harness(async () => response({ message: 'x' }, { status: 500 })).remote.clear({ workspaceId }), 'wide_unavailable');
});

test('넓게 찾기 and its pending erase are account options in the reserved form an earlier settings model keeps', () => {
  const base = Settings.empty('synthetic-wide'), at = '2026-11-11T12:00:00.000Z';
  assert.equal(Settings.DEFAULT_WIDE_SEARCH, false); assert.equal(Settings.wideSearch(base), false); assert.equal(Settings.wideClear(base), false);
  const on = Settings.update(base, { wideSearch: true }, { expectedRevision: 0, now: at });
  assert.deepEqual(on.disabledSourceIds, ['option-wide-on']);
  const off = Settings.update(on, { wideSearch: false, wideClear: true }, { expectedRevision: on.revision, now: at });
  assert.deepEqual(off.disabledSourceIds, ['option-wide-off', 'option-wide-clear']); assert.equal(Settings.wideClear(off), true);
  const erased = Settings.update(off, { wideClear: false }, { expectedRevision: off.revision, now: at });
  assert.deepEqual(erased.disabledSourceIds, ['option-wide-off']); assert.equal(Settings.wideClear(erased), false);
  // A source switched off keeps the options where they are.
  const source = Settings.update(off, { disabledSourceIds: ['seoul-culture'] }, { expectedRevision: off.revision, now: at });
  assert.deepEqual([...source.disabledSourceIds].sort(), ['option-wide-clear', 'option-wide-off', 'seoul-culture']);
  assert.deepEqual(Settings.disabledSources(source), ['seoul-culture']);
  for (const id of Object.keys(Discovery.ALLOWED_SOURCES)) assert.equal(id.startsWith('option-'), false);
});

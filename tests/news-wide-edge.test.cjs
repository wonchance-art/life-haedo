// haedo-news-wide: request validation, the supplier adapter contract, the one
// outside request, feed parsing and item normalization. No network: the
// supplier is replaced by tests/fixtures/news-wide (synthetic feeds in the
// layout of a 2026-11-11 answer for the general words "기후" / "climate").
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DIR = path.join(__dirname, '../supabase/functions/haedo-news-wide');
const FIXTURES = path.join(__dirname, 'fixtures/news-wide');
const modules = Promise.all([
  import('../supabase/functions/haedo-news-wide/topics.mjs'),
  import('../supabase/functions/haedo-news-wide/upstream.mjs'),
  import('../supabase/functions/haedo-news-wide/items.mjs'),
  import('../supabase/functions/haedo-news-wide/suppliers/google-news.mjs'),
  import('../supabase/functions/haedo-rss/vendor/fast-xml-parser.mjs'),
]);
const fixture = name => fs.readFileSync(path.join(FIXTURES, name));
const NOW = Date.parse('2026-11-11T13:00:00Z');
const XML_TYPE = { 'content-type': 'application/xml; charset=utf-8' };
const code = expected => error => error?.code === expected;
const item = (fields = {}) => {
  const value = { title: '제목 - 매체', link: 'https://news.google.com/rss/articles/CBMiA?oc=5', pubDate: 'Wed, 11 Nov 2026 09:35:00 GMT',
    source: '<source url="https://outlet.example">매체</source>', ...fields };
  return '<item>' + (value.title === null ? '' : `<title>${value.title}</title>`) + (value.link === null ? '' : `<link>${value.link}</link>`) +
    (value.pubDate === null ? '' : `<pubDate>${value.pubDate}</pubDate>`) + '<description>&lt;a href="https://tracker.example/"&gt;본문&lt;/a&gt;</description>' + (value.source || '') + '</item>';
};
const rss = (items, open = '<rss version="2.0">') => `<?xml version="1.0" encoding="UTF-8"?>${open}<channel><title>"기후" - Google 뉴스</title>${items}</channel></rss>`;
async function upstream(respond, options = {}) {
  const [, up, , supplier, xml] = await modules, calls = [];
  const run = up.createUpstream({ supplier: options.supplier || supplier.googleNews, ...xml, now: () => NOW,
    fetcher: async (url, init) => { calls.push({ url, init }); return respond(url, init); } });
  return { run, calls };
}
const answer = (body, headers = XML_TYPE, status = 200) => new Response(body, { status, headers });
const parse = async xml => (await upstream(() => answer(xml))).run('기후', 'ko');

test('topics: words pass and are normalized; nothing a search service reads as an instruction passes', async () => {
  const [{ normalizeTopic }] = await modules;
  for (const topic of ['기후', 'climate change', 'K-pop', 'C++', 'C#', '.NET', 'R&D', 'AI/ML', "O'Reilly", 'O’Reilly', '3·1 운동', 'Node.js 22', '日本 経済', 'São Paulo',
    // Ordinary punctuation is not a search instruction and is sent encoded inside q.
    '10%', '10,000', '1,000원', 'Yahoo!', '왜?', '기후, 날씨', 'a,b', '50% 할인!',
    // OR, AND, NOT are operators only between two other words.
    'Oregon OR', 'Portland OR', 'OR 연산', 'OR', 'AND', 'NOT', 'NOT 기후', 'Rock AND', 'or', '기후 or 날씨', 'ORegon', 'a ORb c'])
    assert.equal(normalizeTopic(topic), topic, topic);
  assert.equal(normalizeTopic('  기후   변화\u3000정책 '), '기후 변화 정책', 'spaces collapse, including the ideographic space');
  assert.equal(normalizeTopic('기후'.normalize('NFD')), '기후', 'NFC');
  assert.equal(normalizeTopic('𠀀'.repeat(40)), '𠀀'.repeat(40), '40 code points, not UTF-16 units');
  const refused = {
    'over 40 code points': ['𠀀'.repeat(41), '가'.repeat(41)],
    'empty': ['', '   ', '\u3000'],
    'quotes': ['"기후"', '“기후”', '기후"', "'기후'", "기후'", '‘기후’', '«기후»', '＂기후＂', '`기후`'],
    'field operators': ['site:example.com', 'site:example.com 기후', 'when:1d', '기후 when:7d', 'intitle:기후', 'allintitle:기후', 'inurl:x', 'source:x', 'after:2026-01-01', 'before:2026-01-01', '기후：변화'],
    'exclude, require, boolean, wildcard, grouping': ['-기후', '기후 -날씨', '+기후', '기후 +날씨', '기후 OR 날씨', '기후 AND 날씨', 'a NOT b', 'x OR OR y', 'OR OR OR', 'a AND b OR', '기후|날씨', '기후*', '(기후)', '기후~', '기후<1', 'a=b', '[기후]', '{기후}', '기후;날씨', '50:50', '@handle', '$100', 'a\\b', 'a_b', 'a^b', '-', 'a - b', '+ a'],
    'invisible letters and selectors': [0x115f, 0x1160, 0x3164, 0xffa0, 0x034f, 0x17b4, 0x180b, 0xfe0f, 0xe0101, 0xe0001, 0x061c, 0xfff9].flatMap(point => [String.fromCodePoint(point), '기' + String.fromCodePoint(point) + '후']),
    'control, line break, invisible': ['기후\n변화', '기후\r\n변화', '기후\t변화', '기후\u0000', '기후\u001b[31m', '기\u200b후', '기\u200d후', '\u202e기후', '기후\u2028변화', '기후\u2029', '\ufeff기후', '기후\u0085', '기\u00ad후'],
    'not words': ['...', '& &', '#', '?!', ',', '% !', '🌿', '기후 🌿', '❤', '→', '「기후」', '기후。', '\ud800기후', '기후\udfff'],
  };
  for (const [group, values] of Object.entries(refused))
    for (const value of values) assert.throws(() => normalizeTopic(value), code('invalid_topic'), group + ': ' + JSON.stringify(value));
  for (const value of [null, undefined, 1, {}, ['기후'], true]) assert.throws(() => normalizeTopic(value), code('invalid_request'));
});

test('request: exactly { topics, languages }; counts, duplicates and every other field are settled before any work', async () => {
  const [{ validateRequest, LIMITS, LANGUAGES }] = await modules;
  assert.deepEqual(LIMITS, { topics: 8, topicLength: 40, body: 4096 }); assert.deepEqual(LANGUAGES, ['ko', 'en']);
  assert.deepEqual(validateRequest({ topics: ['기후', ' 기후 ', 'Climate', 'climate', 'CLIMATE'], languages: ['en', 'ko'] }),
    { topics: ['기후', 'Climate'], languages: ['ko', 'en'] }, 'same topic once (case-insensitive), languages in a fixed order');
  assert.deepEqual(validateRequest({ topics: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], languages: ['ko'] }).topics.length, 8);
  const bad = [null, [], 'x', {}, { topics: ['기후'] }, { languages: ['ko'] },
    { topics: [], languages: ['ko'] }, { topics: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], languages: ['ko'] },
    { topics: '기후', languages: ['ko'] }, { topics: ['기후'], languages: 'ko' }, { topics: ['기후'], languages: [] },
    { topics: ['기후'], languages: ['ja'] }, { topics: ['기후'], languages: ['ko', 'en', 'ko'] }, { topics: ['기후'], languages: [1] },
    { topics: [1], languages: ['ko'] }, { topics: [['기후']], languages: ['ko'] },
    { topics: ['기후'], languages: ['ko'], userId: '11111111-1111-4111-8111-111111111111' }, { topics: ['기후'], languages: ['ko'], email: 'a@b.example' },
    { topics: ['기후'], languages: ['ko'], supplier: 'other' }, { topics: ['기후'], languages: ['ko'], url: 'https://evil.example/' },
    { topics: ['기후'], languages: ['ko'], likes: ['단어'] }, JSON.parse('{"topics":["기후"],"languages":["ko"],"__proto__":{"x":1}}'),
    Object.assign(Object.create({ topics: ['기후'] }), { languages: ['ko'] })];
  for (const input of bad) assert.throws(() => validateRequest(input), code('invalid_request'), JSON.stringify(input));
  assert.throws(() => validateRequest({ topics: ['기후', 'site:example.com'], languages: ['ko'] }), code('invalid_topic'));
});

test('supplier address: host and path are fixed, the topic is one encoded q value, and only q, hl, gl, ceid exist', async () => {
  const [, { upstreamURL }, , { googleNews }] = await modules;
  assert.equal(upstreamURL(googleNews, '기후', 'ko'), 'https://news.google.com/rss/search?q=%EA%B8%B0%ED%9B%84&hl=ko&gl=KR&ceid=KR:ko');
  assert.equal(upstreamURL(googleNews, 'climate change', 'en'), 'https://news.google.com/rss/search?q=climate%20change&hl=en-US&gl=US&ceid=US:en');
  for (const topic of ['기후', 'climate change', 'R&D', 'C++', 'C#', 'AI/ML', "O'Reilly", 'O’Reilly', '.NET', '3·1 운동', 'a&hl=xx', 'a#b', 'a/../b']) {
    for (const language of ['ko', 'en']) {
      const address = upstreamURL(googleNews, topic, language), url = new URL(address);
      assert.equal(url.origin, 'https://news.google.com'); assert.equal(url.pathname, '/rss/search');
      assert.deepEqual([...url.searchParams.keys()], ['q', 'hl', 'gl', 'ceid'], topic);
      assert.equal(url.searchParams.get('q'), topic, 'the topic arrives as typed: ' + topic);
      assert.deepEqual([url.searchParams.get('hl'), url.searchParams.get('gl'), url.searchParams.get('ceid')],
        language === 'ko' ? ['ko', 'KR', 'KR:ko'] : ['en-US', 'US', 'US:en']);
      assert.match(address, /^https:\/\/news\.google\.com\/rss\/search\?q=[A-Za-z0-9%._~-]+&hl=[A-Za-z-]+&gl=[A-Z]+&ceid=[A-Z]+:[a-z]+$/, 'ASCII only, nothing unencoded');
    }
  }
  for (const language of ['ja', 'KO', '', 'constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', null, undefined, 0, ['ko']])
    assert.throws(() => googleNews.url('기후', language), code('invalid_request'), 'only the two listed editions: ' + String(language));
  assert.throws(() => googleNews.url(null, 'ko'), code('invalid_request'));
});

test('adapter contract: an adapter cannot move the request to another host, scheme, port, path or user', async () => {
  const [, { upstreamURL, checkSupplier, createUpstream }, , { googleNews }, xml] = await modules;
  assert.equal(checkSupplier(googleNews), googleNews);
  assert.deepEqual({ id: googleNews.id, label: googleNews.label, host: googleNews.host, path: googleNews.path, linkHosts: [...googleNews.linkHosts], languages: [...googleNews.languages] },
    { id: 'google-news-rss', label: 'Google 뉴스', host: 'news.google.com', path: '/rss/search', linkHosts: ['news.google.com'], languages: ['ko', 'en'] });
  assert(Object.isFrozen(googleNews) && Object.isFrozen(googleNews.linkHosts));
  const rogue = url => ({ ...googleNews, url: () => url });
  for (const address of ['https://evil.example/rss/search?q=a', 'http://news.google.com/rss/search?q=a', 'https://news.google.com:8443/rss/search?q=a',
    'https://user:pass@news.google.com/rss/search?q=a', 'https://news.google.com@evil.example/rss/search?q=a', 'https://news.google.com.evil.example/rss/search?q=a',
    'https://NEWS.GOOGLE.COM/rss/search?q=a', 'https://news.google.com/rss/search/../../other?q=a', 'https://news.google.com/rss/articles?q=a',
    'https://news.google.com/rss/search', 'https://news.google.com/rss/search?q=a#frag', 'https://news.google.com/rss/search?q=a b', 'https://news.google.com/rss/search?q=기후',
    'https://news.google.com\\@evil.example/rss/search?q=a', 'https://127.0.0.1/rss/search?q=a', 'https://[::1]/rss/search?q=a', '//news.google.com/rss/search?q=a',
    'javascript:alert(1)', 'file:///etc/passwd', '', null, 42, 'https://news.google.com/rss/search?q=' + 'a'.repeat(2100)])
    assert.throws(() => upstreamURL(rogue(address), '기후', 'ko'), code('blocked'), String(address));
  // A refused address is never requested.
  let calls = 0;
  const run = createUpstream({ supplier: rogue('https://evil.example/rss/search?q=a'), ...xml, fetcher: async () => { calls++; return answer(rss('')); } });
  await assert.rejects(run('기후', 'ko'), code('blocked')); assert.equal(calls, 0);
  for (const broken of [null, {}, { ...googleNews, host: '127.0.0.1' }, { ...googleNews, host: 'localhost' }, { ...googleNews, host: 'news.google.com:443' },
    { ...googleNews, host: 'evil.example/x' }, { ...googleNews, path: 'rss/search' }, { ...googleNews, path: '/rss/search?x=1' }, { ...googleNews, id: 'Google News' },
    { ...googleNews, linkHosts: [] }, { ...googleNews, linkHosts: ['*'] }, { ...googleNews, url: null }, { ...googleNews, extract: null }, { ...googleNews, accept: [] }])
    assert.throws(() => checkSupplier(broken), code('setup_required'));
  assert.throws(() => createUpstream({ supplier: googleNews }), code('setup_required'), 'no parser, no function');
});

test('the one outside request: GET with three generic headers and nothing else', async () => {
  const { run, calls } = await upstream(() => answer(fixture('google-news-ko.xml')));
  await run('기후', 'ko');
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, 'https://news.google.com/rss/search?q=%EA%B8%B0%ED%9B%84&hl=ko&gl=KR&ceid=KR:ko');
  assert.deepEqual(Object.keys(init).sort(), ['cache', 'credentials', 'headers', 'method', 'redirect', 'signal']);
  assert.deepEqual({ method: init.method, redirect: init.redirect, credentials: init.credentials, cache: init.cache }, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store' });
  assert.deepEqual(init.headers, { Accept: 'application/xml, text/xml, application/rss+xml', 'Accept-Encoding': 'identity', 'User-Agent': 'Mozilla/5.0 (compatible; FeedReader/1.0)' });
  assert(!/haedo|supabase|github|wonchance/i.test(JSON.stringify(init.headers) + url), 'no project or owner name');
  assert(init.signal instanceof AbortSignal);
});

test('redirects, other statuses, wrong types and oversize answers fail the topic; nothing is followed or half-read', async () => {
  const cases = [
    ['redirect thrown by fetch (redirect: error)', () => { throw new TypeError('redirect mode is set to error: https://consent.example/?continue=SECRET'); }, 'network_error'],
    ['301 to the same host', () => new Response(null, { status: 301, headers: { location: 'https://news.google.com/rss/other' } }), 'blocked'],
    ['302 to another host', () => new Response(null, { status: 302, headers: { location: 'https://consent.example/' } }), 'blocked'],
    ['307', () => new Response(null, { status: 307, headers: { location: 'http://169.254.169.254/' } }), 'blocked'],
    ['a followed redirect', () => Object.defineProperty(answer(rss(item())), 'redirected', { value: true }), 'blocked'],
    ['an answer from another address', () => Object.defineProperty(answer(rss(item())), 'url', { value: 'https://news.google.com/rss/search?q=other' }), 'blocked'],
    ['429', () => answer('SECRET', XML_TYPE, 429), 'rate_limited'],
    ['403', () => answer('SECRET', XML_TYPE, 403), 'blocked'],
    ['401', () => answer('SECRET', XML_TYPE, 401), 'blocked'],
    ['500', () => answer('SECRET', XML_TYPE, 500), 'network_error'],
    ['204', () => new Response(null, { status: 204, headers: XML_TYPE }), 'network_error'],
    ['206', () => answer(rss(item()), XML_TYPE, 206), 'network_error'],
    ['html', () => answer('<html>consent</html>', { 'content-type': 'text/html; charset=utf-8' }), 'invalid_response'],
    ['json', () => answer('{}', { 'content-type': 'application/json' }), 'invalid_response'],
    ['no type', () => new Response(new TextEncoder().encode(rss(item()))), 'invalid_response'],
    ['declared too large', () => answer(rss(item()), { ...XML_TYPE, 'content-length': String(1024 * 1024 + 1) }), 'invalid_response'],
    ['bad content-length', () => answer(rss(item()), { ...XML_TYPE, 'content-length': '1e3' }), 'invalid_response'],
    ['invalid UTF-8', () => answer(new Uint8Array([0x3c, 0x72, 0xff, 0xfe]), XML_TYPE), 'invalid_response'],
    ['no body', () => Object.defineProperty(answer(''), 'body', { value: null }), 'invalid_response'],
  ];
  for (const [name, respond, expected] of cases) {
    const { run, calls } = await upstream(respond);
    await assert.rejects(run('기후', 'ko'), error => error.code === expected && !/SECRET|consent/.test(error.message), name);
    assert.equal(calls.length, 1, name + ': one request, no second attempt');
  }
  // A body that keeps coming is cut at 1 MiB, not buffered to the end.
  let pulled = 0, cancelled = false;
  const endless = new ReadableStream({ pull(controller) { pulled++; controller.enqueue(new Uint8Array(64 * 1024).fill(0x20)); }, cancel() { cancelled = true; } });
  const { run } = await upstream(() => new Response(endless, { headers: XML_TYPE }));
  await assert.rejects(run('기후', 'ko'), code('invalid_response'));
  assert(pulled <= 20 && cancelled, 'stopped after about 1 MiB (' + pulled + ' chunks) and cancelled');
  // A supplier that never answers is abandoned at the call timeout.
  const hung = await upstream((_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))));
  const started = Date.now(), keepAlive = setTimeout(() => {}, 10000); // AbortSignal.timeout does not hold Node's event loop open
  try { await assert.rejects(hung.run('기후', 'ko', { timeout: 30 }), code('network_error')); } finally { clearTimeout(keepAlive); }
  assert(Date.now() - started < 5000);
  const [, { UPSTREAM }] = await modules;
  assert.deepEqual({ ...UPSTREAM }, { bytes: 1048576, timeout: 8000, concurrency: 4, userAgent: 'Mozilla/5.0 (compatible; FeedReader/1.0)' });
});

test('feed parsing: the synthetic Korean and English feeds become link-only items, newest first', async () => {
  const ko = await (await upstream(() => answer(fixture('google-news-ko.xml')))).run('기후', 'ko');
  assert.deepEqual(ko.map(row => [row.title, row.publishedAt, row.sourceName, row.sourceUrl]), [
    ['연구·개발(R&D) 예산과 기후 기술 🌿', '2026-11-11T11:55:38.000Z', '시험방송', null], // http outlet address is not kept
    ["'기후 외교' 모의 회의 순항…학생 대표단 참가", '2026-11-11T09:35:00.000Z', '견본신문', 'https://www.gyeonbon.example/'],
    ['기후 통계 다시 읽기 - 숫자와 기록', '2026-11-10T03:00:00.000Z', '예시통신', 'https://news.yesi-tongsin.example/'], // only the exact outlet tail goes
    ['기후 기록 전시, 주말 관람객 늘어', '2026-11-09T00:10:00.000Z', '가상일보', 'https://www.gasang-ilbo.example/'],
    ['가상 도시, 기후 적응 계획 발표…"2030년까지 녹지 두 배"', '2026-11-08T22:17:00.000Z', '가상일보', 'https://www.gasang-ilbo.example/'],
    ['지난해 기후 보고서 요약', '2025-11-14T08:00:00.000Z', '견본신문', 'https://www.gyeonbon.example/'],
  ]);
  for (const row of ko) {
    assert.deepEqual(Object.keys(row), ['id', 'title', 'link', 'publishedAt', 'sourceName', 'sourceUrl'], 'no description, body or image');
    assert.match(row.link, /^https:\/\/news\.google\.com\/rss\/articles\/CBMiSYNTHETICko000[1-6][A-F]+\?oc=5$/, 'the Google address is kept as it is');
    assert.equal(row.id, crypto.createHash('sha256').update(row.link).digest('hex').slice(0, 32), 'stable id from the link');
    assert(!/[<>]|href|font|nbsp/.test(JSON.stringify(row)), 'no markup from <description>');
  }
  assert.equal(new Set(ko.map(row => row.id)).size, 6);
  const en = await (await upstream(() => answer(fixture('google-news-en.xml'), { 'content-type': 'text/xml' }))).run('climate', 'en');
  assert.deepEqual(en.map(row => [row.title, row.sourceName]), [
    ['Sample city adopts a climate plan: "twice the trees by 2030"', 'The Example Times'], ['Climate data, reread', 'Sample Wire'],
    ['R&D budgets & climate tech', 'Test Broadcast'], ['Weekend crowds at a climate records exhibit', 'The Example Times']]);
  assert.deepEqual(await parse(rss('')), [], 'an empty result is an answer, not an error');
});

test('item normalization: unsafe links are dropped, text is plain and bounded, missing fields are null', async () => {
  const titles = async xml => (await parse(xml)).map(row => row.title);
  // Links: only https on news.google.com, exactly.
  const links = ['javascript:alert(1)', 'data:text/html,x', 'http://news.google.com/rss/articles/a', 'https://evil.example/rss/articles/a',
    'https://xnews.google.com/a', 'https://evilnews.google.com/a', 'https://a.news.google.com/a', 'https://google.com/a', 'https://news.google.com./a',
    'https://news.google.com@evil.example/a', 'https://news.google.com.evil.example/a', 'https://NEWS.GOOGLE.COM/rss/articles/a', 'https://news.google.com:444/a',
    'https://user@news.google.com/a', '//news.google.com/a', '/rss/articles/a', 'https://news.google.com\\@evil.example/a', 'https://news.google.com/' + 'a'.repeat(2100),
    'https://news.google.com/a b', ''];
  assert.deepEqual(await parse(rss(links.map(link => item({ link: link.replaceAll('&', '&amp;') })).join('') + item({ link: null }))), [], 'every unsafe or missing link');
  const kept = await parse(rss(item({ link: ' https://news.google.com/rss/articles/CBMiA?oc=5&amp;x=%E2%9C%93#top ' })));
  assert.equal(kept[0].link, 'https://news.google.com/rss/articles/CBMiA?oc=5&x=%E2%9C%93#top');
  // Titles: CDATA, entities, Korean, emoji, control characters, length, the outlet tail.
  const link = n => 'https://news.google.com/rss/articles/' + n;
  assert.deepEqual(await titles(rss([
    item({ link: link(1), title: '<![CDATA[CDATA 제목 <b>굵게</b> & 기호 - 매체]]>' }),
    item({ link: link(2), title: '&lt;script&gt;alert(1)&lt;/script&gt; &#44592;&#x1F33F; - 매체' }),
    item({ link: link(3), title: '줄\n바꿈\t탭 \u202e뒤집기\u200b - 매체' }),
    item({ link: link(4), title: '매체 - 매체' }),
    item({ link: link(5), title: ' - 매체' }),
    item({ link: link(6), title: '꼬리 - 다른매체' }),
    item({ link: link(7), title: '출처 없음 - 매체', source: '' }),
    item({ link: link(8), title: '가'.repeat(400) + ' - 매체' }),
    item({ link: link(9), title: null }), item({ link: link(10), title: '   ' }),
  ].join(''))), ['CDATA 제목 <b>굵게</b> & 기호', '<script>alert(1)</script> 기🌿', '줄 바꿈 탭 뒤집기', '매체', '- 매체', '꼬리 - 다른매체', '출처 없음 - 매체', '가'.repeat(299) + '…']);
  // Dates and outlets.
  const rows = await parse(rss([
    item({ link: link(1), pubDate: 'Wed, 11 Nov 2026 09:35:00 +0900' }), item({ link: link(2), pubDate: '2026-11-11T09:35:00Z' }),
    item({ link: link(3), pubDate: 'Sat, 31 Feb 2026 00:00:00 GMT' }), item({ link: link(4), pubDate: null }),
    item({ link: link(5), pubDate: 'Fri, 13 Nov 2026 13:00:01 GMT' }), item({ link: link(6), pubDate: 'Thu, 12 Nov 2026 12:59:59 GMT' }),
    item({ link: link(7), source: '<source url="javascript:alert(1)">매체</source>' }), item({ link: link(8), source: '<source url="https://127.0.0.1/">매체</source>' }),
    item({ link: link(9), source: '<source url="https://user:pw@outlet.example/">매체</source>' }), item({ link: link(10), source: '<source url="https://localhost/">매체</source>' }),
    item({ link: link(11), source: '<source>주소 없는 매체</source>' }), item({ link: link(12), source: '<source url="https://outlet.example/a?b=1">' + '긴'.repeat(150) + '</source>' }),
    item({ link: link(13), source: '<source url="https://outlet.example"></source>' }),
  ].join('')));
  const by = n => rows.find(row => row.link === link(n));
  assert.equal(by(1).publishedAt, '2026-11-11T00:35:00.000Z', 'offset applied');
  for (const n of [2, 3, 4, 5]) assert.equal(by(n).publishedAt, null, 'not an RFC 822 date, impossible, missing or more than a day ahead: ' + n);
  assert.equal(by(6).publishedAt, '2026-11-12T12:59:59.000Z');
  for (const n of [7, 8, 9, 10, 11]) assert.equal(by(n).sourceUrl, null, 'outlet address ' + n);
  assert.equal(by(11).sourceName, '주소 없는 매체'); assert.equal(by(12).sourceUrl, 'https://outlet.example/a?b=1');
  assert.equal([...by(12).sourceName].length, 100); assert.equal(by(13).sourceName, null);
  assert.deepEqual(rows.slice(-4).map(row => row.publishedAt), [null, null, null, null], 'undated items last');
  // Duplicates and the per-topic bound.
  const many = Array.from({ length: 100 }, (_, n) => item({ link: link('n' + n), title: '글 ' + n + ' - 매체', pubDate: new Date(NOW - n * 60000).toUTCString() })).join('');
  const bounded = await parse(rss(many + item({ link: link('n0'), title: '같은 주소 - 매체' })));
  assert.deepEqual(bounded.map(row => row.title), Array.from({ length: 30 }, (_, n) => '글 ' + n), 'the 30 newest of 100, one per link');
  await assert.rejects(parse(rss(Array.from({ length: 201 }, (_, n) => item({ link: link('m' + n) })).join(''))), code('invalid_response'), 'more than 200 raw items');
});

test('broken, hostile and unexpected XML is an invalid answer, never a partial one', async () => {
  const bad = {
    'not xml': 'plain text', 'unclosed': '<rss version="2.0"><channel><item><title>x', 'mismatched': '<rss version="2.0"><channel></rss></channel>',
    'doctype': '<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>' + rss(item({ title: '&b;' })).replace(/^<\?xml[^>]*\?>/, ''),
    // A DOCTYPE is refused as such, also when nothing in the document refers to an entity it declares.
    'bare doctype': '<!DOCTYPE rss><rss version="2.0"><channel><item><title>T &lt; x</title><link>https://news.google.com/a</link></item></channel></rss>',
    'doctype with a system id': '<!DOCTYPE rss SYSTEM "https://evil.example/rss.dtd"><rss version="2.0"><channel></channel></rss>',
    'doctype that redefines lt': '<!DOCTYPE rss [<!ENTITY lt "' + 'Z'.repeat(1000) + '">]><rss version="2.0"><channel><item><title>' + '&lt;'.repeat(900) + '</title><link>https://news.google.com/a</link></item></channel></rss>',
    'doctype that redefines amp as markup': '<!DOCTYPE rss [<!ENTITY amp "<script>x</script>">]><rss version="2.0"><channel><item><title>a &amp; b</title><link>https://news.google.com/a</link></item></channel></rss>',
    'doctype that redefines apos': '<!DOCTYPE rss [<!ENTITY apos "INJECTED">]><rss version="2.0"><channel><item><title>a &apos; b</title><link>https://news.google.com/a</link></item></channel></rss>',
    'lower-case doctype': '<!doctype rss><rss version="2.0"><channel></channel></rss>',
    'external entity': '<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss version="2.0"><channel><item><title>&xxe;</title></item></channel></rss>',
    'undeclared entity': rss(item({ title: '&nbsp;제목' })), 'unterminated entity': rss(item({ title: 'R&D' })),
    'invalid character reference': rss(item({ title: '&#0;' })), 'surrogate reference': rss(item({ title: '&#xD800;' })),
    'processing instruction': rss('<?php echo 1 ?>' + item()), 'stylesheet instruction': '<?xml version="1.0"?><?xml-stylesheet href="https://evil.example/x.xsl"?><rss version="2.0"><channel></channel></rss>',
    'other encoding': '<?xml version="1.0" encoding="EUC-KR"?><rss version="2.0"><channel></channel></rss>',
    'not rss 2.0': rss(item(), '<rss version="0.91">'), 'no version': rss(item(), '<rss>'), 'atom': '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>x</title></entry></feed>',
    'no channel': '<rss version="2.0"></rss>', 'control character': rss(item({ title: 'a\u0001b' })),
    'deep nesting': rss('<item>' + '<a>'.repeat(40) + '</a>'.repeat(40) + '</item>'),
    'too many nodes': rss('<item>' + '<a/>'.repeat(20001) + '</item>'),
  };
  for (const [name, xml] of Object.entries(bad)) await assert.rejects(parse(xml), code('invalid_response'), name);
  // Repeated or oddly shaped elements cost that item its field, not the feed.
  const odd = await parse(rss('<item><title>하나</title><title>둘</title><link>https://news.google.com/a</link></item>' +
    '<item><title>정상 - 매체</title><link>https://news.google.com/b</link><link>https://news.google.com/c</link></item>' +
    '<item><title>출처 둘</title><link>https://news.google.com/d</link><source url="https://a.example">가</source><source url="https://b.example">나</source></item>' +
    '<item><title><b>중첩</b></title><link>https://news.google.com/e</link></item>'));
  assert.deepEqual(odd.map(row => [row.title, row.link, row.sourceName]), [['출처 둘', 'https://news.google.com/d', null]]);
});

test('merging and the cache read-back: one link once, every topic represented under the total bound, tampered rows dropped', async () => {
  const [, , { mergeItems, storedItems, ITEM_LIMITS }, { googleNews }] = await modules;
  assert.deepEqual({ ...ITEM_LIMITS }, { perTopic: 30, total: 200, raw: 200, title: 300, link: 2048, sourceName: 100 });
  const row = (n, minutes) => ({ id: crypto.createHash('sha256').update('L' + n).digest('hex').slice(0, 32), title: '글 ' + n, link: 'https://news.google.com/rss/articles/L' + n,
    publishedAt: minutes === null ? null : new Date(NOW - minutes * 60000).toISOString(), sourceName: '매체', sourceUrl: null });
  const merged = mergeItems([{ topic: '가', language: 'ko', items: [row(1, 10), row(2, 30), row(9, null)] }, { topic: '나', language: 'en', items: [row(2, 30), row(3, 5)] }]);
  assert.deepEqual(merged.items.map(entry => [entry.title, entry.topic, entry.language]), [['글 3', '나', 'en'], ['글 1', '가', 'ko'], ['글 2', '가', 'ko'], ['글 9', '가', 'ko']]);
  assert.deepEqual(merged.counts, [3, 1]);
  assert.deepEqual(Object.keys(merged.items[0]), ['id', 'title', 'link', 'publishedAt', 'sourceName', 'sourceUrl', 'topic', 'language']);
  // 16 pairs of 30 would be 480: 200 are taken in turns, so the last topic is not crowded out.
  const groups = Array.from({ length: 16 }, (_, g) => ({ topic: 't' + g, language: 'ko', items: Array.from({ length: 30 }, (_, n) => row(g * 100 + n, g * 1000 + n)) }));
  const bounded = mergeItems(groups);
  assert.equal(bounded.items.length, 200); assert.deepEqual(bounded.counts, [13, 13, 13, 13, 13, 13, 13, 13, 12, 12, 12, 12, 12, 12, 12, 12]);
  assert.deepEqual(bounded.items.map(entry => Date.parse(entry.publishedAt)), bounded.items.map(entry => Date.parse(entry.publishedAt)).sort((a, b) => b - a), 'newest first');
  const good = row(1, 10);
  assert.deepEqual(storedItems([good], googleNews), [good]);
  for (const tampered of [{ ...good, link: 'https://evil.example/a' }, { ...good, link: 'javascript:alert(1)' }, { ...good, id: 'x' }, { ...good, title: '' }, { ...good, title: 'a\nb' },
    { ...good, publishedAt: 'yesterday' }, { ...good, sourceUrl: 'http://outlet.example/' }, { ...good, sourceName: '' }, { ...good, body: '<p>본문</p>' },
    (({ sourceUrl, ...rest }) => rest)(good), 'text', null, [good]])
    assert.deepEqual(storedItems([tampered], googleNews), [], JSON.stringify(tampered));
  assert.equal(storedItems('not a list', googleNews), null); assert.equal(storedItems({ 0: good }, googleNews), null);
  assert.equal(storedItems(Array.from({ length: 40 }, (_, n) => row(n, n)), googleNews).length, 30);
});

test('no new dependency: the function reuses the pinned haedo-rss parser bundle and imports only its own files', () => {
  const bundle = fs.readFileSync(path.join(DIR, '../haedo-rss/vendor/fast-xml-parser.mjs'));
  assert.equal(crypto.createHash('sha256').update(bundle).digest('hex'), '438ed6e4997ab8a22fb76957c5a12b5956f95965d105cb0ac8cbc75bec627f55', 'the bundle named in haedo-rss/README.md');
  const files = fs.readdirSync(DIR, { recursive: true }).map(String).filter(name => fs.statSync(path.join(DIR, name)).isFile()).sort();
  assert.deepEqual(files, ['README.md', 'handler.mjs', 'index.ts', 'items.mjs', 'suppliers/google-news.mjs', 'topics.mjs', 'upstream.mjs', 'xml.mjs']);
  const allowed = { 'index.ts': ['./handler.mjs', '../haedo-rss/vendor/fast-xml-parser.mjs'],
    'handler.mjs': ['./topics.mjs', './upstream.mjs', './items.mjs', './suppliers/google-news.mjs', '../_shared/supabase-keys.mjs'],
    'upstream.mjs': ['./xml.mjs', './items.mjs'], 'suppliers/google-news.mjs': ['../xml.mjs'], 'items.mjs': [], 'topics.mjs': [], 'xml.mjs': [] };
  for (const [name, expected] of Object.entries(allowed)) {
    const source = fs.readFileSync(path.join(DIR, name), 'utf8');
    assert.deepEqual([...source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map(match => match[1]), expected, name);
    assert(!/\bimport\s*\(|\brequire\s*\(|npm:|jsr:|https?:\/\/(?=[A-Za-z0-9[])(?!news\.google\.com\/rss\/search|wonchance-art\.github\.io|127\.0\.0\.1:4173|localhost:4173)/.test(source.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')), name + ': no dynamic import and no other address in code');
  }
  // The modules that reach the supplier are never given credentials or account values.
  for (const name of ['upstream.mjs', 'items.mjs', 'xml.mjs', 'suppliers/google-news.mjs', 'topics.mjs']) {
    const code = fs.readFileSync(path.join(DIR, name), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    assert(!/authorization|apikey|cookie|referer|supabase|environment|console\.|Deno|process\.env/i.test(code), name);
  }
});

test('headlines: invisible and direction characters become a space, joiners that scripts and emoji need stay', async () => {
  const [, , { cleanText }] = await modules;
  const point = value => String.fromCodePoint(value);
  for (const hidden of [0x00ad, 0x061c, 0x115f, 0x1160, 0x180e, 0x200b, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2028, 0x2029, 0x2060, 0x2066, 0x2067, 0x2068, 0x2069, 0x3164, 0xfeff, 0xffa0,
    0xfff9, 0xfffa, 0xfffb, 0xe0000, 0xe0001, 0xe0020, 0xe007f, 0x0000, 0x0007, 0x001b, 0x007f, 0x0085, 0x009f]) {
    assert.equal(cleanText('가' + point(hidden) + '나', 300), '가 나', 'U+' + hidden.toString(16));
    assert.equal(cleanText(point(hidden) + '가나' + point(hidden), 300), '가나', 'at the edges: U+' + hidden.toString(16));
    assert.equal(cleanText(point(hidden), 300), null, 'nothing visible left: U+' + hidden.toString(16));
  }
  const family = point(0x1f468) + point(0x200d) + point(0x1f469) + point(0x200d) + point(0x1f467), persian = point(0x645, 0x6cc, 0x200c, 0x62e, 0x648, 0x627, 0x647, 0x645);
  assert.equal(cleanText(family + ' ' + persian, 300), family + ' ' + persian, 'ZWJ and ZWNJ are kept');
  assert.equal(cleanText('heart ' + point(0x2764, 0xfe0f), 300), 'heart ' + point(0x2764, 0xfe0f), 'an emoji presentation selector is kept');
  // The same through the whole path: a headline with hidden characters comes out as plain words.
  const items = await parse(rss(item({ title: '숨' + point(0x061c) + '은' + point(0xe0001) + ' 글' + point(0x00ad) + '자' + point(0x3164) + ' - 매체' })));
  assert.deepEqual(items.map(row => row.title), ['숨 은 글 자']);
});

test('deploy targets hold no literal invisible character, and their hashes are the ones in the operations guide', () => {
  const root = path.join(__dirname, '..');
  const deployed = ['supabase/functions/haedo-news-wide/index.ts', 'supabase/functions/haedo-news-wide/handler.mjs', 'supabase/functions/haedo-news-wide/topics.mjs',
    'supabase/functions/haedo-news-wide/upstream.mjs', 'supabase/functions/haedo-news-wide/items.mjs', 'supabase/functions/haedo-news-wide/xml.mjs',
    'supabase/functions/haedo-news-wide/suppliers/google-news.mjs', 'supabase/functions/_shared/supabase-keys.mjs', 'supabase/functions/haedo-rss/vendor/fast-xml-parser.mjs'];
  const sql = ['supabase/migrations/20261111130000_news_wide_feed.sql', 'supabase/operations/20261111-news-wide-allow-first-account.sql'];
  // Format, line/paragraph separator, private-use, unassigned and non-characters, controls other
  // than tab and newline, and any space other than U+0020: all must be written as escapes, so
  // that copying the text through a tool cannot silently drop them.
  const hiddenLiteral = /[\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}]|(?![\t\n])\p{Cc}|(?! )\p{Zs}/u;
  for (const file of [...deployed.filter(name => !name.includes('/vendor/')), ...sql, 'supabase/functions/haedo-news-wide/README.md']) {
    const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
    lines.forEach((line, at) => {
      const found = [...line].filter(char => hiddenLiteral.test(char)).map(char => 'U+' + char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
      assert.deepEqual(found, [], file + ':' + (at + 1) + ' holds a literal invisible character');
    });
  }
  // The migration is plain ASCII: its security patterns use \\uXXXX escapes only.
  const migration = fs.readFileSync(path.join(root, sql[0]), 'utf8');
  assert(!/[^\x00-\x7f]/.test(migration), 'non-ASCII character in the migration');
  assert(!/\r/.test(migration) && !/\r/.test(fs.readFileSync(path.join(root, sql[1]), 'utf8')), 'no carriage return: md5(prosrc) depends on the exact text');
  // The detector itself: it sees what it must see and leaves ordinary text alone.
  for (const hidden of [0x200b, 0x200e, 0x202e, 0x2028, 0x2060, 0xfeff, 0x00ad, 0x00a0, 0x3000, 0xfffe, 0xffff, 0xe000, 0x0001, 0x000d, 0x007f, 0x061c, 0xe0001]) assert(hiddenLiteral.test(String.fromCodePoint(hidden)), 'detected: ' + hidden.toString(16));
  for (const plain of ['a', ' ', '\t', '가', '’', '·', '𠀀', 'é', '🌿']) assert(!hiddenLiteral.test(plain), 'not flagged: ' + JSON.stringify(plain));
  // SHA-256 of every file the guide tells the orchestrator to deploy or apply.
  const guide = fs.readFileSync(path.join(root, 'docs/design-review/news-wide-feed.md'), 'utf8');
  const start = guide.indexOf('<!-- news-wide-file-hashes:start -->'), end = guide.indexOf('<!-- news-wide-file-hashes:end -->');
  assert(start >= 0 && end > start, 'the file hash table markers are in the guide');
  const listed = [...guide.slice(start, end).matchAll(/^\| `([^`]+)` \| `([a-f0-9]{64})` \|$/gm)].map(match => [match[1], match[2]]);
  const actual = [...deployed, ...sql].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]);
  assert.deepEqual(listed, actual, 'the SHA-256 table in docs/design-review/news-wide-feed.md differs from the files');
});

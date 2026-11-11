// haedo-news-wide handler: who may call it, what each cache state becomes,
// what leaves the server, what is logged. Auth, the cache RPCs and the supplier
// are fakes; the real SQL is exercised by tests/run-news-wide-postgres.cjs.
// Every key, account and headline below is synthetic.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modules = Promise.all([import('../supabase/functions/haedo-news-wide/handler.mjs'), import('../supabase/functions/haedo-rss/vendor/fast-xml-parser.mjs'),
  import('../supabase/functions/_shared/supabase-keys.mjs')]);
const PROJECT = 'https://project-fixture.supabase.co';
const OWNER = '11111111-1111-4111-8111-111111111111', EMAIL = 'owner-fixture@mail.example';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c2lnbmF0dXJlLWZpeHR1cmU';
const NEW = { secret: 'sb_secret_fixture_news_server', publishable: 'sb_publishable_fixture_news_public' };
const ENV = { SUPABASE_URL: PROJECT, SUPABASE_SECRET_KEYS: JSON.stringify({ default: NEW.secret }), SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: NEW.publishable }) };
const PAGES = 'https://wonchance-art.github.io';
const LEASE = n => '22222222-2222-4222-8222-' + String(n).padStart(12, '0');
const ko = fs.readFileSync(path.join(__dirname, 'fixtures/news-wide/google-news-ko.xml'));
const en = fs.readFileSync(path.join(__dirname, 'fixtures/news-wide/google-news-en.xml'));
const cachedItem = (n, at = '2026-11-10T00:00:00.000Z') => ({ id: String(n).padStart(32, '0').replace(/[^0-9]/g, '0'), title: '보관된 글 ' + n,
  link: 'https://news.google.com/rss/articles/CACHED' + n + '?oc=5', publishedAt: at, sourceName: '보관매체', sourceUrl: 'https://cached-outlet.example/' });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

/* options.claim(pair, index) describes each pair's cache state; default: claimed (fetch it).
 * options.supplier(url, init) replaces the supplier answer. */
async function fixture(options = {}) {
  const [{ createHandler }, xml] = await modules;
  const calls = [], logs = [], consoleLines = [];
  let clock = options.startAt ?? Date.parse('2026-11-11T13:00:00Z'), inFlight = 0, peak = 0;
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === PROJECT + '/auth/v1/user') return options.auth ? options.auth() : json('user' in options ? options.user : { id: OWNER, email: EMAIL, role: 'authenticated' });
    if (url === PROJECT + '/rest/v1/rpc/life_news_wide_claim') {
      if (options.claimResponse) return options.claimResponse(JSON.parse(init.body));
      const pairs = JSON.parse(init.body).p_requests;
      return json({ entries: pairs.map((pair, index) => ({ topic: pair.topic, language: pair.language, items: null, fetchedAt: null, expired: false, leaseToken: null, limit: null,
        ...(options.claim ? options.claim(pair, index) : { status: 'claimed', leaseToken: LEASE(index) }) })) });
    }
    if (url === PROJECT + '/rest/v1/rpc/life_news_wide_finish') {
      if (options.finishResponse) return options.finishResponse(JSON.parse(init.body), calls.filter(call => call.url === url).length);
      const results = JSON.parse(init.body).p_results;
      return json({ stored: results.filter(row => row.items).length, failed: results.filter(row => !row.items).length, stale: 0 });
    }
    if (url.startsWith('https://news.google.com/')) {
      inFlight++; peak = Math.max(peak, inFlight);
      try {
        await new Promise(resolve => setImmediate(resolve));
        if (options.supplier) return await options.supplier(url, init);
        return new Response(new URL(url).searchParams.get('hl') === 'ko' ? ko : en, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
      } finally { inFlight--; }
    }
    throw new Error('unexpected request in a test: ' + url);
  };
  const handler = createHandler({ fetcher, environment: name => (options.environment || ENV)[name], log: entry => logs.push(entry),
    now: () => { const value = clock; clock += options.tick || 0; return value; },
    ...(options.noParser ? {} : xml), ...(options.origins ? { origins: options.origins } : {}) });
  const request = (body = { topics: ['기후'], languages: ['ko'] }, headers = {}, method = 'POST') => new Request('https://edge.fixture.invalid/functions/v1/haedo-news-wide', {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN, ...headers },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
  const run = async (...args) => {
    const original = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
    for (const name of Object.keys(original)) console[name] = (...parts) => consoleLines.push(parts.map(String).join(' '));
    try { const reply = await handler(request(...args)); return { reply, body: reply.status === 204 ? null : await reply.json() }; }
    finally { Object.assign(console, original); }
  };
  const to = part => calls.filter(call => call.url.includes(part));
  return { handler, request, run, calls, logs, consoleLines, to, peak: () => peak };
}
const supplierCalls = f => f.to('news.google.com');

test('a signed-in account gets its topics: Auth first, the cache claim as the user, one supplier call per pair, results stored by the server key', async () => {
  const f = await fixture();
  const { reply, body } = await f.run({ topics: ['기후', 'climate'], languages: ['ko', 'en'] });
  assert.equal(reply.status, 200);
  assert.deepEqual(f.calls.map(call => call.url), [PROJECT + '/auth/v1/user', PROJECT + '/rest/v1/rpc/life_news_wide_claim',
    ...f.calls.slice(2, 6).map(call => call.url), PROJECT + '/rest/v1/rpc/life_news_wide_finish']);
  assert.deepEqual(supplierCalls(f).map(call => call.url).sort(), [
    'https://news.google.com/rss/search?q=%EA%B8%B0%ED%9B%84&hl=en-US&gl=US&ceid=US:en', 'https://news.google.com/rss/search?q=%EA%B8%B0%ED%9B%84&hl=ko&gl=KR&ceid=KR:ko',
    'https://news.google.com/rss/search?q=climate&hl=en-US&gl=US&ceid=US:en', 'https://news.google.com/rss/search?q=climate&hl=ko&gl=KR&ceid=KR:ko']);
  const [auth, claim] = f.calls, finish = f.calls.at(-1);
  assert.deepEqual(auth.init.headers, { apikey: NEW.publishable, Authorization: 'Bearer ' + TOKEN }); assert.equal(auth.init.method, 'GET');
  assert.deepEqual(claim.init.headers, { apikey: NEW.publishable, Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(claim.init.body), { p_supplier: 'google-news-rss', p_requests: [{ topic: '기후', language: 'ko' }, { topic: '기후', language: 'en' },
    { topic: 'climate', language: 'ko' }, { topic: 'climate', language: 'en' }] }, 'no owner in the claim: the database binds it to auth.uid()');
  assert.deepEqual(finish.init.headers, { apikey: NEW.secret, 'Content-Type': 'application/json' }, 'sb_secret_ is never a Bearer token');
  const stored = JSON.parse(finish.init.body);
  assert.deepEqual(Object.keys(stored), ['p_owner_id', 'p_supplier', 'p_results']); assert.equal(stored.p_owner_id, OWNER, 'the owner comes from Auth, never from the request');
  assert.deepEqual(stored.p_results.map(row => [row.topic, row.language, row.leaseToken, row.items.length, row.error]),
    [['기후', 'ko', LEASE(0), 6, null], ['기후', 'en', LEASE(1), 4, null], ['climate', 'ko', LEASE(2), 6, null], ['climate', 'en', LEASE(3), 4, null]]);
  for (const row of stored.p_results) for (const item of row.items) assert.deepEqual(Object.keys(item), ['id', 'title', 'link', 'publishedAt', 'sourceName', 'sourceUrl']);
  for (const call of f.calls) { assert.equal(call.init.redirect, 'error'); assert.equal(call.init.credentials, 'omit'); }
  // The answer: one list, the same link once, newest first, each item tagged with the pair that found it.
  assert.deepEqual(Object.keys(body), ['supplier', 'items', 'fetchedAt', 'stale', 'topics']);
  assert.equal(body.supplier, 'google-news-rss'); assert.equal(body.stale, false); assert.equal(body.fetchedAt, '2026-11-11T13:00:00.000Z');
  assert.deepEqual(body.topics, [{ topic: '기후', language: 'ko', status: 'fresh', fetchedAt: '2026-11-11T13:00:00.000Z', count: 6 },
    { topic: '기후', language: 'en', status: 'fresh', fetchedAt: '2026-11-11T13:00:00.000Z', count: 4 },
    { topic: 'climate', language: 'ko', status: 'fresh', fetchedAt: '2026-11-11T13:00:00.000Z', count: 0 },
    { topic: 'climate', language: 'en', status: 'fresh', fetchedAt: '2026-11-11T13:00:00.000Z', count: 0 }]);
  assert.equal(body.items.length, 10); assert.equal(new Set(body.items.map(item => item.link)).size, 10);
  assert.deepEqual(Object.keys(body.items[0]), ['id', 'title', 'link', 'publishedAt', 'sourceName', 'sourceUrl', 'topic', 'language']);
  assert.deepEqual(body.items.map(item => item.publishedAt), body.items.map(item => item.publishedAt).sort().reverse());
  assert(body.items.every(item => item.link.startsWith('https://news.google.com/rss/articles/') && item.topic === '기후'));
  assert.equal(reply.headers.get('cache-control'), 'private, no-store'); assert.equal(reply.headers.get('x-content-type-options'), 'nosniff');
});

test('what leaves the server for the supplier: the topic and the edition, and no account, session, key, project or owner value', async () => {
  const f = await fixture();
  await f.run({ topics: ['기후', 'R&D', "O'Reilly"], languages: ['ko', 'en'] }, { Cookie: 'sb-session=PRIVATE-COOKIE', Referer: 'https://wonchance-art.github.io/life-haedo/', 'x-client-info': 'haedo-client' });
  assert.equal(supplierCalls(f).length, 6);
  for (const { url, init } of supplierCalls(f)) {
    const address = new URL(url);
    assert.equal(address.origin + address.pathname, 'https://news.google.com/rss/search');
    assert.deepEqual([...address.searchParams.keys()], ['q', 'hl', 'gl', 'ceid']);
    assert(['기후', 'R&D', "O'Reilly"].includes(address.searchParams.get('q')));
    assert.deepEqual(Object.keys(init).sort(), ['cache', 'credentials', 'headers', 'method', 'redirect', 'signal']);
    assert.deepEqual(Object.keys(init.headers), ['Accept', 'Accept-Encoding', 'User-Agent']);
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.body, undefined);
    const sent = url + JSON.stringify(init.headers);
    for (const secret of [OWNER, EMAIL, TOKEN, NEW.secret, NEW.publishable, 'project-fixture', 'supabase', 'haedo', 'wonchance', 'github', 'PRIVATE-COOKIE', 'Bearer', 'apikey'])
      assert(!sent.toLowerCase().includes(secret.toLowerCase()), 'not sent: ' + secret);
  }
});

test('fresh cache answers without calling the supplier or writing anything', async () => {
  const f = await fixture({ claim: (pair, index) => ({ status: 'fresh', items: [cachedItem(index + 1)], fetchedAt: '2026-11-11T12:4' + index + ':00.123456+00:00' }) });
  const { reply, body } = await f.run({ topics: ['기후', '날씨'], languages: ['ko'] });
  assert.equal(reply.status, 200);
  assert.deepEqual(f.calls.map(call => call.url), [PROJECT + '/auth/v1/user', PROJECT + '/rest/v1/rpc/life_news_wide_claim'], 'still authenticated, nothing else');
  assert.deepEqual(body.topics, [{ topic: '기후', language: 'ko', status: 'cached', fetchedAt: '2026-11-11T12:40:00.123Z', count: 1 },
    { topic: '날씨', language: 'ko', status: 'cached', fetchedAt: '2026-11-11T12:41:00.123Z', count: 1 }]);
  assert.equal(body.stale, false); assert.equal(body.fetchedAt, '2026-11-11T12:40:00.123Z', 'the oldest part of the list');
  assert.deepEqual(body.items.map(item => [item.title, item.topic]), [['보관된 글 1', '기후'], ['보관된 글 2', '날씨']]);
});

test('each cache state: a failed call falls back to old cache as stale, no cache is failed, the allowance returns cache only with a reason', async () => {
  const states = { '실패보관': { status: 'claimed', leaseToken: LEASE(1), items: [cachedItem(1)], fetchedAt: '2026-11-11T09:00:00Z', expired: true },
    '실패': { status: 'claimed', leaseToken: LEASE(2) }, '성공': { status: 'claimed', leaseToken: LEASE(3), items: [cachedItem(3)], fetchedAt: '2026-11-11T09:00:00Z', expired: true },
    '진행중': { status: 'busy', items: [cachedItem(4)], fetchedAt: '2026-11-11T08:00:00Z', expired: true }, '진행중빈': { status: 'busy' },
    '대기': { status: 'backoff', items: [cachedItem(6)], fetchedAt: '2026-11-11T07:00:00Z', expired: true },
    '한도시간': { status: 'limited', limit: 'hour', items: [cachedItem(7)], fetchedAt: '2026-11-11T06:00:00Z', expired: true }, '한도하루': { status: 'limited', limit: 'day' } };
  const f = await fixture({ claim: pair => states[pair.topic],
    supplier: url => new URL(url).searchParams.get('q') === '성공' ? new Response(ko, { headers: { 'content-type': 'application/xml' } })
      : new URL(url).searchParams.get('q') === '실패' ? new Response('UPSTREAM-PRIVATE-TEXT', { status: 429 }) : new Response('UPSTREAM-PRIVATE-TEXT', { status: 500 }) });
  const { reply, body } = await f.run({ topics: Object.keys(states), languages: ['ko'] });
  assert.equal(reply.status, 200);
  assert.deepEqual(supplierCalls(f).map(call => new URL(call.url).searchParams.get('q')).sort(), ['성공', '실패', '실패보관'], 'only claimed pairs are fetched');
  assert.deepEqual(body.topics, [
    { topic: '실패보관', language: 'ko', status: 'stale', fetchedAt: '2026-11-11T09:00:00.000Z', count: 1, reason: 'network_error' },
    { topic: '실패', language: 'ko', status: 'failed', fetchedAt: null, count: 0, reason: 'rate_limited' },
    { topic: '성공', language: 'ko', status: 'fresh', fetchedAt: '2026-11-11T13:00:00.000Z', count: 6 },
    { topic: '진행중', language: 'ko', status: 'stale', fetchedAt: '2026-11-11T08:00:00.000Z', count: 1, reason: 'busy' },
    { topic: '진행중빈', language: 'ko', status: 'failed', fetchedAt: null, count: 0, reason: 'busy' },
    { topic: '대기', language: 'ko', status: 'stale', fetchedAt: '2026-11-11T07:00:00.000Z', count: 1, reason: 'backoff' },
    { topic: '한도시간', language: 'ko', status: 'limited', fetchedAt: '2026-11-11T06:00:00.000Z', count: 1, reason: 'hourly_limit' },
    { topic: '한도하루', language: 'ko', status: 'limited', fetchedAt: null, count: 0, reason: 'daily_limit' }]);
  assert.equal(body.stale, true); assert.equal(body.fetchedAt, '2026-11-11T06:00:00.000Z');
  assert(!body.items.some(item => item.title === '보관된 글 3'), 'a fresh answer replaces that pair\'s old cache');
  assert.deepEqual(JSON.parse(f.to('life_news_wide_finish')[0].init.body).p_results.map(row => [row.topic, row.items === null ? null : row.items.length, row.error]),
    [['실패보관', null, 'network_error'], ['실패', null, 'rate_limited'], ['성공', 6, null]], 'every claimed pair is reported exactly once');
  assert(!JSON.stringify(body).includes('UPSTREAM-PRIVATE-TEXT'));
  // A redirect and a consent page are failures of that pair, with their own reasons.
  const redirected = await fixture({ supplier: () => new Response(null, { status: 302, headers: { location: 'https://consent.google.com/?continue=x' } }) });
  assert.deepEqual((await redirected.run()).body.topics, [{ topic: '기후', language: 'ko', status: 'failed', fetchedAt: null, count: 0, reason: 'blocked' }]);
  assert.equal(supplierCalls(redirected).length, 1, 'the redirect target is never requested');
  const html = await fixture({ supplier: () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) });
  assert.equal((await html.run()).body.topics[0].reason, 'invalid_response');
  // With no allowance and no cache nothing is fetched and nothing is stored.
  const limited = await fixture({ claim: () => ({ status: 'limited', limit: 'hour' }) });
  const answer = await limited.run({ topics: ['기후', '날씨'], languages: ['ko', 'en'] });
  assert.deepEqual(answer.body.items, []); assert.equal(answer.body.fetchedAt, null); assert.equal(answer.body.stale, false);
  assert.equal(supplierCalls(limited).length, 0); assert.equal(limited.to('life_news_wide_finish').length, 0);
});

test('only a signed-in, non-anonymous account: everything else is refused before the cache or the supplier is touched', async () => {
  const none = ['life_news_wide', 'news.google.com'];
  const refused = async (f, args, calls) => {
    const { reply, body } = await f.run(...args);
    assert.equal(reply.status, 401); assert.deepEqual(body, { error: 'unauthorized' });
    assert.equal(f.calls.length, calls); for (const part of none) assert.equal(f.to(part).length, 0);
  };
  // Not a JWT-shaped session: refused before the body is read and before Auth is asked.
  for (const authorization of ['', 'Bearer', 'Bearer ', 'Bearer user-jwt', 'Bearer ' + NEW.secret, 'Bearer ' + NEW.publishable, 'Bearer a.b', 'Bearer a.b.c.d', 'Bearer a.b.c extra', 'Basic ' + TOKEN, TOKEN, 'Bearer ' + 'a.b.' + 'c'.repeat(9000)]) {
    const f = await fixture(), request = f.request(undefined, { Authorization: authorization });
    const reply = await f.handler(request);
    assert.equal(reply.status, 401, JSON.stringify(authorization)); assert.equal(request.bodyUsed, false, 'body not read'); assert.equal(f.calls.length, 0);
  }
  const f = await fixture(), anonymous = f.request(); anonymous.headers.delete('authorization');
  assert.equal((await f.handler(anonymous)).status, 401); assert.equal(f.calls.length, 0);
  // Auth decides: an expired or forged session, a server key shaped like a JWT, anonymous sign-ins.
  await refused(await fixture({ auth: () => new Response('PRIVATE auth text', { status: 401 }) }), [], 1);
  await refused(await fixture({ auth: () => new Response('PRIVATE auth text', { status: 403 }) }), [], 1);
  await refused(await fixture({ auth: () => new Response('not json') }), [], 1);
  // A refusal is a refusal whatever its body says.
  for (const status of [401, 403, 500]) await refused(await fixture({ auth: () => json({ id: OWNER, role: 'authenticated' }, status) }), [], 1);
  for (const user of [{ id: OWNER, is_anonymous: true }, { id: OWNER, role: 'anon' }, { id: 'not-a-uuid' }, {}, null, [OWNER], { id: 1 }]) await refused(await fixture({ user }), [], 1);
  // The database has the last word on the session (claim -> 401/403).
  for (const status of [401, 403]) {
    const late = await fixture({ claimResponse: () => json({ message: 'life_news_wide_auth_required' }, status) });
    const { reply, body } = await late.run();
    assert.equal(reply.status, 401); assert.deepEqual(body, { error: 'unauthorized' }); assert.equal(supplierCalls(late).length, 0);
  }
});

test('input is settled before any network call: unknown fields, bad topics, counts, size and malformed JSON', async () => {
  const cases = [
    [{ topics: ['기후'], languages: ['ko'], userId: OWNER }, 'invalid_request'], [{ topics: ['기후'], languages: ['ko'], email: EMAIL }, 'invalid_request'],
    [{ topics: ['기후'], languages: ['ko'], supplier: 'gdelt' }, 'invalid_request'], [{ topics: ['기후'], languages: ['ko'], host: 'evil.example' }, 'invalid_request'],
    [{ topics: ['기후'] }, 'invalid_request'], [{ topics: [], languages: ['ko'] }, 'invalid_request'], [{ topics: Array(9).fill('기후'), languages: ['ko'] }, 'invalid_request'],
    [{ topics: ['기후'], languages: ['ja'] }, 'invalid_request'], ['[]', 'invalid_request'], ['{"topics":', 'invalid_request'], ['', 'invalid_request'],
    [{ topics: ['기후', 'x'.repeat(5000)], languages: ['ko'] }, 'invalid_request'],
    [{ topics: ['site:example.com'], languages: ['ko'] }, 'invalid_topic'], [{ topics: ['"기후"'], languages: ['ko'] }, 'invalid_topic'],
    [{ topics: ['기후 when:1d'], languages: ['ko'] }, 'invalid_topic'], [{ topics: ['기후\n변화'], languages: ['ko'] }, 'invalid_topic'],
    [{ topics: ['가'.repeat(41)], languages: ['ko'] }, 'invalid_topic'], [{ topics: ['기후', '-제외'], languages: ['ko'] }, 'invalid_topic'],
  ];
  for (const [body, error] of cases) {
    const f = await fixture(), result = await f.run(body);
    assert.equal(result.reply.status, 400, JSON.stringify(body).slice(0, 80)); assert.deepEqual(result.body, { error });
    assert.equal(f.calls.length, 0, 'no Auth, cache or supplier call');
  }
  // Duplicates are one call, and the normalized topic is what is claimed and sent.
  const f = await fixture();
  await f.run({ topics: [' 기후  변화 ', '기후 변화', 'Climate', 'climate'], languages: ['ko'] });
  assert.deepEqual(JSON.parse(f.to('life_news_wide_claim')[0].init.body).p_requests, [{ topic: '기후 변화', language: 'ko' }, { topic: 'Climate', language: 'ko' }]);
  assert.deepEqual(supplierCalls(f).map(call => new URL(call.url).searchParams.get('q')).sort(), ['Climate', '기후 변화']);
});

test('logs hold counts, states and time only: no topic, headline, link, account, token or supplier text', async () => {
  const topics = ['비밀주제하나', 'SecretTopicTwo'];
  const f = await fixture({ claim: (pair, index) => index === 0 ? { status: 'claimed', leaseToken: LEASE(0) } : index === 1 ? { status: 'fresh', items: [cachedItem(1)], fetchedAt: '2026-11-11T12:50:00Z' }
    : index === 2 ? { status: 'limited', limit: 'hour' } : { status: 'claimed', leaseToken: LEASE(3) },
  supplier: url => new URL(url).searchParams.get('hl') === 'ko' ? new Response(ko, { headers: { 'content-type': 'application/xml' } }) : new Response('PRIVATE-UPSTREAM', { status: 500 }), tick: 7 });
  const { reply, body } = await f.run({ topics, languages: ['ko', 'en'] });
  assert.equal(reply.status, 200);
  assert.equal(f.logs.length, 1);
  assert.deepEqual(Object.keys(f.logs[0]), ['at', 'fn', 'status', 'topics', 'languages', 'upstream', 'fresh', 'cached', 'stale', 'failed', 'limited', 'items', 'ms']);
  assert.deepEqual({ ...f.logs[0], at: null, ms: null }, { at: null, fn: 'haedo-news-wide', status: 'ok', topics: 2, languages: 2, upstream: 2, fresh: 1, cached: 1, stale: 0, failed: 1, limited: 1, items: 7, ms: null });
  assert(Number.isSafeInteger(f.logs[0].ms) && f.logs[0].ms > 0); assert.match(f.logs[0].at, /^\d{4}-\d{2}-\d{2}T/);
  // Refusals and failures are logged the same way.
  const bad = await fixture(); await bad.run({ topics: ['비밀주제하나', 'site:secret.example'], languages: ['ko'] });
  const broken = await fixture({ claimResponse: () => new Response('PRIVATE database text 비밀주제하나', { status: 500 }) }); const failed = await broken.run({ topics, languages: ['ko'] });
  assert.equal(failed.reply.status, 500); assert.deepEqual(failed.body, { error: 'server_error' });
  const denied = await fixture({ auth: () => new Response('', { status: 401 }) }); await denied.run({ topics, languages: ['ko'] });
  assert.deepEqual([bad, broken, denied].map(each => [each.logs.length, each.logs[0].status, each.logs[0].topics]), [[1, 'invalid_topic', null], [1, 'server_error', 2], [1, 'unauthorized', 2]]);
  const everything = JSON.stringify([f.logs, bad.logs, broken.logs, denied.logs, f.consoleLines, bad.consoleLines, broken.consoleLines, denied.consoleLines]);
  for (const secret of [...topics, 'site:', 'secret.example', OWNER, EMAIL, TOKEN, NEW.secret, NEW.publishable, 'PRIVATE', '보관된 글', body.items[0].title, body.items[0].link, 'news.google.com', 'CBMi'])
    assert(!everything.includes(secret), 'not logged: ' + secret);
  for (const each of [f, bad, broken, denied]) assert.deepEqual(each.consoleLines, [], 'nothing is written to the console except through the log writer');
  // The default writer is console.log with that one fixed-field entry.
  const [{ createHandler }, xml] = await modules, lines = [], original = console.log;
  console.log = line => lines.push(line);
  try { await createHandler({ ...xml, environment: name => ENV[name], fetcher: async () => { throw new Error('PRIVATE network text'); } })(f.request({ topics, languages: ['ko'] })); }
  finally { console.log = original; }
  assert.equal(lines.length, 1); assert.deepEqual(Object.keys(JSON.parse(lines[0])), Object.keys(f.logs[0])); assert(!/PRIVATE|비밀주제|SecretTopic/.test(lines[0]));
  const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/haedo-news-wide/handler.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
  assert.deepEqual(source.match(/console\.\w+/g), ['console.log'], 'console is used only by the default log writer');
});

test('browsers: only the Pages origin and the local dev server; the same origins as the other account-only functions', async () => {
  const [{ ALLOWED_ORIGINS }] = await modules, ai = await import('../supabase/functions/haedo-ai/handler.mjs'), publish = await import('../supabase/functions/haedo-blog-publish/handler.mjs');
  assert.deepEqual([...ALLOWED_ORIGINS], [PAGES, 'http://127.0.0.1:4173', 'http://localhost:4173']);
  assert.deepEqual([...ALLOWED_ORIGINS], [...ai.ALLOWED_ORIGINS]); assert.deepEqual([...ALLOWED_ORIGINS], [...publish.ALLOWED_ORIGINS]);
  for (const origin of ALLOWED_ORIGINS) {
    const f = await fixture(), { reply } = await f.run(undefined, { Origin: origin });
    assert.equal(reply.status, 200); assert.equal(reply.headers.get('access-control-allow-origin'), origin); assert.equal(reply.headers.get('vary'), 'Origin');
    const preflight = await f.run(undefined, { Origin: origin, 'Access-Control-Request-Method': 'POST' }, 'OPTIONS');
    assert.equal(preflight.reply.status, 204); assert.equal(preflight.reply.headers.get('access-control-allow-origin'), origin);
    assert.equal(preflight.reply.headers.get('access-control-allow-headers'), 'authorization, apikey, content-type, x-client-info');
  }
  for (const origin of ['https://evil.example', 'https://wonchance-art.github.io.evil.example', 'http://127.0.0.1:4174', 'null', 'https://news.google.com']) {
    for (const method of ['POST', 'OPTIONS']) {
      const f = await fixture(), { reply, body } = await f.run(undefined, { Origin: origin }, method);
      assert.equal(reply.status, 403, origin); assert.deepEqual(body, { error: 'origin_not_allowed' });
      assert.equal(reply.headers.get('access-control-allow-origin'), null); assert.equal(f.calls.length, 0);
    }
  }
  // A harness port is construction-time configuration, never a request field.
  const harness = await fixture({ origins: ['http://127.0.0.1:4184'] });
  assert.equal((await harness.run(undefined, { Origin: 'http://127.0.0.1:4184' })).reply.status, 200);
  assert.equal((await harness.run(undefined, { Origin: PAGES })).reply.status, 403);
  // No Origin (not a browser page) still needs the session; other methods are refused.
  const f = await fixture();
  assert.equal((await f.run()).reply.headers.get('access-control-allow-origin'), null);
  for (const method of ['GET', 'PUT', 'DELETE']) { const g = await fixture(); assert.equal((await g.run(undefined, {}, method)).reply.status, 405); assert.equal(g.calls.length, 0); }
});

test('setup and key formats: new keys, legacy keys or both; a missing key, parser or migration is setup_required, not a guess', async () => {
  const [, , { serverHeaders }] = await modules;
  const LEGACY = { service: 'legacy-service-fixture', anon: 'legacy-anon-fixture' };
  const environments = { new: [ENV, NEW.publishable, NEW.secret], legacy: [{ SUPABASE_URL: PROJECT, SUPABASE_SERVICE_ROLE_KEY: LEGACY.service, SUPABASE_ANON_KEY: LEGACY.anon }, LEGACY.anon, LEGACY.service],
    both: [{ ...ENV, SUPABASE_SERVICE_ROLE_KEY: LEGACY.service, SUPABASE_ANON_KEY: LEGACY.anon }, NEW.publishable, NEW.secret] };
  for (const [name, [environment, publicKey, server]] of Object.entries(environments)) {
    const f = await fixture({ environment }), { reply } = await f.run();
    assert.equal(reply.status, 200, name);
    const pick = headers => Object.fromEntries(Object.entries(headers).filter(([key]) => ['apikey', 'Authorization'].includes(key)));
    assert.deepEqual(pick(f.calls[0].init.headers), { apikey: publicKey, Authorization: 'Bearer ' + TOKEN }, name);
    assert.deepEqual(pick(f.to('life_news_wide_claim')[0].init.headers), { apikey: publicKey, Authorization: 'Bearer ' + TOKEN }, name);
    assert.deepEqual(pick(f.to('life_news_wide_finish')[0].init.headers), serverHeaders(server), name);
    assert(!JSON.stringify(supplierCalls(f)).includes(server) && !JSON.stringify(supplierCalls(f)).includes(publicKey));
  }
  const unset = [{}, { SUPABASE_URL: PROJECT }, { ...ENV, SUPABASE_URL: 'http://project-fixture.supabase.co' }, { ...ENV, SUPABASE_URL: PROJECT + '/path' }, { ...ENV, SUPABASE_URL: 'not a url' },
    { SUPABASE_URL: PROJECT, SUPABASE_PUBLISHABLE_KEYS: ENV.SUPABASE_PUBLISHABLE_KEYS }, { SUPABASE_URL: PROJECT, SUPABASE_SECRET_KEYS: ENV.SUPABASE_SECRET_KEYS },
    { SUPABASE_URL: PROJECT, SUPABASE_SECRET_KEYS: JSON.stringify({ default: NEW.publishable }), SUPABASE_PUBLISHABLE_KEYS: ENV.SUPABASE_PUBLISHABLE_KEYS }];
  for (const environment of unset) {
    const f = await fixture({ environment }), { reply, body } = await f.run();
    assert.equal(reply.status, 503, JSON.stringify(Object.keys(environment))); assert.deepEqual(body, { error: 'setup_required' }); assert.equal(f.calls.length, 0);
  }
  const noParser = await fixture({ noParser: true }); assert.equal((await noParser.run()).reply.status, 503); assert.equal(noParser.calls.length, 0);
  const notInstalled = await fixture({ claimResponse: () => json({ message: 'Could not find the function' }, 404) }), answer = await notInstalled.run();
  assert.equal(answer.reply.status, 503); assert.deepEqual(answer.body, { error: 'setup_required' }); assert.equal(supplierCalls(notInstalled).length, 0);
});

test('cache answers are not trusted blindly: a changed echo, a bad lease or unsafe cached links never reach the client or the supplier', async () => {
  const wrong = [() => json({ entries: [] }), () => json({ entries: [{ topic: '다른주제', language: 'ko', status: 'claimed', leaseToken: LEASE(1) }] }),
    () => json({ entries: [{ topic: '기후', language: 'en', status: 'claimed', leaseToken: LEASE(1) }] }), () => json({ entries: [{ topic: '기후', language: 'ko', status: 'claimed', leaseToken: 'not-a-lease' }] }),
    () => json({ entries: [{ topic: '기후', language: 'ko', status: 'unknown' }] }), () => json({ entries: [{ topic: '기후', language: 'ko', status: 'fresh', items: null }] }),
    () => json({ entries: [{ topic: '기후', language: 'ko', status: 'fresh', items: [cachedItem(1)], fetchedAt: 'not a time' }] }), () => json([]), () => json(null), () => new Response('not json')];
  for (const claimResponse of wrong) {
    const f = await fixture({ claimResponse }), { reply, body } = await f.run();
    assert.equal(reply.status, 500); assert.deepEqual(body, { error: 'server_error' }); assert.equal(supplierCalls(f).length, 0);
  }
  const tampered = [cachedItem(1), { ...cachedItem(2), link: 'https://evil.example/phish' }, { ...cachedItem(3), link: 'javascript:alert(1)' }, { ...cachedItem(4), body: '<img src=x onerror=1>' },
    { ...cachedItem(5), sourceUrl: 'http://127.0.0.1/' }, { ...cachedItem(6), title: '줄\n바꿈' }];
  const f = await fixture({ claim: () => ({ status: 'fresh', items: tampered, fetchedAt: '2026-11-11T12:50:00Z' }) });
  assert.deepEqual((await f.run()).body.items.map(item => item.title), ['보관된 글 1']);
  // The database refusing the items (HTTP 400) gets exactly one error-only report; the refused items are not served.
  const refused = await fixture({ finishResponse: (body, attempt) => attempt === 1 ? json({ message: 'life_news_wide_invalid_items' }, 400)
    : json({ stored: 0, failed: body.p_results.length, stale: 0 }), claim: (pair, index) => ({ status: 'claimed', leaseToken: LEASE(index), ...(index === 0 ? { items: [cachedItem(9)], fetchedAt: '2026-11-11T09:00:00Z' } : {}) }) });
  const answer = await refused.run({ topics: ['기후', '날씨'], languages: ['ko'] });
  assert.equal(answer.reply.status, 200);
  assert.deepEqual(answer.body.topics.map(topic => [topic.status, topic.reason, topic.count]), [['stale', 'invalid_response', 1], ['failed', 'invalid_response', 0]]);
  const writes = refused.to('life_news_wide_finish').map(call => JSON.parse(call.init.body).p_results.map(row => [row.items === null, row.error]));
  assert.deepEqual(writes, [[[false, null], [false, null]], [[true, 'invalid_response'], [true, 'invalid_response']]]);
  // Any other storing failure is an error: nothing unconfirmed is presented as stored.
  for (const finishResponse of [() => new Response('PRIVATE', { status: 500 }), () => json({ stored: 5, failed: 0, stale: 0 }), () => json({ stored: 'x' }), () => { throw new Error('PRIVATE network'); }]) {
    const f = await fixture({ finishResponse }), { reply, body } = await f.run();
    assert.equal(reply.status, 500); assert.deepEqual(body, { error: 'server_error' }); assert.equal(f.to('life_news_wide_finish').length, 1);
  }
  // A lease that expired meanwhile ("stale" in the database) still returns what was fetched.
  const late = await fixture({ finishResponse: () => json({ stored: 0, failed: 0, stale: 1 }) });
  assert.deepEqual((await late.run()).body.topics.map(topic => [topic.status, topic.count]), [['fresh', 6]]);
});

test('work is bounded: at most 4 supplier calls in flight, and a spent time budget leaves the rest unattempted instead of late', async () => {
  const [{ BUDGET }] = await modules;
  assert.deepEqual({ ...BUDGET }, { deadline: 25000, reserve: 4000, minimumCall: 1000, rpc: 8000, auth: 5000 });
  const topics = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const f = await fixture();
  const { body } = await f.run({ topics, languages: ['ko', 'en'] });
  assert.equal(supplierCalls(f).length, 16); assert.equal(f.peak(), 4, 'four at a time');
  assert.equal(body.topics.length, 16); assert(body.topics.every(topic => topic.status === 'fresh'));
  assert(body.items.length <= 200);
  // Each clock reading advances 3 s: after a few calls the budget is gone.
  const slow = await fixture({ tick: 3000 });
  const answer = await slow.run({ topics, languages: ['ko', 'en'] });
  assert.equal(answer.reply.status, 200);
  const attempted = supplierCalls(slow).length, reported = JSON.parse(slow.to('life_news_wide_finish')[0].init.body).p_results;
  assert(attempted >= 1 && attempted < 16, 'some calls, not all: ' + attempted);
  assert.equal(reported.length, 16); assert.equal(reported.filter(row => row.error === 'not_attempted').length, 16 - attempted);
  assert.deepEqual(answer.body.topics.filter(topic => topic.reason === 'not_attempted').map(topic => topic.status), Array(16 - attempted).fill('failed'));
});

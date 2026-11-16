'use strict';
/* AI 추천 (news_pick, 2026-11-16, docs/design-review/news-pick.md): the haedo-ai task with its own allow list, and the
 * device module assets/life/discovery-pick.js with the account-guarded request in discovery-wide-remote.js.
 * No real provider, key, Auth or network: the provider, Auth and the usage RPCs are fakes injected into the handler,
 * shaped like tests/writing-ai.test.cjs (the usage fake follows supabase/migrations/20261104090000_life_ai_usage.sql).
 * Every topic, title and publisher name is made up. */
const test = require('node:test'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Pick = require('../assets/life/discovery-pick.js');
const Wide = require('../assets/life/discovery-wide-remote.js');
const Settings = require('../assets/life/discovery-settings.js');
const loadHandler = () => import('../supabase/functions/haedo-ai/handler.mjs');

const PROJECT = 'https://anonymous-ai.example.invalid';
const OWNER = randomUUID();
const SECRET = { provider: 'test-provider-' + randomUUID(), service: 'test-service-' + randomUUID(), publicKey: 'test-public-' + randomUUID(), session: 'eyJ0ZXN0.session-' + randomUUID() + '.signature' };
const PRICES = { 'claude-haiku-5-5': [100000, 500000], 'claude-sonnet-5-5': [2000000, 10000000] };
const cost = (model, input, output) => Math.ceil((input * PRICES[model][0] + output * PRICES[model][1]) / 1e6);
const TOPICS = ['합성 도서관', '합성 기후'];
const candidate = (n, change = {}) => ({ n, title: '합성 후보 제목 ' + n, publisher: '합성매체 ' + (n % 3), publishedAt: '2026-11-16T0' + (n % 10) + ':00:00.000Z', ...change });
const pickBody = (change = {}, count = 5) => ({ requestId: randomUUID(), task: 'news_pick', topics: [...TOPICS], candidates: Array.from({ length: count }, (_, i) => candidate(i + 1)), ...change });

/* Fake world: Auth, usage RPCs and the provider. `used` is what the project already spent this month. */
function world({ provider, used = 0, user = { id: OWNER, role: 'authenticated' } } = {}) {
  const state = { cost: used, reserved: 0, reservations: new Map(), calls: [], providerBodies: [], logs: [], rpc: [] };
  const env = { SUPABASE_URL: PROJECT, SUPABASE_SERVICE_ROLE_KEY: SECRET.service, SUPABASE_ANON_KEY: SECRET.publicKey, ANTHROPIC_API_KEY: SECRET.provider, HAEDO_AI_OWNER_ID: OWNER };
  const rpc = {
    life_ai_reserve({ p_request_id, p_model, p_max_input_tokens, p_max_output_tokens }) {
      if (state.reservations.has(p_request_id)) return { status: 'duplicate' };
      const reserved = cost(p_model, p_max_input_tokens, p_max_output_tokens);
      if (state.cost + state.reserved + reserved > 10000000) return { status: 'limit' };
      state.reservations.set(p_request_id, { model: p_model, reserved, status: 'reserved', maxIn: p_max_input_tokens, maxOut: p_max_output_tokens });
      state.reserved += reserved;
      return { status: 'reserved', reserved_micro_usd: reserved, remaining_micro_usd: 10000000 - state.cost - state.reserved };
    },
    life_ai_settle({ p_request_id, p_input_tokens, p_output_tokens }) {
      const r = state.reservations.get(p_request_id); assert(r);
      if (r.status !== 'reserved') return { status: 'already_finished' };
      const actual = cost(r.model, p_input_tokens, p_output_tokens);
      state.reserved -= r.reserved; state.cost += actual; Object.assign(r, { status: 'settled', cost: actual, input: p_input_tokens, output: p_output_tokens });
      return { status: 'settled', cost_micro_usd: actual, reserved_micro_usd: r.reserved, remaining_micro_usd: 10000000 - state.cost - state.reserved };
    },
    life_ai_release({ p_request_id }) {
      const r = state.reservations.get(p_request_id); assert(r);
      if (r.status !== 'reserved') return { status: 'already_finished' };
      state.reserved -= r.reserved; r.status = 'released'; return { status: 'released' };
    },
  };
  const fetcher = async (url, options) => {
    state.calls.push(url);
    if (url === PROJECT + '/auth/v1/user') return options.headers.Authorization === 'Bearer ' + SECRET.session ? Response.json(user) : new Response('{}', { status: 401 });
    if (url.startsWith(PROJECT + '/rest/v1/rpc/')) {
      const name = url.slice((PROJECT + '/rest/v1/rpc/').length), args = JSON.parse(options.body);
      state.rpc.push([name, args]); return Response.json(rpc[name](args));
    }
    if (url === 'https://api.anthropic.com/v1/messages') {
      assert.deepEqual(Object.keys(options.headers).sort(), ['anthropic-version', 'content-type', 'x-api-key']);
      const body = JSON.parse(options.body); state.providerBodies.push({ raw: options.body, body });
      return provider(body);
    }
    throw new Error('unexpected fetch ' + url);
  };
  return { state, env, fetcher };
}
const message = (value, { stop = 'end_turn', usage = { input_tokens: 4200, output_tokens: 700 } } = {}) => Response.json({
  id: 'msg_synthetic', type: 'message', role: 'assistant', model: 'synthetic', stop_reason: stop, usage,
  content: [{ type: 'thinking', thinking: '', signature: 'synthetic' }, { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });
const CONSOLE = ['log', 'error', 'warn', 'info', 'debug', 'trace', 'dir', 'table'];
async function handlerFor(w) {
  const { createHandler } = await loadHandler();
  const handler = createHandler({ fetcher: w.fetcher, environment: name => w.env[name], log: entry => w.state.logs.push(entry), now: () => Date.parse('2026-11-16T00:00:00Z') });
  return async request => {
    const saved = CONSOLE.map(name => [name, console[name]]), calls = [];
    for (const name of CONSOLE) console[name] = (...args) => { calls.push(name + ' ' + args.map(String).join(' ').slice(0, 60)); };
    try { return await handler(request); } finally { for (const [name, fn] of saved) console[name] = fn; assert.deepEqual(calls, [], 'the handler wrote to the console'); }
  };
}
const post = (body, { origin = null } = {}) => new Request('https://anonymous-edge.example.invalid/', { method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SECRET.session, ...(origin ? { Origin: origin } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) });
function assertCleanLogs(logs) {
  for (const entry of logs) assert.deepEqual(Object.keys(entry).sort(), ['at', 'inputTokens', 'model', 'outputTokens', 'requestId', 'status', 'task']);
  const text = JSON.stringify(logs);
  for (const fragment of ['합성', '후보', '도서관', '기후', '매체', SECRET.provider, SECRET.service, SECRET.session, OWNER]) assert(!text.includes(fragment), 'a log entry holds request text: ' + fragment);
}

test('news_pick allow list: exactly requestId, task, topics and {n, title, publisher, publishedAt} candidates (no language); likes, IDs and links are refused', async () => {
  const { validatePickInput, validateInput } = await loadHandler();
  const good = pickBody();
  assert.deepEqual(validateInput(good), { ...good, requestId: good.requestId.toLowerCase() });
  assert.deepEqual(validateInput(pickBody({ topics: [] })).topics, [], 'no typed topic is allowed (a general pick)');
  const withCandidate = change => pickBody({ candidates: [candidate(1, change), candidate(2)] });
  const bad = [
    pickBody({ liked: ['합성 좋아요 제목'] }), pickBody({ likes: [] }), pickBody({ saved: [] }), pickBody({ readUrls: [] }), pickBody({ userId: OWNER }), pickBody({ workspaceId: 'w' }),
    pickBody({ postId: randomUUID() }), pickBody({ email: 'anonymous@example.invalid' }), pickBody({ device: 'iPhone' }), pickBody({ model: 'claude-opus-5-5' }), pickBody({ max_tokens: 99999 }),
    pickBody({ selection: '선택' }), pickBody({ guidance: '지침' }), pickBody({ instruction: '요청' }), pickBody({ sources: ['발췌'] }),
    withCandidate({ url: 'https://www.synthetic.example/a' }), withCandidate({ canonicalUrl: 'https://www.synthetic.example/a' }), withCandidate({ liked: true }), withCandidate({ id: 'a1' }), withCandidate({ summary: '요약' }),
    pickBody({ candidates: [candidate(2), candidate(1)] }), pickBody({ candidates: [candidate(1), candidate(1)] }), pickBody({ candidates: [candidate(0)] }), pickBody({ candidates: [] }),
    pickBody({}, 151), withCandidate({ title: '가'.repeat(301) }), withCandidate({ title: '  ' }), withCandidate({ publisher: '' }), withCandidate({ publisher: '나'.repeat(101) }), withCandidate({ title: '줄\n바꿈' }),
    withCandidate({ publishedAt: 'yesterday' }), withCandidate({ publishedAt: 1731700000000 }), withCandidate({ n: '1' }),
    pickBody({ topics: ['가'.repeat(41)] }), pickBody({ topics: Array.from({ length: 9 }, (_, i) => '주제 ' + i) }), pickBody({ topics: ['Same', 'same'] }), pickBody({ topics: [' 앞 공백'] }), pickBody({ topics: [{ label: '객체' }] }),
    pickBody({ language: 'ko' }), pickBody({ language: 'any' }), pickBody({ languages: ['ko'] }), { ...pickBody(), requestId: 'not-a-uuid' },
    (({ topics, ...rest }) => rest)(pickBody()), (({ candidates, ...rest }) => rest)(pickBody()), (({ requestId, ...rest }) => rest)(pickBody()),
  ];
  for (const body of bad) {
    assert.throws(() => validatePickInput(body), e => e.code === 'invalid_request', JSON.stringify(body).slice(0, 90));
    assert.throws(() => validateInput(body), e => e.code === 'invalid_request');
  }
  // The writing tasks keep their own list: news_pick's fields are unknown keys there.
  for (const extra of [{ topics: TOPICS }, { language: 'ko' }, { candidates: [candidate(1)] }])
    assert.throws(() => validateInput({ requestId: randomUUID(), task: 'polish', selection: '합성 문장', ...extra }), e => e.code === 'invalid_request');
  // Refused before Auth, reservation or provider.
  const w = world({ provider: () => assert.fail('provider called') }), handler = await handlerFor(w);
  for (const body of bad.slice(0, 20)) { const response = await handler(post(body)); assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'invalid_request' }); }
  assert.deepEqual(w.state.calls, []);
});

test('news_pick: Haiku 5.5 at low effort, structured numbers-only answer, worst case reserved, real usage settled, logs without text', async () => {
  const { PICK, INPUT_TOKEN_OVERHEAD, MODELS } = await loadHandler();
  const w = world({ provider: () => message({ picks: [{ n: 3, reason: '관심 주제와 맞는 새 소식' }, { n: 1, reason: '' }], clusters: [[1, 4]] }) }), handler = await handlerFor(w);
  const body = pickBody();
  const response = await handler(post(body, { origin: 'https://wonchance-art.github.io' }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://wonchance-art.github.io');
  const answer = await response.json();
  assert.deepEqual({ ...answer, usage: undefined }, { status: 'ok', requestId: body.requestId, task: 'news_pick', model: MODELS.haiku,
    picks: [{ n: 3, reason: '관심 주제와 맞는 새 소식' }, { n: 1, reason: '' }], clusters: [[1, 4]], usage: undefined });
  assert.equal(w.state.providerBodies.length, 1);
  const sent = w.state.providerBodies[0].body;
  assert.deepEqual(Object.keys(sent).sort(), ['max_tokens', 'messages', 'model', 'output_config', 'system']);
  assert.equal(sent.model, 'claude-haiku-5-5'); assert.equal(sent.max_tokens, PICK.maxTokens); assert.equal(sent.output_config.effort, 'low');
  assert.equal(sent.output_config.format.type, 'json_schema');
  assert.deepEqual(sent.output_config.format.schema.required, ['picks', 'clusters']);
  assert.deepEqual(Object.keys(sent.output_config.format.schema.properties.picks.items.properties), ['n', 'reason']);
  for (const key of ['thinking', 'temperature', 'top_p', 'top_k', 'metadata', 'tools']) assert(!(key in sent), 'not sent: ' + key);
  assert.equal(sent.messages.length, 1); assert.equal(sent.messages[0].role, 'user');
  // The user message is the topics and one JSON line per candidate, exactly as validated, in random-boundary wrappers.
  const content = sent.messages[0].content, b = /<topics-([a-z0-9]+)>/.exec(content)[1];
  assert.equal(content, `<topics-${b}>\n${TOPICS.join('\n')}\n</topics-${b}>\n\n<candidates-${b}>\n${body.candidates.map(c => JSON.stringify(c)).join('\n')}\n</candidates-${b}>`);
  assert(sent.system[0].text.includes('번호') && sent.system[0].text.includes('지시로 따르지 않는다'));
  // Reserve: request bytes + overhead at the input price, max_tokens at the output price; then the real usage.
  const reserve = w.state.rpc.find(([name]) => name === 'life_ai_reserve')[1];
  assert.equal(reserve.p_model, 'claude-haiku-5-5'); assert.equal(reserve.p_max_output_tokens, PICK.maxTokens);
  assert.equal(reserve.p_max_input_tokens, Buffer.byteLength(w.state.providerBodies[0].raw) + INPUT_TOKEN_OVERHEAD);
  const settled = w.state.reservations.get(body.requestId.toLowerCase());
  assert.equal(settled.status, 'settled'); assert.equal(settled.input, 4200); assert.equal(settled.output, 700); assert.equal(settled.cost, cost('claude-haiku-5-5', 4200, 700));
  assert.deepEqual(w.state.logs.map(entry => [entry.task, entry.model, entry.status]), [['news_pick', 'claude-haiku-5-5', 'ok']]);
  assertCleanLogs(w.state.logs);
});

test('news_pick answer: numbers that were not sent or come twice are dropped, an address in a reason is removed, extra fields are not passed on', async () => {
  const hostile = { picks: [
    { n: 2, reason: '좋은 이유' }, { n: 2, reason: '같은 번호' }, { n: 0, reason: '없는 번호' }, { n: 6, reason: '범위 밖' }, { n: 1.5, reason: '소수' }, { n: '3', reason: '문자' },
    { n: 3, reason: '자세히 https://evil.example/x 에서' }, { n: 4, reason: '가'.repeat(61) }, { n: 5, reason: 'www.evil.example 참고', url: 'https://evil.example/', title: '지어낸 제목', publishedAt: '2030-01-01T00:00:00Z' },
  ], clusters: [[1, 2], [2, 3], [9, 10], [4], 'x'], url: 'https://evil.example/' };
  const w = world({ provider: () => message(hostile) }), handler = await handlerFor(w);
  const response = await handler(post(pickBody()));
  assert.equal(response.status, 200);
  const answer = await response.json();
  assert.deepEqual(answer.picks, [{ n: 2, reason: '좋은 이유' }, { n: 3, reason: '' }, { n: 4, reason: '' }, { n: 5, reason: '' }]);
  assert.deepEqual(answer.clusters, [[1, 2]]);
  assert(!JSON.stringify(answer).includes('evil') && !JSON.stringify(answer).includes('지어낸'), 'no model address or title reaches the device');
  // Nothing usable: ai_invalid_response, billed as usual.
  for (const value of [{ picks: [{ n: 99, reason: '' }], clusters: [] }, { picks: [], clusters: [] }, { picks: 'x', clusters: [] }, { suggestion: 'x', reason: 'y' }, '{not json']) {
    const w2 = world({ provider: () => message(value) }), h2 = await handlerFor(w2), body = pickBody();
    const r = await h2(post(body)); assert.equal(r.status, 502); assert.deepEqual(await r.json(), { error: 'ai_invalid_response' });
    assert.equal(w2.state.reservations.get(body.requestId).status, 'settled');
  }
});

test('news_pick leaves half of the monthly cap to writing; busy and refused answers are told apart; the cap still holds', async () => {
  // 5.0 USD already spent: a pick would leave less than the floor, so it is released and never sent.
  const low = world({ used: 5000000, provider: () => assert.fail('provider called below the floor') }), lowHandler = await handlerFor(low), body = pickBody();
  let response = await lowHandler(post(body));
  assert.equal(response.status, 429); assert.deepEqual(await response.json(), { error: 'ai_monthly_limit' });
  assert.equal(low.state.reservations.get(body.requestId).status, 'released'); assert.equal(low.state.reserved, 0);
  // Just above the floor after the reservation: sent.
  const { NEWS_PICK_FLOOR_MICRO_USD } = await loadHandler();
  assert.equal(NEWS_PICK_FLOOR_MICRO_USD, 5000000);
  const ok = world({ used: 4900000, provider: () => message({ picks: [{ n: 1, reason: '' }], clusters: [] }) });
  response = await (await handlerFor(ok))(post(pickBody())); assert.equal(response.status, 200);
  // The writing tasks keep the whole cap.
  const writing = world({ used: 5000000, provider: () => message({ suggestion: '합성', reason: '합성' }) });
  response = await (await handlerFor(writing))(post({ requestId: randomUUID(), task: 'polish', selection: '합성 문장' })); assert.equal(response.status, 200);
  for (const [status, code] of [[429, 'ai_busy'], [529, 'ai_busy'], [401, 'ai_not_configured'], [500, 'ai_upstream_error']]) {
    const w = world({ provider: () => new Response('{"echo":"합성"}', { status }) }), b = pickBody();
    const r = await (await handlerFor(w))(post(b)); assert.deepEqual(await r.json(), { error: code });
    assert.equal(w.state.reservations.get(b.requestId).status, 'released');
    assertCleanLogs(w.state.logs);
  }
  const refused = world({ provider: () => message('', { stop: 'refusal' }) });
  response = await (await handlerFor(refused))(post(pickBody())); assert.deepEqual(await response.json(), { error: 'ai_refused' });
  const other = world({ user: { id: randomUUID(), role: 'authenticated' }, provider: () => assert.fail('provider called for another account') });
  response = await (await handlerFor(other))(post(pickBody())); assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: 'ai_not_allowed' });
});

// ---- device module -------------------------------------------------------------------------------------------------
const NOW = Date.parse('2026-11-16T09:00:00.000Z');
const hours = h => new Date(NOW - h * 3600000).toISOString();
const article = (n, change = {}) => ({ id: 'a' + n, canonicalUrl: 'https://www.synthetic-daily.example/' + n, url: 'https://www.synthetic-daily.example/' + n, title: '합성 기사 ' + n,
  sourceName: '합성일보', sourceId: 'synthetic', publishedAt: hours(n), dateStatus: 'valid', ...change });
const wideArticle = (n, change = {}) => article(n, { sourceId: 'google-news', canonicalUrl: 'https://news.google.com/rss/articles/SYN' + n, url: 'https://news.google.com/rss/articles/SYN' + n, sourceName: '합성넓게매체', ...change });
const isWide = value => value.sourceId === 'google-news';

test('candidates: one per address, https only, found links within 72 hours, newest first, at most 150', () => {
  const rows = [article(5), article(1), article(1, { title: '같은 주소' }), article(2, { url: 'http://www.synthetic-daily.example/2' }), article(3, { url: 'javascript:alert(1)', canonicalUrl: 'javascript:alert(1)' }),
    article(4, { title: '   ' }), article(6, { publishedAt: null, dateStatus: 'unknown' }), wideArticle(7), wideArticle(80), wideArticle(9, { publishedAt: null, dateStatus: 'unknown' }),
    wideArticle(10, { publishedAt: new Date(NOW + 3600000).toISOString() }), article(11, { sourceName: '' }), article(12, { title: '가'.repeat(301) })].map(value => ({ article: value }));
  const list = Pick.candidates(rows, { now: NOW, isWide });
  assert.deepEqual(list.map(c => c.title), ['합성 기사 1', '합성 기사 5', '합성 기사 7', '합성 기사 6']);
  assert.deepEqual(Object.keys(list[0]), ['canonicalUrl', 'title', 'publisher', 'publishedAt']);
  assert.equal(list.at(-1).publishedAt, null, 'a fixed-source article without a time is kept, last');
  const many = Array.from({ length: 400 }, (_, i) => ({ article: article(i + 1, { publishedAt: new Date(NOW - i * 60000).toISOString() }) }));
  assert.equal(Pick.candidates(many, { now: NOW, isWide }).length, 150);
});

test('prepare: the body is exactly the five allow-listed fields; candidates are numbered and stop at the byte budget', () => {
  const list = Array.from({ length: 150 }, (_, i) => ({ canonicalUrl: 'https://www.synthetic-daily.example/' + i, title: '가'.repeat(200) + i, publisher: '나'.repeat(40), publishedAt: hours(i) }));
  const prepared = Pick.prepare({ requestId: randomUUID(), topics: TOPICS, candidates: list });
  assert.deepEqual(Object.keys(prepared.body), ['requestId', 'task', 'topics', 'candidates']);
  assert(prepared.body.candidates.length < 150 && prepared.body.candidates.length > 20, 'long titles stop at the budget: ' + prepared.body.candidates.length);
  assert(Buffer.byteLength(JSON.stringify(prepared.body)) <= Pick.LIMITS.bytes);
  prepared.body.candidates.forEach((c, i) => { assert.deepEqual(Object.keys(c), ['n', 'title', 'publisher', 'publishedAt']); assert.equal(c.n, i + 1); assert.equal(prepared.sent.get(c.n), list[i].canonicalUrl); });
  const json = JSON.stringify(prepared.body);
  assert(!json.includes('https://'), 'no address leaves the device');
  assert.equal(prepared.provider, 'Anthropic'); assert.equal(prepared.model, 'claude-haiku-5-5');
  for (const bad of [{ topics: ['가'.repeat(41)] }, { topics: Array(9).fill('주제') }, { requestId: 'x' }, { candidates: [] }])
    assert.throws(() => Pick.prepare({ requestId: randomUUID(), topics: TOPICS, candidates: list.slice(0, 2), ...bad }));
  // Even if a caller passes a language, it is not part of the body.
  assert(!('language' in Pick.prepare({ requestId: randomUUID(), topics: TOPICS, language: 'ko', candidates: list.slice(0, 2) }).body));
});

test('topics and key: the typed and checked topics only, first eight; likes, saved items and inferred words have no way in', () => {
  const profile = { workspaceId: 'w', manual: [{ id: 'i1', label: ' 합성  도서관 ' }, { id: 'i2', label: '꺼 둔 주제' }, { id: 'i3', label: '합성 도서관' }, { id: 'i4', label: '' }, { id: 'i5', label: 'site:a "b"' },
    ...Array.from({ length: 10 }, (_, i) => ({ id: 'm' + i, label: '주제 ' + i }))], inferred: [{ label: '자동 낱말' }], liked: ['좋아요 제목'] };
  const settings = Settings.update(Settings.empty('w'), { disabledInterestIds: ['i2'], newsPick: true }, { expectedRevision: 0, now: '2026-11-16T00:00:00.000Z' });
  const topics = Pick.topics(Settings.effectiveProfile(profile, settings).manual);
  assert.deepEqual(topics, ['합성 도서관', 'site:a "b"', '주제 0', '주제 1', '주제 2', '주제 3', '주제 4', '주제 5']);
  for (const bad of [null, 'x', [{ id: 'x' }]]) assert.throws(() => Pick.topics(bad));
  // The key changes with the topics, the content-language choice and 넓게 찾기 on/off (none of the last two is sent).
  const key = Pick.requestKey(['가'], ['ko', 'en'], false);
  assert.equal(key, Pick.requestKey(['가'], ['en', 'ko'], false));
  for (const other of [Pick.requestKey(['나'], ['ko', 'en'], false), Pick.requestKey(['가'], ['ko'], false), Pick.requestKey(['가'], null, false), Pick.requestKey(['가'], ['ko', 'en'], true)]) assert.notEqual(other, key);
  // The option is a reserved entry an older settings model keeps (like 넓게 찾기), off by default.
  assert.equal(Settings.DEFAULT_NEWS_PICK, false); assert.equal(Settings.newsPick(Settings.empty('w')), false);
  assert.deepEqual(settings.disabledSourceIds, ['option-pick-on']);
  const off = Settings.update(settings, { newsPick: false }, { expectedRevision: 1, now: '2026-11-16T00:01:00.000Z' });
  assert.deepEqual(off.disabledSourceIds, ['option-pick-off']); assert.equal(Settings.newsPick(off), false);
  assert.throws(() => Settings.validate({ ...settings, disabledSourceIds: ['option-pick-on', 'option-pick-off'] }), { code: 'discovery_settings_invalid' });
});

test('read: only numbers that were sent count; the device renders its own candidate for each, never a model address, title or date', () => {
  const list = [1, 2, 3, 4].map(n => ({ canonicalUrl: 'https://www.synthetic-daily.example/' + n, title: '합성 기사 ' + n, publisher: '합성일보', publishedAt: hours(n) }));
  const prepared = Pick.prepare({ requestId: randomUUID(), topics: TOPICS, candidates: list });
  const raw = { status: 'ok', requestId: prepared.body.requestId, task: 'news_pick', model: 'claude-haiku-5-5',
    picks: [{ n: 2, reason: '좋은 이유', url: 'https://evil.example/' }, { n: 2, reason: '다시' }, { n: 7, reason: '보내지 않은 번호' }, { n: 3, reason: 'https://evil.example 참고' }, { n: 1, title: '지어낸 제목', reason: '' }],
    clusters: [[2, 4], [1, 99]], usage: { inputTokens: 1, outputTokens: 1, remainingMicroUsd: 1 } };
  const answer = Pick.read(raw, prepared);
  assert.deepEqual(answer, { picks: [{ canonicalUrl: list[1].canonicalUrl, reason: '좋은 이유' }, { canonicalUrl: list[2].canonicalUrl, reason: '' }, { canonicalUrl: list[0].canonicalUrl, reason: '' }],
    clusters: [[list[1].canonicalUrl, list[3].canonicalUrl]] });
  assert(!JSON.stringify(answer).includes('evil') && !JSON.stringify(answer).includes('지어낸'));
  for (const bad of [{ ...raw, requestId: randomUUID() }, { ...raw, task: 'polish' }, { ...raw, status: 'error' }, { ...raw, picks: [{ n: 9, reason: '' }] }, { ...raw, picks: 'x' }, null])
    assert.throws(() => Pick.read(bad, prepared), { code: 'wide_invalid' });
  // Order: picked rows first (one per cluster), the rest keep their place; a pick no longer listed is skipped.
  const rows = [1, 2, 3, 4, 5].map(n => ({ article: article(n) }));
  const ordered = Pick.order(rows, { picks: [{ canonicalUrl: article(4).canonicalUrl, reason: 'r4' }, { canonicalUrl: article(2).canonicalUrl, reason: '' }, { canonicalUrl: article(9).canonicalUrl, reason: '' }, { canonicalUrl: article(5).canonicalUrl, reason: '' }],
    clusters: [[article(4).canonicalUrl, article(2).canonicalUrl]] });
  assert.deepEqual(ordered.map(row => [row.article.id, row.pick?.reason ?? null]), [['a4', 'r4'], ['a5', ''], ['a1', null], ['a2', null], ['a3', null]]);
  assert.equal(Pick.order(rows, null), rows);
});

test('daily count: at most twelve picks a day on a device; storage holds a date and a count only, and a blocked storage still counts', () => {
  const values = new Map(), store = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let now = Date.parse('2026-11-16T10:00:00'), counter = Pick.counter({ store, now: () => now });
  for (let i = 0; i < 12; i++) assert.equal(counter.take(), true);
  assert.equal(counter.take(), false); assert.equal(counter.remaining(), 0);
  assert.deepEqual([...values.keys()], [Pick.COUNT_KEY]); assert.deepEqual(JSON.parse(values.get(Pick.COUNT_KEY)), { day: '2026-11-16', count: 12 });
  // Another screen on the same device reads the same count; the next day starts again.
  assert.equal(Pick.counter({ store, now: () => now }).take(), false);
  now += 24 * 3600000; assert.equal(counter.remaining(), 12); assert.equal(counter.take(), true);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, memory = Pick.counter({ store: blocked, now: () => now });
  for (let i = 0; i < 12; i++) assert.equal(memory.take(), true);
  assert.equal(memory.take(), false);
});

// ---- device request -> handler (end to end) -------------------------------------------------------------------------
const userId = '11111111-1111-4111-8111-111111111111', projectUrl = 'https://synthetic.supabase.co', workspaceId = 'synthetic-pick';
function remote(fetcher) {
  const listeners = new Set(), owner = { userId, projectUrl };
  const auth = { config: { url: projectUrl, key: 'sb_publishable_synthetic_pick_key' }, user: { id: userId }, epoch: 1,
    getAccount: () => owner, verify: async () => ({ id: userId }), onAccountChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    client: { auth: { getSession: async () => ({ data: { session: { user: { id: userId }, access_token: SECRET.session } }, error: null }) } } };
  let current = true;
  return { remote: Wide.create({ auth, storage: { isAccountScoped: true, account: { ...owner } }, fetcher, isCurrent: () => current }), leave() { current = false; },
    switchAccount() { owner.userId = '22222222-2222-4222-8222-222222222222'; auth.user.id = owner.userId; auth.epoch++; for (const fn of listeners) fn(); } };
}
const preparedFor = () => Pick.prepare({ requestId: randomUUID(), topics: TOPICS,
  candidates: [1, 2, 3].map(n => ({ canonicalUrl: 'https://www.synthetic-daily.example/' + n, title: '합성 기사 ' + n, publisher: '합성일보', publishedAt: hours(n) })) });
const json = (data, init = {}) => new Response(typeof data === 'string' ? data : JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

test('end to end: the device body reaches the handler byte for byte, and the screen gets its own candidates back', async () => {
  const w = world({ provider: () => message({ picks: [{ n: 3, reason: '새 소식' }, { n: 1, reason: '' }], clusters: [] }) }), handler = await handlerFor(w);
  const seen = [];
  const { remote: client } = remote(async (address, options) => {
    seen.push({ address, options });
    assert.equal(address, projectUrl + '/functions/v1/haedo-ai');
    assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error'); assert.equal(options.referrerPolicy, 'no-referrer');
    const response = await handler(new Request('https://anonymous-edge.example.invalid/', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: options.headers.Authorization }, body: options.body }));
    return new Response(await response.text(), { status: response.status, headers: { 'content-type': 'application/json' } });
  });
  const prepared = preparedFor();
  const answer = await client.pick({ body: prepared.body, read: raw => Pick.read(raw, prepared), workspaceId });
  assert.deepEqual(answer.picks.map(pick => pick.canonicalUrl), ['https://www.synthetic-daily.example/3', 'https://www.synthetic-daily.example/1']);
  assert.equal(seen.length, 1); assert.equal(seen[0].options.body, JSON.stringify(prepared.body));
  const provider = w.state.providerBodies[0].raw;
  for (const word of ['https://', 'synthetic-daily', userId, workspaceId]) assert(!provider.includes(word), 'not sent to the provider: ' + word);
  assertCleanLogs(w.state.logs);
  // The request shape is checked on the device too: a body with an extra field never leaves.
  await assert.rejects(client.pick({ body: { ...prepared.body, liked: [] }, read: () => ({}), workspaceId }), { code: 'wide_refused' });
  assert.equal(seen.length, 1);
});

test('failures fall back: monthly limit, busy, network, timeout-like and malformed answers; another account is told apart; late answers are dropped', async () => {
  const cases = [
    [429, { error: 'ai_monthly_limit' }, 'pick_limit'], [503, { error: 'ai_busy' }, 'wide_unavailable'], [503, { error: 'ai_not_configured' }, 'wide_unavailable'],
    [403, { error: 'ai_not_allowed' }, 'pick_not_allowed'], [403, { error: 'origin_not_allowed' }, 'wide_refused'], [400, { error: 'invalid_request' }, 'wide_refused'],
    [401, { error: 'unauthorized' }, 'wide_auth'], [502, { error: 'ai_invalid_response' }, 'wide_unavailable'], [422, { error: 'ai_refused' }, 'wide_unavailable'],
  ];
  for (const [status, body, code] of cases) {
    const prepared = preparedFor();
    await assert.rejects(remote(async () => json(body, { status })).remote.pick({ body: prepared.body, read: raw => Pick.read(raw, prepared), workspaceId }), error => error.code === code, status + ' ' + body.error);
  }
  let prepared = preparedFor();
  await assert.rejects(remote(async () => { throw new TypeError('Failed to fetch'); }).remote.pick({ body: prepared.body, read: raw => Pick.read(raw, prepared), workspaceId }), { code: 'wide_unavailable' });
  await assert.rejects(remote(async () => json('{"status":')).remote.pick({ body: prepared.body, read: raw => Pick.read(raw, prepared), workspaceId }), { code: 'wide_invalid' });
  await assert.rejects(remote(async () => json({ status: 'ok', requestId: randomUUID(), task: 'news_pick', picks: [{ n: 1, reason: '' }], clusters: [] })).remote.pick({ body: prepared.body, read: raw => Pick.read(raw, prepared), workspaceId }), { code: 'wide_invalid' });
  // The account changes while the pick is on its way: the answer is not used.
  let release; const gate = new Promise(resolve => { release = resolve; });
  prepared = preparedFor();
  const h = remote(async () => { await gate; return json({ status: 'ok', requestId: prepared.body.requestId, task: 'news_pick', picks: [{ n: 1, reason: '' }], clusters: [] }); });
  const pending = h.remote.pick({ body: prepared.body, read: raw => Pick.read(raw, prepared), workspaceId });
  await new Promise(resolve => setImmediate(resolve)); h.switchAccount(); release();
  await assert.rejects(pending, { code: 'wide_cancelled' });
  let release2; const gate2 = new Promise(resolve => { release2 = resolve; });
  const h2 = remote(async () => { await gate2; return json({ status: 'ok', requestId: prepared.body.requestId, task: 'news_pick', picks: [{ n: 1, reason: '' }], clusters: [] }); });
  const pending2 = h2.remote.pick({ body: prepared.body, read: raw => Pick.read(raw, prepared), workspaceId });
  await new Promise(resolve => setImmediate(resolve)); h2.leave(); release2();
  await assert.rejects(pending2, { code: 'wide_cancelled' });
  assert.match(Wide.messages.pick_not_allowed, /AI 추천/);
});

test('public catalog: no found link and no pick result is in it or can be published; article images stay off by default', () => {
  const fs = require('node:fs'), path = require('node:path'), Discovery = require('../assets/life/discovery.js');
  const raw = fs.readFileSync(path.join(__dirname, '../assets/life/discovery-feed.json'), 'utf8'), catalog = JSON.parse(raw);
  const all = [...catalog.articles, ...(catalog.extended?.articles || [])], sources = [...catalog.sources, ...(catalog.extended?.sources || [])];
  assert(all.length > 0);
  assert.equal(all.filter(article => article.sourceId === Discovery.WIDE_SOURCE.id || /news\.google\.com/.test(article.url)).length, 0, 'no found link');
  assert.equal(sources.filter(source => source.id === Discovery.WIDE_SOURCE.id).length, 0);
  assert.equal(all.filter(article => ['pick', 'picks', 'reason', 'clusters'].some(key => Object.hasOwn(article, key))).length, 0, 'no pick result');
  for (const word of ['news_pick', '"picks"', 'claude-haiku']) assert(!raw.includes(word), 'not in the public file: ' + word);
  // The browser and the publish gate share this validator: a catalog naming the 넓게 찾기 supplier as a source is refused.
  const forged = structuredClone(catalog); forged.sources.push({ ...catalog.sources[0], id: Discovery.WIDE_SOURCE.id, url: 'https://news.google.com/', feedUrl: 'https://news.google.com/rss' });
  assert.throws(() => Discovery.validateFeed(forged, { now: Date.now() }), { code: 'discovery_feed_invalid' });
  // Neither collector nor publish gate knows the pick request.
  for (const file of ['scripts/update-discovery-feed.py', 'scripts/refresh-discovery-artifact.cjs']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    for (const word of ['haedo-ai', 'news_pick', 'DiscoveryPick', 'haedo-news-wide']) assert(!source.includes(word), file + ' mentions ' + word);
  }
  // Owner decision 3 (2026-11-16): article images stay off until chosen.
  assert.equal(Settings.DEFAULT_SHOW_IMAGES, false); assert.equal(Settings.showImages(Settings.empty('w')), false);
});

test('reasons: the server and the device take out the same controls, direction marks and zero-width characters, then check', async () => {
  const { cleanReason, pickResult } = await loadHandler();
  const samples = [
    '보통 이유', '  앞뒤 공백  ', 'C1\u0085제어\u009f', '방향‮제어‪‫‬‭', '격리⁦⁧⁨⁩', '표시‎‏؜', '폭없음​‌‍⁠﻿',
    'evil​.com 참고', 'w​ww.evil.example', 'ht⁠tps://evil.example', '줄\n바꿈\t탭\u0000', '‮​', '<b>태그</b>', '가'.repeat(60) + '​', '가'.repeat(61),
  ];
  const expected = ['보통 이유', '앞뒤 공백', 'C1제어', '방향제어', '격리', '표시', '폭없음', 'evil.com 참고', 'www.evil.example', 'https://evil.example', '줄바꿈탭', '', '<b>태그</b>', '가'.repeat(60), '가'.repeat(61)];
  assert.deepEqual(samples.map(cleanReason), expected);
  assert.deepEqual(samples.map(Pick.cleanReason), expected, 'the device uses the same list');
  // After cleaning: an address, a tag sign or more than 60 characters leaves the reason empty, on both sides.
  const kept = ['보통 이유', '앞뒤 공백', 'C1제어', '방향제어', '격리', '표시', '폭없음', '', '', '', '줄바꿈탭', '', '', '가'.repeat(60), ''];
  const body = pickBody({}, samples.length), server = pickResult(body, { picks: samples.map((reason, i) => ({ n: i + 1, reason })), clusters: [] });
  assert.deepEqual(server.picks.map(pick => pick.reason), kept);
  const list = samples.map((_, i) => ({ canonicalUrl: 'https://www.synthetic-daily.example/r' + i, title: '합성 ' + i, publisher: '합성일보', publishedAt: null }));
  const prepared = Pick.prepare({ requestId: randomUUID(), topics: [], candidates: list });
  const device = Pick.read({ status: 'ok', requestId: prepared.body.requestId, task: 'news_pick', picks: samples.map((reason, i) => ({ n: i + 1, reason })), clusters: [] }, prepared);
  assert.deepEqual(device.picks.map(pick => pick.reason), kept);
});

test('size: quote-heavy titles stop at the device budget, and a request too large for the reservation bound is refused before any reservation', async () => {
  const { PICK } = await loadHandler();
  const heavy = Array.from({ length: 150 }, (_, i) => ({ canonicalUrl: 'https://www.synthetic-daily.example/q' + i, title: '"\\'.repeat(140) + i, publisher: '"'.repeat(90), publishedAt: hours(1) }));
  const prepared = Pick.prepare({ requestId: randomUUID(), topics: TOPICS, candidates: heavy });
  assert(prepared.body.candidates.length < 150 && prepared.body.candidates.length > 10, 'stops at the budget: ' + prepared.body.candidates.length);
  const w = world({ provider: () => message({ picks: [{ n: 1, reason: '' }], clusters: [] }) }), handler = await handlerFor(w);
  let response = await handler(post(prepared.body)); assert.equal(response.status, 200, 'a device-built body fits the reservation bound');
  const reserve = w.state.rpc.find(([name]) => name === 'life_ai_reserve')[1]; assert(reserve.p_max_input_tokens <= PICK.maxInputTokens, 'reserved input ' + reserve.p_max_input_tokens);
  // Hand-built: as many quote-heavy candidates as fit in 64 KiB. Before, the reservation SQL refused it (500).
  const big = pickBody({ candidates: [] });
  for (let n = 1; n <= 150; n++) { const next = { ...big, candidates: [...big.candidates, candidate(n, { title: '"\\'.repeat(140) + n, publisher: '"'.repeat(90) })] }; if (Buffer.byteLength(JSON.stringify(next)) > 64 * 1024) break; big.candidates = next.candidates; }
  const w2 = world({ provider: () => assert.fail('provider called') }), h2 = await handlerFor(w2);
  response = await h2(post(big)); assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'invalid_request' });
  assert.deepEqual(w2.state.rpc, [], 'no reservation');
});

test('handler source: news_pick adds no console use and the wide search keeps its own refusal codes', async () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../supabase/functions/haedo-ai/handler.mjs'), 'utf8');
  assert.equal(source.match(/console\./g).length, 1);
  // 429 stays a temporary failure for 넓게 찾기 (only the pick request reads it as the money cap).
  const h = remote(async () => json({ error: 'rate_limited' }, { status: 429 }));
  await assert.rejects(h.remote.load({ topics: ['합성'], languages: ['ko'], workspaceId }), { code: 'wide_unavailable' });
});

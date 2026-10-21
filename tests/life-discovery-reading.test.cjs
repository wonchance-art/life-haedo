'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const R = require('../assets/life/discovery-reading.js'), D = require('../assets/life/discovery.js'), A = require('../assets/life/discovery-actions.js');
const Recommendations = require('../assets/life/discovery-recommendations.js'), Feedback = require('../assets/life/discovery-profile.js');
const NOW = '2026-10-21T04:00:00.000Z', PAST = '2026-10-20T00:00:00.000Z', LATER = '2026-10-21T05:00:00.000Z', WS = 'synthetic-reading';
const rights = { label: '합성 공개 메타데이터만', mode: 'metadata_only', url: null };
const clone = value => structuredClone(value);
function source(id = 'naver-d2') {
  const host = D.ALLOWED_SOURCES[id][0];
  return { id, name: '합성 출처 ' + id, url: `https://${host}/`, feedUrl: `https://${host}/feed`, language: 'ko', rights,
    status: 'ok', stale: false, lastSuccessAt: PAST, lastAttemptAt: PAST, error: null };
}
function article(id, title, patch = {}) {
  const sourceId = patch.sourceId || 'naver-d2';
  return { id, sourceId, url: `https://${D.ALLOWED_SOURCES[sourceId][0]}/reading/${id}`, title, author: null, language: 'ko', tags: [],
    publishedAt: PAST, fetchedAt: PAST, summary: '', coverage: 'link_only', rights, ...patch };
}
function fixture() {
  const liked = article('liked', '😀 인공지능 언어 연구', { tags: ['언어'], publishedAt: NOW });
  let actions = A.setReaction(A.empty(WS), A.capture(liked, source()), 'liked', true, { expectedRevision: 0, now: PAST });
  actions = A.setPersonalization(actions, true, { expectedRevision: actions.revision, now: PAST });
  const feed = { schemaVersion: 1, generatedAt: PAST, sources: [source(), source('woowahan-tech')], articles: [liked,
    article('personal', 'AI 언어 도구', { tags: ['언어'] }), article('manual', 'AI 기본 안내', { sourceId: 'woowahan-tech' }),
    article('latest', '도시 전시 소식', { publishedAt: NOW }), article('known', '인공지능 언어 자료'), article('read', 'AI 언어 기록')] };
  const read = feed.articles.find(row => row.id === 'read');
  return { feed, profile: { workspaceId: WS, revision: 4, manual: [{ id: 'manual-ai', label: 'AI' }] },
    feedback: [{ articleId: read.id, canonicalUrl: D.canonicalUrl(read.url), kind: 'already_read', updatedAt: PAST }],
    knownUrls: [feed.articles.find(row => row.id === 'known').url], contentLanguages: null, actions, translationTarget: 'original', personalAllowed: true };
}
const options = (expectedRevision = 0, now = NOW) => ({ expectedRevision, now });
const create = (input = fixture(), profile = R.empty(WS), opts = {}) => R.createComparison(profile, input, { ...options(profile.revision), sessionId: 'synthetic-session', ...opts });
const urls = result => result.items.map(row => row.article.canonicalUrl);
test('one immutable comparison reuses each actual ranker, actual UI known URLs and complete metadata-only union', async () => {
  const input = fixture(), original = clone(input), profile = R.empty(WS), result = await create(input, profile);
  assert(R.validate(result)); assert.equal(result.revision, 1); assert.equal(result.session.articles.length <= 6, true);
  const common = { profile: input.profile, feedback: input.feedback, knownUrls: input.knownUrls, contentLanguages: null, now: NOW, limit: 2 };
  const expected = { latest: D.rank(input.feed, { ...common, mode: 'latest' }), related: D.rank(input.feed, { ...common, mode: 'related' }),
    personal: Recommendations.rank(input.feed, { ...common, mode: 'personal', baselineMode: 'related', actions: input.actions }) };
  for (const mode of ['latest', 'related', 'personal']) {
    assert.deepEqual(result.session.lists[mode], urls(expected[mode]));
    assert.deepEqual(result.session.counts[mode], { eligibleCount: expected[mode].eligibleCount, poolCount: expected[mode].poolCount, excluded: expected[mode].metadata.excluded });
  }
  assert.equal(result.session.counts.latest.poolCount, 4, 'past-like URLs are not added to actual UI known exclusions');
  assert(result.session.lists.latest.includes(D.canonicalUrl(input.feed.articles[0].url)));
  assert.equal(result.session.personal.status, 'applied'); assert.equal(result.session.personal.applied, true);
  for (const row of result.session.articles) {
    assert.equal(row.snapshot.coverage, 'link_only'); assert.equal(row.snapshot.rights.mode, 'metadata_only');
    for (const key of ['summary', 'bodyText', 'contentText', 'liked', 'bookmarked']) assert(!Object.hasOwn(row.snapshot, key));
    if (row.personal) {
      assert.deepEqual(row.personal.sourceSnapshot, input.actions.entries[0].snapshot);
      for (const evidence of row.personal.evidence) {
        const originalField = evidence.field === 'title' ? row.personal.sourceSnapshot.title : row.personal.sourceSnapshot.tags[evidence.tagIndex];
        assert.equal(originalField.slice(evidence.start, evidence.end), evidence.quote);
        const candidate = evidence.candidateField === 'title' ? row.snapshot.title : row.snapshot.tags[evidence.candidateTagIndex];
        assert.equal(candidate.slice(evidence.candidateStart, evidence.candidateEnd), evidence.candidateQuote);
      }
    }
  }
  assert.equal(new Set(result.session.reviews.map(row => row.canonicalUrl)).size, result.session.articles.length);
  for (const row of result.session.reviews) for (const key of ['intent', 'reading', 'helpful', 'reason']) assert.equal(row[key], null);
  assert.equal(result.session.preference, null); assert.deepEqual(input, original); assert.deepEqual(profile, R.empty(WS));
});
test('personal off has no C list or evidence; on with insufficient/no-overlap returns exact chosen baseline', async () => {
  for (const patch of [{ personalAllowed: false }, { actions: null }, { actions: A.empty(WS) }]) {
    const input = { ...fixture(), ...patch }, result = await create(input);
    assert.equal(result.session.lists.personal, null); assert.equal(result.session.counts.personal, null);
    assert.deepEqual(result.session.personal, { status: 'disabled', applied: false, policy: null, signalCount: 0 });
    assert(result.session.articles.every(row => row.personal === null));
    assert.throws(() => R.setPreference(result, 'personal', options(result.revision)), { code: 'discovery_reading_invalid' });
  }
  for (const baselineMode of ['latest', 'related']) {
    for (const kind of ['insufficient_signal', 'no_overlap']) {
      const input = fixture(), item = article('other', kind === 'no_overlap' ? '도시 공연 문학' : 'AI');
      input.actions = A.setReaction(A.empty(WS), A.capture(item, source()), 'liked', true, { ...options(0), now: PAST });
      input.actions = A.setPersonalization(input.actions, true, { ...options(1), now: PAST }); input.baselineMode = baselineMode;
      const result = await create(input);
      assert.equal(result.session.personal.status, kind); assert.deepEqual(result.session.lists.personal, result.session.lists[baselineMode]);
      assert.deepEqual(result.session.counts.personal, result.session.counts[baselineMode]); assert.equal(result.session.conditions.baselineMode, baselineMode);
    }
  }
});
test('same source/language/known/feedback filter reaches all arms and prevents source/language-off prototypes', async () => {
  const input = fixture(); input.feed.sources = input.feed.sources.filter(row => row.id === 'woowahan-tech'); input.feed.articles = input.feed.articles.filter(row => row.sourceId === 'woowahan-tech');
  let result = await create(input); assert.equal(result.session.personal.status, 'insufficient_signal');
  assert.deepEqual(result.session.conditions.sourceIds, ['woowahan-tech']); assert(result.session.articles.every(row => row.snapshot.sourceId === 'woowahan-tech'));
  const english = fixture(); english.feed.articles.forEach(row => { row.language = 'en-US'; }); english.contentLanguages = ['en'];
  result = await create(english); assert.equal(result.session.personal.status, 'insufficient_signal');
  assert(result.session.articles.every(row => row.snapshot.language === 'en-US'));
  const none = await create({ ...fixture(), contentLanguages: [] });
  assert.deepEqual(none.session.articles, []); assert.deepEqual(none.session.reviews, []);
  for (const mode of ['latest', 'related', 'personal']) { assert.deepEqual(none.session.lists[mode], []); assert.equal(none.session.counts[mode].poolCount, 0); }
  const empty = fixture(); empty.feed = { schemaVersion: 1, generatedAt: PAST, sources: [], articles: [] };
  assert.equal((await create(empty)).session.articles.length, 0);
});
test('prevalidated UI invalid-row reports remain visible while new unsafe rows and forged report fields are rejected', async () => {
  const input = fixture(); input.feed.articles.push(article('bad-source', '겉모양만 있는 합성 후보', { url: 'https://unapproved.example/a' }));
  input.feed = D.validateFeed(input.feed, { now: NOW }); assert.equal(input.feed.validation.invalid.length, 1);
  const result = await create(input), common = { profile: input.profile, feedback: input.feedback, knownUrls: input.knownUrls, now: NOW, limit: 2 };
  for (const mode of ['latest', 'related', 'personal']) {
    assert.equal(result.session.counts[mode].excluded.invalid, 1);
    const expected = mode === 'personal' ? Recommendations.rank(input.feed, { ...common, mode, actions: input.actions, baselineMode: 'related' }) : D.rank(input.feed, { ...common, mode });
    assert.deepEqual(result.session.lists[mode], urls(expected));
  }
  assert(result.session.articles.every(row => row.snapshot.id !== 'bad-source'));
  const unsafe = clone(input); unsafe.feed.articles.push(article('new-bad', '추가된 무효 후보', { url: 'http://d2.naver.com/unsafe' }));
  await assert.rejects(create(unsafe), { code: 'discovery_reading_invalid' });
  const forged = clone(input); forged.feed.validation.invalid[0].privateBody = 'PRIVATE_MARKER';
  await assert.rejects(create(forged), { code: 'discovery_reading_invalid' });
});
test('normalized ranking digest and frozen date/source/evidence survive later changes without retaining publisher bodies', async () => {
  const input = fixture(); Object.assign(input.feed.sources[0], { status: 'error', stale: true, error: '합성 수집 실패' });
  const result = await create(input), same = await create(clone(input));
  assert.equal(result.session.rankInputSHA256, same.session.rankInputSHA256); assert.match(result.session.rankInputSHA256, /^[a-f0-9]{64}$/);
  assert.equal(result.session.stale, true); assert.equal(result.session.sources[0].status, 'error'); assert.equal(result.session.sources[0].lastSuccessAt, new Date(PAST).toISOString());
  const changed = await create({ ...clone(input), translationTarget: 'en' }); assert.notEqual(result.session.rankInputSHA256, changed.session.rankInputSHA256);
  const baseline = await create({ ...clone(input), baselineMode: 'latest' }); assert.notEqual(result.session.rankInputSHA256, baseline.session.rankInputSHA256);
  const before = clone(result); input.feed.articles[0].title = '변경된 새 제목'; input.actions.entries[0].snapshot.tags.push('후속 태그'); input.profile.manual[0].label = '다른 주제';
  assert.deepEqual(result, before);
  const body = fixture(), marker = '저장하지 않을 전체 본문 끝문장';
  body.feed.articles[0] = { ...body.feed.articles[0], coverage: 'full_text', rights: { ...rights, mode: 'full_text_allowed' }, bodyText: 'AI 실험\n' + marker };
  const captured = await create(body); assert(!JSON.stringify(captured).includes(marker));
  assert(captured.session.articles.every(row => row.snapshot.coverage === 'link_only'));
});
test('explicit judgments and preference update only answers; unread/unavailable cannot become helpful evidence', async () => {
  const initial = await create(), url = initial.session.reviews[0].canonicalUrl, before = clone(initial);
  for (const reading of [null, 'not_read', 'unavailable']) {
    for (const patch of [{ reading, helpful: 'yes' }, { reading, helpful: 'no' }, { reading, reason: 'off_topic' }]) {
      assert.throws(() => R.setReview(initial, url, patch, options(1)), { code: 'discovery_reading_invalid' });
    }
  }
  let result = R.setReview(initial, url, { intent: 'yes' }, options(1)); assert.equal(result.session.reviews[0].reading, null);
  result = R.setReview(result, url, { reading: 'partial', helpful: 'yes', reason: 'other' }, options(2, LATER));
  assert.throws(() => R.setReview(result, url, { reading: 'not_read' }, options(3, LATER)), { code: 'discovery_reading_invalid' });
  result = R.setReview(result, url, { reading: 'not_read', helpful: null, reason: null }, options(3, LATER));
  result = R.setPreference(result, 'tie', options(4, LATER)); assert.equal(result.session.preference, 'tie');
  const frozen = session => { const value = clone(session); delete value.reviews; delete value.preference; return value; };
  assert.deepEqual(frozen(result.session), frozen(initial.session)); assert.deepEqual(initial, before);
  assert.equal(result.revision, 5); assert.equal(result.updatedAt, LATER);
  assert.throws(() => R.setReview(initial, 'https://d2.naver.com/missing', { intent: 'no' }, options(1)), { code: 'discovery_reading_invalid' });
  for (const patch of [{}, { helpful: true }, { intent: 'maybe' }, { reading: 'opened' }, { reason: 'note' }, { notes: 'free text' }, { intent: undefined }]) {
    assert.throws(() => R.setReview(initial, url, patch, options(1)), { code: 'discovery_reading_invalid' });
  }
});
test('CAS, monotonic time and tombstone deletion prevent stale local edits/replacement while allowing explicit restart', async () => {
  const initial = await create(), url = initial.session.reviews[0].canonicalUrl;
  await assert.rejects(create(fixture(), initial), { code: 'discovery_reading_exists' });
  assert.throws(() => R.setReview(initial, url, { intent: 'yes' }, options(0)), { code: 'discovery_reading_conflict' });
  assert.throws(() => R.setPreference(initial, 'latest', options(1, PAST)), { code: 'discovery_reading_invalid' });
  const deleted = R.clear(initial, options(1, LATER)); assert.equal(deleted.revision, 2); assert.equal(deleted.deleted, true); assert.equal(deleted.session, null); assert(R.validate(deleted));
  assert.throws(() => R.setReview(deleted, url, { intent: 'yes' }, options(1, LATER)), { code: 'discovery_reading_conflict' });
  assert.throws(() => R.setPreference(deleted, 'latest', options(2, LATER)), { code: 'discovery_reading_invalid' });
  await assert.rejects(create(fixture(), deleted, { expectedRevision: 1, now: LATER }), { code: 'discovery_reading_conflict' });
  const next = await create(fixture(), deleted, { now: LATER, sessionId: 'new-session' }); assert.equal(next.revision, 3); assert.equal(next.deleted, false); assert.equal(next.session.id, 'new-session');
  const max = { ...R.empty(WS), revision: Number.MAX_SAFE_INTEGER, updatedAt: NOW };
  assert.throws(() => R.clear(max, options(max.revision)), { code: 'discovery_reading_conflict' });
});
test('strict input schemas, workspaces, key/prototype/array/URL/date/limits fail closed without reflecting input values', async () => {
  const cases = [];
  const add = change => { const input = fixture(); change(input); cases.push(input); };
  add(input => { input.extra = 'PRIVATE_MARKER'; }); add(input => { input.profile.workspaceId = 'other'; }); add(input => { input.actions.workspaceId = 'other'; });
  add(input => { input.feed.articles[0].privateBody = 'PRIVATE_MARKER'; }); add(input => { input.feed.articles[0].url = 'https://d2.naver.com.evil.test/a'; });
  add(input => { input.contentLanguages = ['en-US']; }); add(input => { input.contentLanguages = ['ko', 'ko']; });
  add(input => { input.translationTarget = 'xx'; }); add(input => { input.personalAllowed = 1; }); add(input => { input.baselineMode = 'personal'; });
  add(input => { input.feed.articles = Array(501).fill(input.feed.articles[0]); }); add(input => { input.feed.articles = Array(1); });
  add(input => { input.profile.manual[0] = { ...input.profile.manual[0], notes: 'PRIVATE_MARKER' }; });
  add(input => { input.feedback[0].kind = 'liked'; }); add(input => { input.feedback[0].updatedAt = LATER; });
  add(input => { input.feedback[0].updatedAt = '2026-02-30T00:00:00Z'; }); add(input => { input.knownUrls = ['javascript:PRIVATE_MARKER']; });
  add(input => { input.actions.entries[0].snapshot.bodyText = 'PRIVATE_MARKER'; });
  add(input => { input.feed = Object.assign(Object.create({ inherited: true }), input.feed); });
  add(input => { input[Symbol('hidden')] = 1; }); add(input => { Object.defineProperty(input.profile, 'manual', { get() { throw Error('PRIVATE_MARKER'); } }); });
  add(input => { Object.setPrototypeOf(input.knownUrls, Object.create(Array.prototype)); });
  for (const input of cases) await assert.rejects(create(input), error => error.code === 'discovery_reading_invalid' && !error.message.includes('PRIVATE_MARKER'));
  for (const now of ['2026-02-30T00:00:00Z', '2026-10-21T04:00:00.000123Z', '2026-10-21T04:00:00+00:00']) await assert.rejects(create(fixture(), R.empty(WS), { now }), { code: 'discovery_reading_invalid' });
  await assert.rejects(create(fixture(), R.empty(WS), { sessionId: 'space in id' }), { code: 'discovery_reading_invalid' });
  await assert.rejects(create(fixture(), R.empty(WS), { unknown: true }), { code: 'discovery_reading_invalid' });
});
test('stored snapshots reject injected fields, changed exact evidence/identity, duplicates and missing judgments', async () => {
  const result = await create(), cases = [];
  const add = change => { const value = clone(result); change(value); cases.push(value); };
  add(value => { value.owner = 'PRIVATE_MARKER'; }); add(value => { value.session.articles[0].snapshot.bodyText = 'PRIVATE_MARKER'; });
  add(value => { value.session.articles[0].snapshot.rights.mode = 'full_text_allowed'; }); add(value => { value.session.articles[0].snapshot.url = 'http://d2.naver.com/a'; });
  add(value => { value.session.reviews[0].helpful = 'yes'; }); add(value => { value.session.reviews.pop(); });
  add(value => { value.session.reviews.push(value.session.reviews[0]); }); add(value => { value.session.lists.latest.push(value.session.lists.latest[0]); });
  add(value => { value.session.conditions.contentLanguages = []; }); add(value => { value.session.personal.applied = false; });
  add(value => { value.session.articles.find(row => row.personal).personal.evidence[0].quote = '틀린 근거'; });
  add(value => { value.session.articles.find(row => row.reasons.length).reasons[0].start++; });
  add(value => { value.session.sources[0].sourceBody = 'PRIVATE_MARKER'; }); add(value => { value.session.rankInputSHA256 = 'bad'; });
  add(value => { value.deleted = true; }); add(value => { value.revision = 0; });
  for (const value of cases) assert.throws(() => R.validate(value), error => error.code === 'discovery_reading_invalid' && !error.message.includes('PRIVATE_MARKER'));
});
test('creation snapshots inputs/options before asynchronous digest and never calls I/O or modifies action/profile settings', async t => {
  const oldFetch = global.fetch; global.fetch = () => { throw Error('network must not be called'); }; t.after(() => { global.fetch = oldFetch; });
  const input = fixture(), before = clone(input), opt = { ...options(0), sessionId: 'original-session' };
  const promise = R.createComparison(R.empty(WS), input, opt);
  input.feed.articles[0].title = '후속 변경'; input.actions.entries[0].liked = false; input.actions.entries[0].likedAt = null; opt.sessionId = 'later-session';
  const result = await promise; assert.equal(result.session.id, 'original-session'); assert(!JSON.stringify(result).includes('후속 변경'));
  const expected = await create(before, R.empty(WS), { sessionId: 'original-session' }); assert.deepEqual(result, expected);
});
test('full effective interest/profile projections retain only manual metadata and accept actual HTTP known URLs without inventing exclusions', async () => {
  const I = require('../assets/life/interest-profile.js'), input = fixture();
  input.profile = I.setManual(I.empty(WS), input.profile.manual, { expectedRevision: 0, now: PAST });
  input.feedback = Feedback.setFeedback(Feedback.empty(WS), { id: 'read', url: input.feedback[0].canonicalUrl }, 'already_read', { expectedRevision: 0, now: PAST });
  input.knownUrls.push('http://example.org/old-public-source');
  const result = await create(input); assert.equal(result.session.conditions.knownUrlCount, 2); assert.equal(result.session.conditions.profileRevision, 1); assert.equal(result.session.conditions.feedbackRevision, 1);
  assert(!Object.hasOwn(result.session, 'analysis')); assert(!Object.hasOwn(result.session, 'actions')); assert(!Object.hasOwn(result.session.conditions, 'knownUrls'));
  assert.equal(result.session.counts.latest.poolCount, 4);
});
test('UMD import has no module-load I/O and profile bound is a hard failure rather than silent snapshot truncation', async () => {
  const code = fs.readFileSync(path.join(__dirname, '../assets/life/discovery-reading.js'), 'utf8');
  const context = vm.createContext({ fetch() { throw Error('unexpected request'); }, setTimeout() { throw Error('unexpected timer'); } });
  vm.runInContext(code, context); assert.equal(typeof context.HaedoLife.DiscoveryReading.createComparison, 'function');
  const input = fixture(); input.feed.sources = [source()]; input.feed.articles = Array.from({ length: 6 }, (_, index) => article('large-' + index,
    index < 2 ? 'AI 언어 large ' + index : index < 4 ? '😀 인공지능 언어 large ' + index : '도시 large ' + index,
    { tags: Array.from({ length: 50 }, (_, i) => ('표현' + i).padEnd(200, '가')), publishedAt: index < 2 ? NOW : PAST }));
  const result = await create(input); assert(new TextEncoder().encode(JSON.stringify(result)).length <= R.MAX_BYTES);
  const oversized = clone(result); oversized.session.articles[0].reasons = Array(20001).fill(result.session.articles[0].reasons[0] || {});
  assert.throws(() => R.validate(oversized), { code: 'discovery_reading_invalid' });
  const bytes = clone(result), item = bytes.session.articles.find(row => row.reasons.length);
  item.reasons = Array.from({ length: 4000 }, () => clone(item.reasons[0]));
  assert(new TextEncoder().encode(JSON.stringify(bytes)).length > R.MAX_BYTES);
  assert.throws(() => R.validate(bytes), { code: 'discovery_reading_too_large' });
});
test('frozen known v2 evidence and fallback remain valid after the live ranker policy changes; unknown stored policies fail', async t => {
  const applied = await create(), fallbackInput = fixture();
  fallbackInput.actions = A.setPersonalization(A.empty(WS), true, options(0, PAST));
  const fallback = await create(fallbackInput), prior = global.HaedoLife.DiscoveryRecommendations;
  global.HaedoLife.DiscoveryRecommendations = { ...prior, POLICY: 'synthetic-future-v3' };
  t.after(() => { global.HaedoLife.DiscoveryRecommendations = prior; });
  for (const profile of [applied, fallback]) {
    assert.equal(profile.session.personal.policy, 'public-title-tag-expressions-v2'); assert(R.validate(profile));
    const changed = R.setPreference(profile, 'undecided', options(profile.revision));
    assert.equal(changed.session.personal.policy, profile.session.personal.policy);
    assert.equal(changed.session.rankInputSHA256, profile.session.rankInputSHA256);
    const bad = clone(profile); bad.session.personal.policy = 'synthetic-future-v3';
    for (const item of bad.session.articles) if (item.personal) item.personal.policy = bad.session.personal.policy;
    assert.throws(() => R.validate(bad), { code: 'discovery_reading_invalid' });
  }
});

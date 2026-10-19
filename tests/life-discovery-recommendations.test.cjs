'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const Discovery = require('../assets/life/discovery.js');
const Actions = require('../assets/life/discovery-actions.js');
const Recommendations = require('../assets/life/discovery-recommendations.js');
const NOW = '2026-10-19T00:00:00.000Z', PAST = '2026-10-18T00:00:00.000Z';
const rights = { mode: 'metadata_only', label: '합성 공개 메타데이터', url: null };
function source(id = 'naver-d2') {
  const host = Discovery.ALLOWED_SOURCES[id][0];
  return { id, name: id, url: `https://${host}/`, feedUrl: `https://${host}/feed`, language: 'ko', rights,
    status: 'ok', stale: false, lastSuccessAt: NOW, lastAttemptAt: NOW, error: null };
}
function article(id, title, extra = {}) {
  const sourceId = extra.sourceId || 'naver-d2', host = Discovery.ALLOWED_SOURCES[sourceId][0];
  return { id, sourceId, url: `https://${host}/article?id=${id}`, title, tags: [], author: null, language: 'ko',
    publishedAt: PAST, fetchedAt: PAST, coverage: 'link_only', summary: '', rights, ...extra };
}
function feed(articles, sourceIds = [...new Set(articles.map(row => row.sourceId))]) {
  return { schemaVersion: 1, generatedAt: NOW, sources: sourceIds.map(source), articles };
}
function reaction(profile, item, kind = 'liked', target = true, now = PAST) {
  return Actions.setReaction(profile, Actions.capture(item, source(item.sourceId)), kind, target, { expectedRevision: profile.revision, now });
}
function enabled(item, kind = 'liked', now = PAST) {
  let actions = reaction(Actions.empty('synthetic-workspace'), item, kind, true, now);
  return Actions.setPersonalization(actions, true, { expectedRevision: actions.revision, now });
}
const manual = { manual: [{ id: 'manual-ai', label: '인공지능' }] };
function rank(catalog, actions, extra = {}) {
  return Recommendations.rank(catalog, { profile: manual, actions, mode: 'personal', baselineMode: 'related', now: NOW, ...extra });
}
function baseline(catalog, extra = {}) { return Discovery.rank(catalog, { profile: manual, now: NOW, ...extra }); }
const clone = value => structuredClone(value);
test('pool refactor preserves complete pre-change baseline output for fixed filtering/date/coverage cases', () => {
  // Complete-output hashes captured from the unmodified baseline at
  // 90f28087d5130e8a78c3dadd98527ffae1077a62. No runtime Git dependency.
  const expected = { related: 'fe2535ea7ddc66cb49cc688f8c6a2e5f50b54cf33f05ec76f93d8176c3196a23',
    latest: '172a4dafdec76ce283599b8ead7283895b64150eca73e5a5ec1849f1371ec362' };
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const catalog = feed([
    article('ai', '😀 AI 언어 연구', { tags: ['인공지능'] }),
    article('other', '다른 공연'), article('known', '인공지능 연구'),
    article('duplicate', '인공지능 연구', { url: 'https://d2.naver.com/article?id=ai&utm_source=x#section' }),
    article('invalid', '인공지능 연구', { url: 'https://d2.naver.com.evil.example/a' }),
    article('future', '인공지능 연구', { publishedAt: '2099-01-01T00:00:00Z' }),
    article('summary', '연구', { coverage: 'summary', summary: '인공지능', rights: { ...rights, mode: 'summary_allowed' } })
  ]);
  for (const mode of ['related', 'latest']) {
    const options = { profile: manual, mode, now: NOW, knownUrls: ['https://d2.naver.com/article?id=known#x'] };
    assert.equal(hash(Discovery.rank(catalog, options)), expected[mode]);
    const prepared = Discovery.candidatePool(catalog, options), before = prepared.pool.map(row => row.article.id);
    assert.equal(hash(Discovery.rankPool(prepared)), expected[mode]);
    assert.deepEqual(prepared.pool.map(row => row.article.id), before, 'ranking must not reorder a reusable pool');
  }
});
test('off, absent, bookmark-only, insufficient and no-overlap signals return exact remembered baseline', () => {
  const liked = article('liked', '인공지능 언어 연구'), catalog = feed([article('new', 'AI 언어 실험'), article('latest', '공연 소식', { publishedAt: NOW })]);
  let off = enabled(liked); off = Actions.setPersonalization(off, false, { expectedRevision: off.revision, now: NOW });
  const weak = enabled(article('weak', 'AI')), irrelevant = enabled(article('books', '독서 소설 문학'));
  for (const actions of [null, Actions.empty('synthetic-workspace'), off, enabled(liked, 'bookmarked'), weak, irrelevant]) {
    for (const mode of ['related', 'latest']) assert.deepEqual(rank(catalog, actions, { baselineMode: mode }), baseline(catalog, { mode }));
  }
});
test('explicit baseline modes ignore even malformed reaction input and never personalize', () => {
  const catalog = feed([article('a', '인공지능 언어')]);
  for (const mode of ['related', 'latest']) assert.deepEqual(Recommendations.rank(catalog, { profile: manual, mode, actions: { privateBody: 'not read' }, now: NOW }), baseline(catalog, { mode }));
});
test('personal mode rejects explicitly mixed workspaces while unscoped fixtures and baseline modes remain compatible', () => {
  const catalog = feed([article('new', 'AI 언어 실험')]), actions = enabled(article('liked', '인공지능 언어 연구'));
  const matching = { ...manual, workspaceId: actions.workspaceId }, wrong = { ...manual, workspaceId: 'other-workspace' };
  assert.deepEqual(rank(catalog, actions, { profile: matching }), rank(catalog, actions));
  assert.throws(() => rank(catalog, actions, { profile: wrong }), { code: 'discovery_profile_invalid' });
  assert.throws(() => rank(catalog, actions, { feedback: { workspaceId: 'other-workspace', feedback: [] } }), { code: 'discovery_profile_invalid' });
  assert.deepEqual(rank(catalog, actions, { profile: matching, feedback: { workspaceId: actions.workspaceId, feedback: [] } }), rank(catalog, actions));
  for (const mode of ['related', 'latest']) assert.deepEqual(Recommendations.rank(catalog, { profile: wrong, actions, mode, now: NOW }), baseline(catalog, { profile: wrong, mode }));
});
test('past like promotes a different public article with exact inspectable title/tag evidence', () => {
  const liked = article('liked', '😀 인공지능 언어 연구', { tags: ['언어', '인공지능'] });
  const actions = enabled(liked), catalog = feed([liked, article('new', 'AI 언어 실험', { tags: ['언어'] }), article('unrelated', 'AI 요리')]);
  const inputBefore = JSON.stringify({ actions, catalog }), result = rank(catalog, actions);
  assert.deepEqual(result.items.map(row => row.article.id), ['new']);
  assert.equal(result.metadata.personalization.applied, true); assert.equal(result.metadata.personalization.signalCount, 1);
  const item = result.items[0]; assert.equal(item.personal.policy, 'public-title-tags-v1'); assert.equal(item.personal.score, 3);
  for (const evidence of item.personal.evidence) {
    const original = evidence.field === 'tags' ? liked.tags[evidence.tagIndex] : liked.title;
    const candidate = evidence.candidateField === 'tags' ? item.article.tags[evidence.candidateTagIndex] : item.article.title;
    assert.equal(original.slice(evidence.start, evidence.end), evidence.quote);
    assert.equal(candidate.slice(evidence.candidateStart, evidence.candidateEnd), evidence.candidateQuote);
    assert.equal(evidence.canonicalUrl, Discovery.canonicalUrl(liked.url));
  }
  assert.equal(JSON.stringify({ actions, catalog }), inputBefore);
});
test('removing the signal, excluding it or clearing immediately erases derived results; no retained cache', () => {
  const liked = article('liked', '인공지능 언어 연구'), catalog = feed([article('new', 'AI 언어 실험')]), actions = enabled(liked);
  assert(rank(catalog, actions).metadata.personalization?.applied);
  const cancelled = reaction(actions, liked, 'liked', false, NOW);
  const excluded = Actions.setExcluded(actions, liked.url, true, { expectedRevision: actions.revision, now: NOW });
  const cleared = Actions.clear(actions, { expectedRevision: actions.revision, now: NOW });
  for (const state of [cancelled, excluded, cleared]) assert.deepEqual(rank(catalog, state), baseline(catalog));
  assert.equal(Recommendations.inspectSignals(cancelled, { now: NOW }).signalCount, 0);
});
test('future likes and future snapshot fetches cannot contribute positive evidence', () => {
  const liked = article('liked', '인공지능 언어 연구'), catalog = feed([article('new', 'AI 언어 실험')]);
  const future = '2026-10-20T00:00:00.000Z';
  for (const state of [enabled(liked, 'liked', future), enabled({ ...liked, fetchedAt: future })]) {
    assert.deepEqual(rank(catalog, state), baseline(catalog));
    assert.equal(Recommendations.inspectSignals(state, { now: NOW }).excluded.future, 1);
  }
});
test('bookmark changes and repeated same-target likes neither replace active metadata nor amplify rank', () => {
  const liked = article('liked', '인공지능 언어 연구'), catalog = feed([article('new', 'AI 언어 실험')]), actions = enabled(liked);
  const repeated = reaction(actions, { ...liked, title: '무관한 여행 도시' }, 'liked', true, NOW);
  const bookmarked = reaction(repeated, { ...liked, title: '무관한 여행 도시' }, 'bookmarked', true, NOW);
  assert.deepEqual(rank(catalog, bookmarked), rank(catalog, actions));
  assert.equal(bookmarked.entries[0].snapshot.title, liked.title);
});
test('current catalog edits do not rewrite the public metadata that was liked', () => {
  const liked = article('liked', '인공지능 언어 연구'), actions = enabled(liked);
  const catalog = feed([{ ...liked, title: '전혀 다른 도시 여행' }, article('new', 'AI 언어 실험'), article('wrong', '도시 여행 지도')]);
  const result = rank(catalog, actions); assert.deepEqual(result.items.map(row => row.article.id), ['new']);
  assert(result.items[0].personal.evidence.every(row => row.title === liked.title));
});
test('source-off snapshots are not effective signals, while missing articles from an enabled source remain usable', () => {
  const liked = article('liked', '인공지능 언어 연구'), actions = enabled(liked);
  const other = article('new', 'AI 언어 실험', { sourceId: 'woowahan-tech' });
  const offCatalog = feed([other]);
  assert.deepEqual(rank(offCatalog, actions), baseline(offCatalog));
  assert.equal(Recommendations.inspectSignals(actions, { now: NOW, sourceIds: ['woowahan-tech'] }).excluded.sourceOff, 1);
  assert(rank(feed([other], ['naver-d2', 'woowahan-tech']), actions).metadata.personalization?.applied);
});
test('known, read, hide, duplicate URL, hostile host and rights filters precede positive personalization', () => {
  const liked = article('liked', '인공지능 언어 연구'), actions = enabled(liked);
  const catalog = feed([
    liked, article('known', 'AI 언어 실험'), article('read', 'AI 언어 실험'), article('hidden', 'AI 언어 실험'),
    article('new', 'AI 언어 실험'), article('duplicate', 'AI 언어 실험', { url: 'https://d2.naver.com/article?id=new&utm_source=x#part' }),
    article('evil', 'AI 언어 실험', { url: 'https://d2.naver.com.evil.example/a' }),
    article('rights', 'AI 언어 실험', { coverage: 'full_text', bodyText: '언어 인공지능', rights })
  ]);
  const feedback = { feedback: ['read', 'hidden'].map((id, i) => ({ canonicalUrl: `https://d2.naver.com/article?id=${id}`, kind: i ? 'not_relevant' : 'already_read' })) };
  const result = rank(catalog, actions, { knownUrls: ['https://d2.naver.com/article?id=known&fbclid=tracking#part'], feedback });
  assert.deepEqual(result.items.map(row => row.article.id), ['new']);
  assert.deepEqual(result.metadata.excluded, { known: 1, feedback: 2, duplicate: 1, invalid: 2 });
});
test('meaningful URL query IDs stay distinct while tracking/self URLs never count as new successes', () => {
  const liked = article('liked', '인공지능 언어 연구'), actions = enabled(liked);
  const catalog = feed([article('self-copy', 'AI 언어 실험', { url: liked.url + '&utm_medium=x' }), article('new', 'AI 언어 실험')]);
  assert.deepEqual(rank(catalog, actions).items.map(row => row.article.id), ['new']);
  const corrupt = clone(actions); corrupt.entries[0].snapshot.url = 'https://d2.naver.com.evil.example/a';
  assert.throws(() => rank(catalog, corrupt), { code: 'discovery_actions_invalid' });
});
test('bounded source variety uses only related matches and does not pad unrelated slots', () => {
  const actions = enabled(article('liked', '인공지능 언어 연구'));
  const catalog = feed([
    article('a1', 'AI 언어 실험'), article('a2', 'AI 언어 평가'),
    article('b1', 'AI 언어 도구', { sourceId: 'woowahan-tech' }),
    article('unrelated', '공연 일정', { sourceId: 'seoul-culture' })
  ]);
  const result = rank(catalog, actions, { limit: 5 });
  assert.deepEqual(result.items.map(row => row.article.sourceId), ['naver-d2', 'woowahan-tech', 'naver-d2']);
  assert.equal(result.eligibleCount, 3); assert.equal(result.items.length, 3);
});
test('a lone homonym or arbitrary substrings cannot establish the required shared evidence', () => {
  const actions = enabled(article('java-code', '자바 컴파일러 설계'));
  const catalog = feed([article('java-island', '자바 여행 지도'), article('substring', '컴파일러설계 여행'), article('valid', '자바 컴파일러 구현')]);
  assert.deepEqual(rank(catalog, actions).items.map(row => row.article.id), ['valid']);
  assert.match(rank(catalog, actions).metadata.limitation, /문맥은 다를 수/);
});
test('two shared homonyms remain an explicit lexical false-positive limitation, never semantic evidence', () => {
  const actions = enabled(article('java-programming', '자바 언어 컴파일러'));
  const catalog = feed([article('javanese-language', '자바 언어 방언 지도')]);
  const result = rank(catalog, actions);
  // Programming language versus a natural language: lexical heuristics cannot
  // distinguish this pair. Keep the failure visible; do not claim NLU quality.
  assert.deepEqual(result.items.map(row => row.article.id), ['javanese-language']);
  assert.match(result.metadata.limitation, /겹친 단어/);
  assert(!('probability' in result.items[0].personal));
  assert(!('semanticSimilarity' in result.items[0].personal));
});
test('summary/body/read/click data cannot become recommendation features and future articles do not enter applied personal output', () => {
  const actions = enabled(article('liked', '인공지능 언어 연구'));
  const catalog = feed([
    article('body', '다른 연구', { coverage: 'full_text', bodyText: 'AI 언어', rights: { ...rights, mode: 'full_text_allowed' } }),
    article('future', 'AI 언어 실험', { publishedAt: '2099-01-01T00:00:00Z' }),
    article('valid', 'AI 언어 도구')
  ]);
  assert.deepEqual(rank(catalog, actions).items.map(row => row.article.id), ['valid']);
  const injected = clone(actions); injected.entries[0].snapshot.privateMemo = '비공개';
  assert.throws(() => rank(catalog, injected), { code: 'discovery_actions_invalid' });
});
test('personalization scans the whole bounded pool rather than only five baseline results', () => {
  const actions = enabled(article('liked', '인공지능 언어 연구'));
  const catalog = feed([...Array.from({ length: 499 }, (_, index) => article(`unrelated-${index}`, '공연 일정')), article('last-500', 'AI 언어 도구')]);
  const result = rank(catalog, actions, { baselineMode: 'latest' });
  assert.equal(result.poolCount, 500); assert.deepEqual(result.items.map(row => row.article.id), ['last-500']);
  assert.equal(Recommendations.MIN_SHARED_TERMS, 2);
});

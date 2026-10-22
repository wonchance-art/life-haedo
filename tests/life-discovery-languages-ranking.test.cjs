'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Discovery = require('../assets/life/discovery.js');
const Actions = require('../assets/life/discovery-actions.js');
const Recommendations = require('../assets/life/discovery-recommendations.js');
const NOW = '2026-10-19T00:00:00.000Z', PAST = '2026-10-17T00:00:00.000Z';
const rights = { mode: 'metadata_only', label: '합성 공개 메타데이터', url: null };
const source = { id: 'naver-d2', name: '합성 다언어 출처', url: 'https://d2.naver.com/', feedUrl: 'https://d2.naver.com/feed',
  language: 'ko', rights, status: 'ok', stale: false, lastSuccessAt: NOW, lastAttemptAt: NOW, error: null };
function article(id, language, extra = {}) {
  return { id, sourceId: source.id, url: `https://d2.naver.com/article?id=${id}`, title: '😀 AI 언어 연구', tags: [], language,
    author: null, publishedAt: PAST, fetchedAt: PAST, coverage: 'link_only', summary: '', rights, ...extra };
}
function feed(articles) { return { schemaVersion: 1, generatedAt: NOW, sources: [structuredClone(source)], articles }; }
function liked(language = 'ko-KR') {
  const item = article('prior-like', language);
  let actions = Actions.setReaction(Actions.empty('synthetic-language-workspace'), Actions.capture(item, source), 'liked', true, { expectedRevision: 0, now: PAST });
  return Actions.setPersonalization(actions, true, { expectedRevision: 1, now: PAST });
}
const profile = { manual: [{ id: 'manual-ai', label: 'AI' }] };
function rank(catalog, mode, extra = {}) {
  return Recommendations.rank(catalog, { mode, profile, actions: liked(), baselineMode: 'related', now: NOW, limit: 5, ...extra });
}
test('one frozen registry groups BCP47 primary languages without rewriting metadata or using publisher fallback', () => {
  assert(Object.isFrozen(Discovery.CONTENT_LANGUAGE_CODES));
  assert.deepEqual(Discovery.CONTENT_LANGUAGE_CODES, ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'und', 'mul', 'other']);
  const cases = new Map([
    ['ko', 'ko'], ['KO-kr', 'ko'], ['en-US', 'en'], ['en-GB', 'en'], ['ja-JP', 'ja'],
    ['zh-Hant-TW', 'zh'], ['zh-Hans-CN', 'zh'], ['es-MX', 'es'], ['fr-CA', 'fr'], ['de-CH', 'de'],
    ['und', 'und'], ['und-Latn', 'und'], ['mul', 'mul'], ['unknown', 'und'], ['mixed', 'mul'],
    ['pt-BR', 'other'], ['ar-EG', 'other'], ['ru', 'other'], ['', 'und'], ['en_US', 'und'], ['ko,en', 'und'],
    ['not a tag', 'und'], [null, 'und'], [undefined, 'und'], [17, 'und']
  ]);
  for (const [raw, expected] of cases) assert.equal(Discovery.languageKey(raw), expected, String(raw));
  const original = feed([article('english', 'en-US'), article('unknown', 'unknown')]), before = structuredClone(original);
  Discovery.rank(original, { profile, now: NOW, contentLanguages: ['en'] });
  assert.deepEqual(original, before); assert.equal(original.articles[0].language, 'en-US'); assert.equal(original.sources[0].language, 'ko');
  const sandbox = { Intl: null }; vm.runInNewContext(fs.readFileSync(require.resolve('../assets/life/discovery.js'), 'utf8'), sandbox);
  assert.equal(sandbox.HaedoLife.Discovery.languageKey('ko-KR'), 'und', 'unavailable native canonicalizer must fail safely');
});
test('all and none are distinct; malformed or duplicate selection codes never become implicit all', () => {
  for (const value of [undefined, null]) for (const language of ['ko-KR', 'en-US', 'mul', 'und', 'pt-BR', 'not a tag']) assert.equal(Discovery.languageAllowed(language, value), true);
  for (const language of ['ko-KR', 'en-US', 'mul', 'und', 'pt-BR']) assert.equal(Discovery.languageAllowed(language, []), false);
  assert.equal(Discovery.languageAllowed('en-US', ['en']), true); assert.equal(Discovery.languageAllowed('en-US', ['ko']), false);
  assert.equal(Discovery.languageAllowed('unknown', ['en']), false); assert.equal(Discovery.languageAllowed('unknown', ['und']), true);
  for (const selection of ['en', {}, ['en', 'en'], ['en-US'], ['xx'], Array(1), ['en', null]]) {
    assert.throws(() => Discovery.languageAllowed('en', selection), { code: 'discovery_profile_invalid' });
    assert.throws(() => Discovery.rank(feed([]), { now: NOW, contentLanguages: selection }), { code: 'discovery_profile_invalid' });
    assert.throws(() => Recommendations.inspectSignals(Actions.empty('synthetic-language-workspace'), { now: NOW, contentLanguages: selection }), { code: 'discovery_profile_invalid' });
  }
});
test('all three modes share language eligibility before top-K across region, script, unknown and mixed rows', () => {
  const catalog = feed([
    article('ko', 'ko'), article('ko-regional', 'ko-KR'), article('en', 'en-US'), article('ja', 'ja-JP'),
    article('zh', 'zh-Hant-TW'), article('unknown', 'unknown'), article('invalid-tag', 'en_US'), article('mixed', 'mul'), article('other', 'pt-BR')
  ]);
  const expected = { ko: ['ko', 'ko-regional'], en: ['en'], ja: ['ja'], zh: ['zh'], und: ['invalid-tag', 'unknown'], mul: ['mixed'], other: ['other'] };
  for (const [language, ids] of Object.entries(expected)) for (const mode of ['related', 'latest', 'personal']) {
    const result = rank(catalog, mode, { contentLanguages: [language], actions: liked(language === 'other' ? 'pt-BR' : language) });
    assert.deepEqual(result.items.map(row => row.article.id).sort(), [...ids].sort(), mode + ' / ' + language);
    assert.equal(result.poolCount, ids.length); assert.equal(result.metadata.excluded.language, catalog.articles.length - ids.length);
    assert.equal(result.metadata.sources.length, 1, 'an active multilingual source is not disabled by an article filter');
  }
  const beyondTopFive = feed([...Array.from({ length: 8 }, (_, index) => article('new-en-' + index, 'en-US', { publishedAt: NOW })), article('old-ko', 'ko-KR')]);
  for (const mode of ['related', 'latest', 'personal']) assert.deepEqual(rank(beyondTopFive, mode, { contentLanguages: ['ko'], limit: 1 }).items.map(row => row.article.id), ['old-ko']);
});
test('default/null output and inspection are exact; empty selections stay empty and translation target never changes ranking', () => {
  const catalog = feed([article('ko', 'ko-KR'), article('en', 'en-US'), article('unknown', 'und')]);
  for (const mode of ['related', 'latest', 'personal']) {
    const original = rank(catalog, mode);
    assert.deepEqual(rank(catalog, mode, { contentLanguages: null }), original);
    assert.deepEqual(rank(catalog, mode, { contentLanguages: undefined, translationTarget: 'zh-TW' }), original);
    const none = rank(catalog, mode, { contentLanguages: [] });
    assert.deepEqual(none.items, []); assert.equal(none.poolCount, 0); assert.equal(none.metadata.excluded.language, 3);
    if (mode !== 'personal') assert(!Object.hasOwn(original.metadata.excluded, 'language'));
  }
  const inspection = Recommendations.inspectSignals(liked(), { now: NOW });
  assert.deepEqual(Recommendations.inspectSignals(liked(), { now: NOW, contentLanguages: null }), inspection);
  assert(!Object.hasOwn(inspection.excluded, 'languageOff'));
  const none = Recommendations.inspectSignals(liked(), { now: NOW, contentLanguages: [] });
  assert.equal(none.signalCount, 0); assert.equal(none.excluded.languageOff, 1);
});
test('a different-language like from the same active source cannot remain a personal prototype', () => {
  const catalog = feed([article('new-ko', 'ko-KR'), article('new-en', 'en-US')]), actions = liked('en-US');
  for (const baselineMode of ['related', 'latest']) {
    const result = rank(catalog, 'personal', { actions, contentLanguages: ['ko'], baselineMode });
    const baseline = Discovery.rank(catalog, { profile, now: NOW, mode: baselineMode, contentLanguages: ['ko'] });
    assert.deepEqual(result, baseline);
  }
  const inspection = Recommendations.inspectSignals(actions, { now: NOW, sourceIds: [source.id], contentLanguages: ['ko'] });
  assert.equal(inspection.signalCount, 0); assert.equal(inspection.excluded.languageOff, 1); assert.equal(inspection.excluded.sourceOff, 0);
  const before = structuredClone(actions), enabled = rank(catalog, 'personal', { actions, contentLanguages: ['en'] });
  assert(enabled.metadata.personalization?.applied); assert.deepEqual(enabled.items.map(row => row.article.id), ['new-en']);
  assert.deepEqual(actions, before, 'language changes cannot rewrite or erase saved reactions');
  const koActions = liked('ko-KR');
  assert.equal(rank(catalog, 'personal', { actions: koActions, contentLanguages: ['ko'] }).items[0].personal.score,
    rank(feed([article('new-ko', 'ko-KR')]), 'personal', { actions: koActions }).items[0].personal.score, 'lexical scoring is unchanged');
});
test('publisher language cannot promote unknown or override explicit article language and source failure remains visible', () => {
  const catalog = feed([article('unknown', 'und'), article('english', 'en-US')]);
  Object.assign(catalog.sources[0], { language: 'ko', status: 'error', stale: true, error: '합성 갱신 실패' });
  assert.deepEqual(rank(catalog, 'latest', { contentLanguages: ['ko'] }).items, []);
  const english = rank(catalog, 'latest', { contentLanguages: ['en'] }); assert.deepEqual(english.items.map(row => row.article.id), ['english']);
  assert.equal(english.metadata.sources[0].status, 'error'); assert.equal(english.metadata.sources[0].language, 'ko');
  catalog.sources[0].language = 'en';
  assert.deepEqual(rank(catalog, 'latest', { contentLanguages: ['en'] }).items.map(row => row.article.id), ['english']);
  assert.deepEqual(rank(catalog, 'latest', { contentLanguages: ['und'] }).items.map(row => row.article.id), ['unknown']);
});
test('language filtering precedes dedup without bypassing canonical known/read/hide or rights validation', () => {
  const original = article('ko', 'ko-KR');
  const catalog = feed([article('english-first', 'en-US', { url: original.url + '&utm_source=duplicate' }), original,
    article('bad-rights', 'ko', { coverage: 'full_text', bodyText: '본문', rights })]);
  const options = { profile, now: NOW, contentLanguages: ['ko'] }, result = Discovery.rank(catalog, options);
  assert.deepEqual(result.items.map(row => row.article.id), ['ko']);
  assert.deepEqual(result.metadata.excluded, { known: 0, feedback: 0, duplicate: 0, invalid: 1, language: 1 });
  assert.equal(Discovery.rank(catalog, { ...options, knownUrls: [original.url + '&fbclid=tracking#part'] }).items.length, 0);
  for (const kind of ['already_read', 'not_relevant']) assert.equal(Discovery.rank(catalog, { ...options,
    feedback: { feedback: [{ canonicalUrl: Discovery.canonicalUrl(original.url), kind }] } }).items.length, 0);
});
test('explicit baseline modes still ignore action input under language selection', () => {
  const catalog = feed([article('ko', 'ko-KR'), article('en', 'en-US')]);
  for (const mode of ['related', 'latest']) {
    const options = { mode, profile, now: NOW, contentLanguages: ['ko'] };
    assert.deepEqual(Recommendations.rank(catalog, { ...options, actions: { invalidPrivateState: true } }), Discovery.rank(catalog, options));
  }
});
test('five simultaneous languages filter candidates and personal evidence together while translation and regional metadata remain independent', () => {
  const Settings = require('../assets/life/discovery-language-settings.js');
  const languages = ['ko-KR', 'en-GB', 'ja-JP', 'zh-Hant-TW', 'fr-CA', 'es-MX', 'de-CH', 'unknown', 'mixed', 'pt-BR'];
  const items = languages.map((language, index) => article('candidate-' + index, language, { title: '😀 cobalt lattice records' }));
  const catalog = feed(items), selection = ['ko', 'en', 'ja', 'zh', 'fr'], literalProfile = { manual: [{ id: 'literal-interest', label: 'cobalt' }] };
  let actions = Actions.empty('synthetic-language-workspace');
  const allowedPrototypes = new Set(), prototypeByLanguage = new Map();
  for (const [index, language] of languages.entries()) {
    const snapshot = Actions.capture(article('prior-' + index, language, { title: '😀 cobalt lattice records' }), source);
    prototypeByLanguage.set(language, snapshot.canonicalUrl);
    actions = Actions.setReaction(actions, snapshot, 'liked', true, { expectedRevision: actions.revision, now: PAST });
    if (index < 5) allowedPrototypes.add(snapshot.canonicalUrl);
  }
  actions = Actions.setPersonalization(actions, true, { expectedRevision: actions.revision, now: PAST });
  const before = structuredClone({ catalog, actions, selection }), inspection = Recommendations.inspectSignals(actions, { now: NOW, contentLanguages: selection });
  assert.equal(inspection.signalCount, 5); assert.equal(inspection.excluded.languageOff, 5);
  for (const mode of ['latest', 'related', 'personal']) {
    const result = rank(catalog, mode, { contentLanguages: selection, actions, profile: literalProfile });
    assert.deepEqual(result.items.map(item => item.article.id).sort(), items.slice(0, 5).map(item => item.id).sort());
    assert.equal(result.poolCount, 5); assert.equal(result.metadata.excluded.language, 5);
    if (mode === 'personal') {
      assert.equal(result.metadata.personalization.applied, true);
      for (const item of result.items) for (const evidence of item.personal.evidence) assert(allowedPrototypes.has(evidence.canonicalUrl));
    }
    for (const translationTarget of Settings.TRANSLATION_TARGET_CODES)
      assert.deepEqual(rank(catalog, mode, { contentLanguages: selection, translationTarget, actions, profile: literalProfile }), result);
  }
  const french = rank(catalog, 'personal', { contentLanguages: ['fr'], actions, profile: literalProfile });
  assert.deepEqual(french.items.map(item => item.article.id), ['candidate-4']);
  assert(french.items[0].personal.evidence.every(evidence => evidence.canonicalUrl === prototypeByLanguage.get('fr-CA')));
  assert.equal(Recommendations.inspectSignals(actions, { now: NOW, contentLanguages: ['fr'] }).signalCount, 1);
  assert.deepEqual({ catalog, actions, selection }, before);
  assert.deepEqual(catalog.articles.map(item => item.language), languages);
});

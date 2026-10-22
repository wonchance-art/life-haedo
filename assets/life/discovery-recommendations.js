/* Local lexical policy, not a learned model, probability or usefulness estimate.
 * Only explicit past likes of public title/tags contribute. No I/O or cache. */
(function (root, factory) {
  'use strict';
  const api = factory(
    () => root.HaedoLife?.Discovery || (typeof require === 'function' && require('./discovery.js')),
    () => root.HaedoLife?.DiscoveryActions || (typeof require === 'function' && require('./discovery-actions.js'))
  );
  (root.HaedoLife ||= {}).DiscoveryRecommendations = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (discovery, actionsApi) {
  'use strict';
  const POLICY = 'public-title-tag-expressions-v4';
  const MIN_SHARED_TERMS = 2;
  // Deliberately conservative: no stemming, Korean particle removal, inferred
  // topics or arbitrary substring matching. Title words and whole official tags
  // are expressions; a multiword tag never supplies several independent terms.
  // Two-letter abbreviations are kept.
  // Only existing reviewed, single-token Discovery aliases are equivalent.
  const STOP_WORDS = new Set(('대한 통한 위한 방법 이야기 소식 소개 안내 새로운 우리 함께 무엇 어떻게 오늘 이번 뉴스 기자 기사 발표 해당 대해 관련 ' +
    '있는 하는 한다 있다 그리고 또는 하지만 것을 것이 이유 ' +
    'the and for with from this that into about your our are was were have has how new news guide of in to is it on by as at be or an').split(' '));
  const fold = value => value.replace(/[A-Z]/g, character => character.toLowerCase());
  function check(condition) {
    if (!condition) throw Object.assign(new Error('추천에 사용할 좋아요와 기준 시각을 확인해 주세요.'), { code: 'discovery_profile_invalid' });
  }
  function clock(value) {
    const raw = typeof value === 'function' ? value() : value;
    const stamp = raw === undefined ? Date.now() : typeof raw === 'number' ? raw : typeof raw === 'string' ? Date.parse(raw) : NaN;
    check(Number.isFinite(stamp)); return stamp;
  }
  function aliases() {
    const result = new Map();
    for (const group of discovery().ALIASES) for (const value of group) if (/^[\p{L}\p{N}_]+$/u.test(value)) result.set(fold(value), fold(group[0]));
    return result;
  }
  function features(snapshot, equivalences) {
    const result = new Map();
    function add(field, quote, start, tagIndex) {
      const raw = fold(quote), length = [...raw].length;
      if (length < 2 || length > (field === 'tags' ? 200 : 64) || !/\p{L}/u.test(raw) || STOP_WORDS.has(raw)) return;
      // Keep the old stop-word/abbreviation gate without turning the words
      // inside a tag into separately matchable or countable features.
      if (field === 'tags' && ![...raw.matchAll(/[\p{L}\p{N}_]+/gu)].some(match => {
        const size = [...match[0]].length;
        return size >= 2 && size <= 64 && /\p{L}/u.test(match[0]) && !STOP_WORDS.has(match[0]);
      })) return;
      const term = equivalences.get(raw) || raw;
      const feature = { field, ...(tagIndex === undefined ? {} : { tagIndex }), start, end: start + quote.length, quote, term };
      // Repetition never increases the score. Prefer official tag provenance.
      if (!result.has(term) || result.get(term).field === 'title' && field === 'tags') result.set(term, feature);
    }
    for (const match of snapshot.title.matchAll(/[\p{L}\p{N}_]+/gu)) add('title', match[0], match.index);
    snapshot.tags.forEach((tag, tagIndex) => { const quote = tag.trim(); add('tags', quote, tag.indexOf(quote), tagIndex); });
    return result;
  }
  function signalsFor(actions, options, now, equivalences) {
    if (actions != null) actionsApi().validate(actions);
    // Validate even empty selections/actions, and use the core's exact same
    // publisher-language rule for past prototypes and new candidate articles.
    discovery().languageAllowed(undefined, options.contentLanguages);
    const sourceIds = options.sourceIds;
    check(sourceIds === undefined || Array.isArray(sourceIds) && sourceIds.every(id => Object.hasOwn(discovery().ALLOWED_SOURCES, id)));
    const active = sourceIds === undefined ? null : new Set(sourceIds), signals = [], likedUrls = new Set();
    const excluded = { notLiked: 0, excluded: 0, future: 0, sourceOff: 0, insufficientTerms: 0 };
    if (options.contentLanguages != null) excluded.languageOff = 0;
    for (const entry of actions?.entries || []) {
      if (!entry.liked) { excluded.notLiked++; continue; }
      if (Date.parse(entry.likedAt) > now || Date.parse(entry.snapshot.fetchedAt) > now) { excluded.future++; continue; }
      if (active && !active.has(entry.snapshot.sourceId)) { excluded.sourceOff++; continue; }
      likedUrls.add(entry.canonicalUrl);
      if (!discovery().languageAllowed(entry.snapshot.language, options.contentLanguages)) { excluded.languageOff++; continue; }
      if (entry.excludedFromRecommendations) { excluded.excluded++; continue; }
      const tokens = features(entry.snapshot, equivalences);
      if (tokens.size < MIN_SHARED_TERMS) { excluded.insufficientTerms++; continue; }
      signals.push({ entry, tokens });
    }
    const enabled = !!actions && !actions.deleted && actions.personalizationEnabled;
    return { signals, likedUrls, inspection: { enabled, signalCount: signals.length,
      reason: !enabled ? 'disabled' : !signals.length ? 'insufficient_signal' : 'ready', policy: POLICY, excluded } };
  }
  // Pass the currently enabled source IDs when displaying the effective count.
  // This returns counts only; it does not retain or expose the derived features.
  function inspectSignals(actions, options = {}) {
    return signalsFor(actions, options, clock(options.now), aliases()).inspection;
  }
  function rank(input, options = {}) {
    const core = discovery();
    // Explicit baseline modes never consult reactions at all.
    if (options.mode !== 'personal') return core.rank(input, options);
    const baselineMode = options.baselineMode || 'related'; check(['related', 'latest'].includes(baselineMode));
    const now = clock(options.now), prepared = core.candidatePool(input, { ...options, now, mode: baselineMode });
    const baseline = core.rankPool(prepared), equivalences = aliases();
    // The caller owns account isolation. When workspace identities are explicit,
    // reject mixed projections rather than deriving features across workspaces.
    if (options.actions != null) for (const workspaceId of [options.profile?.workspaceId, options.feedback?.workspaceId]) {
      check(workspaceId === undefined || workspaceId === options.actions.workspaceId);
    }
    const { signals, likedUrls, inspection } = signalsFor(options.actions, { sourceIds: prepared.feed.sources.map(source => source.id), contentLanguages: prepared.contentLanguages }, now, equivalences);
    if (!inspection.enabled || !signals.length) return baseline;
    // Inverted index reuses the one validated <=500-article pool; no repeated
    // catalog validation, per-like catalog copies, network or persistent cache.
    const index = new Map();
    signals.forEach((signal, signalIndex) => {
      for (const [term, feature] of signal.tokens) {
        if (!index.has(term)) index.set(term, []);
        index.get(term).push({ signalIndex, feature });
      }
    });
    const ranked = [];
    for (const row of prepared.pool) {
      if (likedUrls.has(row.article.canonicalUrl) || row.article.dateStatus === 'future') continue;
      const intersections = new Map();
      for (const [term, candidate] of features(row.article, equivalences)) for (const match of index.get(term) || []) {
        if (!intersections.has(match.signalIndex)) intersections.set(match.signalIndex, []);
        intersections.get(match.signalIndex).push({ candidate, feature: match.feature });
      }
      let best = null;
      for (const [signalIndex, matches] of intersections) {
        if (matches.length < MIN_SHARED_TERMS) continue;
        const signal = signals[signalIndex], score = matches.reduce((sum, match) => sum + 1 + Number(match.feature.field === 'tags' && match.candidate.field === 'tags'), 0);
        if (!best || score > best.score || score === best.score && signal.entry.canonicalUrl.localeCompare(best.signal.entry.canonicalUrl) < 0) best = { signal, matches, score };
      }
      if (best) ranked.push({ ...row, ...best });
    }
    if (!ranked.length) return baseline;
    const date = row => row.article.sortDate ? Date.parse(row.article.sortDate) : -Infinity;
    ranked.sort((a, b) => b.score - a.score || b.strength - a.strength || b.interests - a.interests || date(b) - date(a) || a.article.canonicalUrl.localeCompare(b.article.canonicalUrl));
    // Bounded source variety: promote an unused source only within one lexical
    // point of the best remaining row. Every selected row already has >=2
    // shared expressions with one past like. Never pad with unrelated catalog items.
    const remaining = [...ranked], selected = [], usedSources = new Set();
    while (remaining.length && selected.length < prepared.limit) {
      let at = remaining.findIndex(row => !usedSources.has(row.article.sourceId) && row.score >= remaining[0].score - 1);
      if (at < 0) at = 0;
      const [row] = remaining.splice(at, 1); selected.push(row); usedSources.add(row.article.sourceId);
    }
    const items = selected.map(row => ({ article: row.article, reasons: row.reasons.map(({ weight, ...reason }) => reason),
      personal: { policy: POLICY, score: row.score, evidence: row.matches.map(({ feature, candidate }) => ({
        canonicalUrl: row.signal.entry.canonicalUrl, title: row.signal.entry.snapshot.title, sourceName: row.signal.entry.snapshot.sourceName,
        ...feature, candidateField: candidate.field, ...(candidate.tagIndex === undefined ? {} : { candidateTagIndex: candidate.tagIndex }),
        candidateStart: candidate.start, candidateEnd: candidate.end, candidateQuote: candidate.quote
      })) } }));
    return { ...baseline, items, eligibleCount: ranked.length, metadata: { ...baseline.metadata, mode: 'personal',
      personalization: { enabled: true, applied: true, reason: 'applied', policy: POLICY, signalCount: signals.length },
      limitation: '과거 좋아요와 겹친 제목 단어·태그 전체 표현 중 서로 다른 2개 이상을 기준으로 고른 결과입니다. 태그 한 개는 한 표현입니다. 점수는 규칙값이며 같은 단어라도 문맥은 다를 수 있습니다.' } };
  }
  return Object.freeze({ POLICY, MIN_SHARED_TERMS, inspectSignals, rank });
});

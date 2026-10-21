/* Explicit, local reading judgments over frozen public metadata. No storage,
 * requests, reaction mutations or inferred reading/usefulness. */
(function (root, factory) {
  'use strict';
  const api = factory(root); (root.HaedoLife ||= {}).DiscoveryReading = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const MAX_BYTES = 512 * 1024;
  const INTENTS = Object.freeze(['yes', 'no']);
  const READINGS = Object.freeze(['not_read', 'partial', 'full', 'unavailable']);
  const REASONS = Object.freeze(['off_topic', 'too_technical', 'already_known', 'other']);
  const PREFERENCES = Object.freeze(['latest', 'related', 'personal', 'tie', 'undecided']);
  // Persisted evidence is interpreted by its own known policy, not whatever
  // policy a later live ranker happens to export.
  const KNOWN_PERSONAL_POLICIES = Object.freeze(['public-title-tag-expressions-v2', 'public-title-tag-expressions-v3']);
  const names = { Discovery: 'discovery', DiscoveryActions: 'discovery-actions', DiscoveryRecommendations: 'discovery-recommendations',
    DiscoveryProfile: 'discovery-profile', DiscoveryLanguageSettings: 'discovery-language-settings', InterestProfile: 'interest-profile' };
  const dep = name => root.HaedoLife?.[name] || (typeof require === 'function' && require('./' + names[name] + '.js'));
  const copy = value => structuredClone(value);
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const stamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
  function check(value, code = 'discovery_reading_invalid') {
    if (!value) throw Object.assign(new Error(code === 'discovery_reading_conflict' ? '읽기 비교가 바뀌었습니다. 최신 내용을 확인해 주세요.' :
      code === 'discovery_reading_too_large' ? '읽기 비교 보관 한도를 넘었습니다. 기존 비교는 유지했습니다.' :
      code === 'discovery_reading_exists' ? '기존 읽기 비교를 먼저 확인하거나 삭제해 주세요.' : '읽기 비교의 조건과 직접 입력한 판단을 확인해 주세요.'), { code });
  }
  function fields(value, required, optional = []) {
    check(plain(value)); const keys = Reflect.ownKeys(value);
    check(required.every(key => Object.hasOwn(value, key)) && keys.every(key => typeof key === 'string' && [...required, ...optional].includes(key) &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')));
  }
  function array(value, max) {
    check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= max && Reflect.ownKeys(value).length === value.length + 1);
    for (let i = 0; i < value.length; i++) check(Object.hasOwn(value, i) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(i)), 'value'));
  }
  function text(value, max, empty = false) {
    check(typeof value === 'string' && value.length <= max && (empty || value.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(value));
  }
  function ids(value, max) { array(value, max); check(value.every(id) && new Set(value).size === value.length); }
  function tree(value, depth = 0, budget = { count: 0 }) {
    check(depth < 40 && ++budget.count < 200000);
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
    if (typeof value === 'number') { check(Number.isFinite(value)); return; }
    if (Array.isArray(value)) { array(value, 200000); for (const child of value) tree(child, depth + 1, budget); return; }
    check(plain(value));
    for (const key of Reflect.ownKeys(value)) { check(typeof key === 'string' && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')); tree(value[key], depth + 1, budget); }
  }
  function bounded(value) { check(new TextEncoder().encode(JSON.stringify(value)).length <= MAX_BYTES, 'discovery_reading_too_large'); }
  function nullable(value, choices) { check(value === null || choices.includes(value)); }
  function publicURL(value) {
    check(typeof value === 'string' && value === dep('Discovery').canonicalUrl(value)); return value;
  }
  function span(raw, value, start = 'start', end = 'end', quote = 'quote') {
    check(integer(value[start]) && Number.isSafeInteger(value[end]) && value[end] > value[start] && value[end] <= 200000 &&
      typeof value[quote] === 'string' && value[quote].length === value[end] - value[start]);
    if (raw !== null) check(typeof raw === 'string' && raw.slice(value[start], value[end]) === value[quote]);
  }
  function snapshot(value) {
    fields(value, ['id', 'sourceId', 'sourceName', 'url', 'canonicalUrl', 'title', 'author', 'language', 'tags', 'publishedAt', 'updatedAt', 'fetchedAt', 'coverage', 'rights']);
    fields(value.rights, ['label', 'url', 'mode']); array(value.tags, 50);
    check(value.coverage === 'link_only' && value.rights.mode === 'metadata_only');
    dep('DiscoveryActions').capture(value, { id: value.sourceId, name: value.sourceName });
  }
  function manual(value) {
    array(value, 40); const seen = new Set();
    for (const item of value) { fields(item, ['id', 'label']); check(id(item.id) && !seen.has(item.id)); seen.add(item.id); text(item.label, 200); }
  }
  function reason(value, article, interests) {
    fields(value, ['interestId', 'interestLabel', 'field', 'start', 'end', 'quote', 'matchedTerm', 'via'], ['tagIndex']);
    check(interests.some(item => item.id === value.interestId && item.label === value.interestLabel));
    check(['title', 'tags', 'summary', 'bodyText'].includes(value.field) && ['exact', 'alias'].includes(value.via));
    text(value.matchedTerm, 200); text(value.quote, 200);
    check(value.field === 'tags' ? integer(value.tagIndex) && value.tagIndex < article.tags.length : !Object.hasOwn(value, 'tagIndex'));
    span(value.field === 'tags' ? article.tags[value.tagIndex] : value.field === 'title' ? article.title : null, value);
  }
  function personalReason(value, article, original) {
    fields(value, ['canonicalUrl', 'title', 'sourceName', 'field', 'start', 'end', 'quote', 'term', 'candidateField', 'candidateStart', 'candidateEnd', 'candidateQuote'], ['tagIndex', 'candidateTagIndex']);
    check(value.canonicalUrl === original.canonicalUrl && value.title === original.title && value.sourceName === original.sourceName);
    text(value.term, 200); text(value.quote, 200); text(value.candidateQuote, 200);
    check(['title', 'tags'].includes(value.field) && ['title', 'tags'].includes(value.candidateField));
    check(value.field === 'tags' ? integer(value.tagIndex) && value.tagIndex < original.tags.length : !Object.hasOwn(value, 'tagIndex'));
    check(value.candidateField === 'tags' ? integer(value.candidateTagIndex) && value.candidateTagIndex < article.tags.length : !Object.hasOwn(value, 'candidateTagIndex'));
    span(value.field === 'tags' ? original.tags[value.tagIndex] : original.title, value);
    span(value.candidateField === 'tags' ? article.tags[value.candidateTagIndex] : article.title, value, 'candidateStart', 'candidateEnd', 'candidateQuote');
  }
  function review(value) {
    fields(value, ['canonicalUrl', 'intent', 'reading', 'helpful', 'reason']); publicURL(value.canonicalUrl);
    nullable(value.intent, INTENTS); nullable(value.reading, READINGS); nullable(value.helpful, INTENTS); nullable(value.reason, REASONS);
    check(['partial', 'full'].includes(value.reading) || value.helpful === null && value.reason === null);
  }
  function count(value) {
    fields(value, ['eligibleCount', 'poolCount', 'excluded']); check(integer(value.eligibleCount) && integer(value.poolCount) && value.eligibleCount <= value.poolCount && value.poolCount <= 500);
    fields(value.excluded, ['known', 'feedback', 'duplicate', 'invalid'], ['language']);
    for (const number of Object.values(value.excluded)) check(integer(number) && number <= 500);
  }
  function validateSession(session) {
    fields(session, ['id', 'createdAt', 'rankInputSHA256', 'generatedAt', 'stale', 'conditions', 'sources', 'lists', 'counts', 'personal', 'articles', 'reviews', 'preference']);
    check(id(session.id) && stamp(session.createdAt) && stamp(session.generatedAt) && Date.parse(session.generatedAt) <= Date.parse(session.createdAt) + 300000 &&
      typeof session.rankInputSHA256 === 'string' && /^[a-f0-9]{64}$/.test(session.rankInputSHA256) && typeof session.stale === 'boolean');
    const c = session.conditions;
    fields(c, ['contentLanguages', 'translationTarget', 'manual', 'sourceIds', 'knownUrlCount', 'feedbackCount', 'profileRevision', 'feedbackRevision', 'actionsRevision', 'personalAllowed', 'personalOptIn', 'baselineMode']);
    check(c.contentLanguages === null || Array.isArray(c.contentLanguages)); dep('Discovery').languageAllowed(null, c.contentLanguages);
    check(dep('DiscoveryLanguageSettings').TRANSLATION_TARGET_CODES.includes(c.translationTarget)); manual(c.manual); ids(c.sourceIds, 20);
    check(c.sourceIds.every(value => Object.hasOwn(dep('Discovery').ALLOWED_SOURCES, value)) && integer(c.knownUrlCount) && c.knownUrlCount <= 500 && integer(c.feedbackCount) && c.feedbackCount <= 500);
    for (const key of ['profileRevision', 'feedbackRevision', 'actionsRevision']) check(c[key] === null || integer(c[key]));
    check(typeof c.personalAllowed === 'boolean' && typeof c.personalOptIn === 'boolean' && ['latest', 'related'].includes(c.baselineMode));
    array(session.sources, 20);
    for (const source of session.sources) { fields(source, ['id', 'name', 'url', 'feedUrl', 'language', 'rights', 'status', 'lastSuccessAt', 'lastAttemptAt', 'error', 'freshnessMaxAgeDays', 'stale']); fields(source.rights, ['label', 'url', 'mode']); }
    dep('Discovery').validateFeed({ schemaVersion: 1, generatedAt: session.generatedAt, sources: session.sources, articles: [] }, { now: session.createdAt });
    check(JSON.stringify(session.sources.map(source => source.id)) === JSON.stringify(c.sourceIds));
    fields(session.lists, ['latest', 'related', 'personal']); fields(session.counts, ['latest', 'related', 'personal']);
    const activePersonal = c.personalAllowed && c.personalOptIn, urls = new Set();
    check(activePersonal ? Array.isArray(session.lists.personal) && session.counts.personal !== null : session.lists.personal === null && session.counts.personal === null);
    for (const mode of ['latest', 'related', ...(activePersonal ? ['personal'] : [])]) {
      const list = session.lists[mode]; array(list, 2); check(new Set(list).size === list.length); for (const url of list) { publicURL(url); urls.add(url); }
      count(session.counts[mode]); check(list.length === Math.min(2, session.counts[mode].eligibleCount));
    }
    check(session.counts.latest.poolCount === session.counts.related.poolCount);
    fields(session.personal, ['status', 'applied', 'policy', 'signalCount']);
    check(['disabled', 'insufficient_signal', 'no_overlap', 'applied'].includes(session.personal.status) && typeof session.personal.applied === 'boolean' && integer(session.personal.signalCount) && session.personal.signalCount <= 500);
    check(session.personal.applied === (session.personal.status === 'applied'));
    check(session.personal.policy === null || KNOWN_PERSONAL_POLICIES.includes(session.personal.policy));
    if (!activePersonal) check(session.personal.status === 'disabled' && session.personal.signalCount === 0 && session.personal.policy === null);
    else {
      check(session.personal.status !== 'disabled' && KNOWN_PERSONAL_POLICIES.includes(session.personal.policy));
      if (!session.personal.applied) check(JSON.stringify(session.lists.personal) === JSON.stringify(session.lists[c.baselineMode]) && JSON.stringify(session.counts.personal) === JSON.stringify(session.counts[c.baselineMode]));
    }
    array(session.articles, 6); check(session.articles.length === urls.size); const seen = new Set();
    for (const item of session.articles) {
      fields(item, ['snapshot', 'reasons', 'personal']); snapshot(item.snapshot);
      const article = item.snapshot; check(urls.has(article.canonicalUrl) && !seen.has(article.canonicalUrl) && c.sourceIds.includes(article.sourceId) && dep('Discovery').languageAllowed(article.language, c.contentLanguages)); seen.add(article.canonicalUrl);
      array(item.reasons, 20000); item.reasons.forEach(value => reason(value, article, c.manual));
      if (item.personal !== null) {
        check(session.personal.applied && session.lists.personal.includes(article.canonicalUrl));
        fields(item.personal, ['policy', 'score', 'evidence', 'sourceSnapshot']); check(item.personal.policy === session.personal.policy && integer(item.personal.score) && item.personal.score > 0);
        snapshot(item.personal.sourceSnapshot); const original = item.personal.sourceSnapshot;
        check(original.canonicalUrl !== article.canonicalUrl && c.sourceIds.includes(original.sourceId) && dep('Discovery').languageAllowed(original.language, c.contentLanguages) && Date.parse(original.fetchedAt) <= Date.parse(session.createdAt));
        array(item.personal.evidence, 100); check(item.personal.evidence.length >= 2); item.personal.evidence.forEach(value => personalReason(value, article, original));
      }
    }
    if (session.personal.applied) check(session.lists.personal.every(url => session.articles.some(item => item.snapshot.canonicalUrl === url && item.personal !== null)));
    array(session.reviews, 6); check(session.reviews.length === urls.size); const reviewed = new Set();
    for (const value of session.reviews) { review(value); check(urls.has(value.canonicalUrl) && !reviewed.has(value.canonicalUrl)); reviewed.add(value.canonicalUrl); }
    nullable(session.preference, PREFERENCES); if (session.preference === 'personal') check(activePersonal);
  }
  function validate(profile) {
    try {
      tree(profile); fields(profile, ['schemaVersion', 'workspaceId', 'revision', 'deleted', 'updatedAt', 'session']);
      check(profile.schemaVersion === 1 && id(profile.workspaceId) && integer(profile.revision) && typeof profile.deleted === 'boolean');
      check(profile.revision === 0 ? profile.updatedAt === null && !profile.deleted && profile.session === null : stamp(profile.updatedAt));
      if (profile.deleted) check(profile.session === null);
      if (profile.session !== null) { validateSession(profile.session); check(Date.parse(profile.updatedAt) >= Date.parse(profile.session.createdAt)); }
      bounded(profile); return true;
    } catch (error) { check(false, error.code === 'discovery_reading_too_large' ? error.code : 'discovery_reading_invalid'); }
  }
  function empty(workspaceId) { const value = { schemaVersion: 1, workspaceId, revision: 0, deleted: false, updatedAt: null, session: null }; validate(value); return value; }
  function next(profile, options, creating = false) {
    validate(profile); fields(options, ['expectedRevision', 'now'], creating ? ['sessionId'] : []);
    check(integer(options.expectedRevision) && options.expectedRevision === profile.revision && profile.revision < Number.MAX_SAFE_INTEGER, 'discovery_reading_conflict');
    check(stamp(options.now) && (profile.updatedAt === null || Date.parse(options.now) >= Date.parse(profile.updatedAt)));
    return { ...copy(profile), revision: profile.revision + 1, deleted: false, updatedAt: options.now };
  }
  function finish(value) { validate(value); return value; }
  function projectedInput(input, workspaceId, now) {
    tree(input); fields(input, ['feed', 'profile', 'feedback', 'knownUrls', 'contentLanguages', 'actions', 'translationTarget', 'personalAllowed'], ['baselineMode']);
    fields(input.feed, ['schemaVersion', 'generatedAt', 'sources', 'articles'], ['stale', 'validation']);
    array(input.feed.sources, 20); array(input.feed.articles, 500);
    for (const source of input.feed.sources) { fields(source, ['id', 'name', 'url', 'feedUrl', 'language', 'rights', 'status', 'lastSuccessAt', 'lastAttemptAt', 'error', 'stale'], ['freshnessMaxAgeDays']); fields(source.rights, ['label', 'url', 'mode']); }
    for (const article of input.feed.articles) { fields(article, ['id', 'sourceId', 'url', 'title', 'author', 'language', 'publishedAt', 'fetchedAt', 'coverage', 'summary', 'rights'], ['canonicalUrl', 'tags', 'updatedAt', 'dateStatus', 'dateBasis', 'sortDate', 'bodyText']); fields(article.rights, ['label', 'url', 'mode']); }
    if (Object.hasOwn(input.feed, 'validation')) {
      fields(input.feed.validation, ['invalid', 'suppliedArticles']); array(input.feed.validation.invalid, 500);
      check(integer(input.feed.validation.suppliedArticles) && input.feed.validation.suppliedArticles <= 500);
      for (const row of input.feed.validation.invalid) { fields(row, ['id', 'reason']); check((row.id === null || id(row.id)) && row.reason === 'invalid_article'); }
    }
    const feed = dep('Discovery').validateFeed(input.feed, { now });
    // The UI already removed unsafe rows and reports their count. Preserve that
    // report; a newly invalid row supplied to this API is still an input error.
    check(feed.validation.invalid.length === (input.feed.validation?.invalid.length || 0));
    if (Object.hasOwn(input.profile, 'schemaVersion')) {
      fields(input.profile, ['schemaVersion', 'workspaceId', 'revision', 'deleted', 'manual', 'analysis', 'confirmedIds', 'updatedAt']);
      dep('InterestProfile').validate(input.profile);
    } else fields(input.profile, ['manual'], ['workspaceId', 'revision']);
    check(input.profile.workspaceId === undefined || input.profile.workspaceId === workspaceId); manual(input.profile.manual);
    check(input.profile.revision === undefined || integer(input.profile.revision));
    const profile = { workspaceId, manual: input.profile.deleted ? [] : copy(input.profile.manual) };
    let feedback;
    if (Array.isArray(input.feedback)) {
      feedback = { ...dep('DiscoveryProfile').empty(workspaceId), revision: 1, updatedAt: now, feedback: copy(input.feedback) };
    } else { dep('DiscoveryProfile').validate(input.feedback); check(input.feedback.workspaceId === workspaceId); feedback = copy(input.feedback); }
    dep('DiscoveryProfile').validate(feedback);
    for (const row of feedback.feedback) { fields(row, ['articleId', 'canonicalUrl', 'kind', 'updatedAt']); check(stamp(row.updatedAt) && Date.parse(row.updatedAt) <= Date.parse(now)); }
    array(input.knownUrls, 500); for (const value of input.knownUrls) {
      text(value, 8192); let address; try { address = new URL(value); } catch (_) { check(false); }
      check(['https:', 'http:'].includes(address.protocol) && !address.username && !address.password);
    }
    check(input.contentLanguages === null || Array.isArray(input.contentLanguages)); dep('Discovery').languageAllowed(null, input.contentLanguages);
    const contentLanguages = copy(input.contentLanguages);
    check(dep('DiscoveryLanguageSettings').TRANSLATION_TARGET_CODES.includes(input.translationTarget) && typeof input.personalAllowed === 'boolean');
    const baselineMode = input.baselineMode === undefined ? 'related' : input.baselineMode; check(['latest', 'related'].includes(baselineMode));
    if (input.actions !== null) { dep('DiscoveryActions').validate(input.actions); check(input.actions.workspaceId === workspaceId); }
    const personalOptIn = !!input.actions && !input.actions.deleted && input.actions.personalizationEnabled;
    return { feed, profile, feedback, knownUrls: copy(input.knownUrls), contentLanguages, actions: input.personalAllowed && personalOptIn ? copy(input.actions) : null,
      personalAllowed: input.personalAllowed, personalOptIn, translationTarget: input.translationTarget, baselineMode,
      revisions: { profileRevision: input.profile.revision ?? null, feedbackRevision: Array.isArray(input.feedback) ? null : input.feedback.revision, actionsRevision: input.actions?.revision ?? null } };
  }
  async function digest(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    if (root.crypto?.subtle) return [...new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    check(typeof require === 'function'); return require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  }
  async function createComparison(profile, input, options) {
    try {
      const value = next(profile, options, true); check(profile.session === null, 'discovery_reading_exists'); check(id(options.sessionId)); const sessionId = options.sessionId;
      const fixed = projectedInput(input, profile.workspaceId, options.now), now = options.now;
      const common = { profile: fixed.profile, feedback: fixed.feedback, knownUrls: fixed.knownUrls, contentLanguages: fixed.contentLanguages, now, limit: 2 };
      const results = { latest: dep('Discovery').rank(fixed.feed, { ...common, mode: 'latest' }), related: dep('Discovery').rank(fixed.feed, { ...common, mode: 'related' }) };
      const activePersonal = fixed.personalAllowed && fixed.personalOptIn;
      if (activePersonal) results.personal = dep('DiscoveryRecommendations').rank(fixed.feed, { ...common, mode: 'personal', baselineMode: fixed.baselineMode, actions: fixed.actions });
      const lists = { latest: [], related: [], personal: activePersonal ? [] : null }, counts = { latest: null, related: null, personal: null }, articles = new Map();
      const bySource = new Map(fixed.feed.sources.map(source => [source.id, source]));
      for (const [mode, result] of Object.entries(results)) {
        counts[mode] = { eligibleCount: result.eligibleCount, poolCount: result.poolCount, excluded: copy(result.metadata.excluded) };
        for (const item of result.items) {
          const captured = dep('DiscoveryActions').capture(item.article, bySource.get(item.article.sourceId)); lists[mode].push(captured.canonicalUrl);
          for (const value of item.reasons) span(value.field === 'tags' ? item.article.tags[value.tagIndex] : item.article[value.field], value);
          if (!articles.has(captured.canonicalUrl)) articles.set(captured.canonicalUrl, { snapshot: captured, reasons: copy(item.reasons), personal: null });
          if (item.personal) {
            const original = fixed.actions.entries.find(row => row.canonicalUrl === item.personal.evidence[0]?.canonicalUrl);
            check(original?.liked && !original.excludedFromRecommendations && Date.parse(original.likedAt) <= Date.parse(now));
            articles.get(captured.canonicalUrl).personal = { ...copy(item.personal), sourceSnapshot: copy(original.snapshot) };
          }
        }
      }
      let personal = { status: 'disabled', applied: false, policy: null, signalCount: 0 };
      if (activePersonal) {
        const inspection = dep('DiscoveryRecommendations').inspectSignals(fixed.actions, { now, sourceIds: fixed.feed.sources.map(source => source.id), contentLanguages: fixed.contentLanguages });
        const applied = results.personal.metadata.personalization?.applied === true;
        personal = { status: applied ? 'applied' : inspection.signalCount ? 'no_overlap' : 'insufficient_signal', applied, policy: inspection.policy, signalCount: inspection.signalCount };
      }
      // This fingerprints a normalized ranking input, never the publisher feed
      // file's raw bytes. Private originals/analysis are not projected or kept.
      const rankInputSHA256 = await digest({ feed: fixed.feed, profile: fixed.profile, feedback: fixed.feedback, knownUrls: fixed.knownUrls,
        contentLanguages: fixed.contentLanguages, actions: fixed.actions, translationTarget: fixed.translationTarget,
        personalAllowed: fixed.personalAllowed, personalOptIn: fixed.personalOptIn, baselineMode: fixed.baselineMode, now });
      value.session = { id: sessionId, createdAt: now, rankInputSHA256, generatedAt: fixed.feed.generatedAt, stale: fixed.feed.stale,
        conditions: { contentLanguages: fixed.contentLanguages, translationTarget: fixed.translationTarget, manual: fixed.profile.manual,
          sourceIds: fixed.feed.sources.map(source => source.id), knownUrlCount: fixed.knownUrls.length, feedbackCount: fixed.feedback.deleted ? 0 : fixed.feedback.feedback.length,
          ...fixed.revisions, personalAllowed: fixed.personalAllowed, personalOptIn: fixed.personalOptIn, baselineMode: fixed.baselineMode },
        sources: fixed.feed.sources, lists, counts, personal, articles: [...articles.values()],
        reviews: [...articles.keys()].map(canonicalUrl => ({ canonicalUrl, intent: null, reading: null, helpful: null, reason: null })), preference: null };
      return finish(value);
    } catch (error) { check(false, ['discovery_reading_conflict', 'discovery_reading_exists', 'discovery_reading_too_large'].includes(error.code) ? error.code : 'discovery_reading_invalid'); }
  }
  function setReview(profile, url, patch, options) {
    const result = next(profile, options); check(result.session !== null); publicURL(url);
    fields(patch, [], ['intent', 'reading', 'helpful', 'reason']); check(Reflect.ownKeys(patch).length > 0);
    const row = result.session.reviews.find(value => value.canonicalUrl === url); check(row);
    for (const key of Object.keys(patch)) row[key] = patch[key]; return finish(result);
  }
  function setPreference(profile, value, options) { const result = next(profile, options); check(result.session !== null); result.session.preference = value; return finish(result); }
  function clear(profile, options) { return finish({ ...next(profile, options), deleted: true, session: null }); }
  return Object.freeze({ MAX_BYTES, INTENTS, READINGS, REASONS, PREFERENCES, empty, validate, createComparison, setReview, setPreference, clear });
});

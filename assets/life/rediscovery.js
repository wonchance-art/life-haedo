/* Local, explicit evidence only. Reads fixed versions; no semantic inference or external calls. */
(function (root, factory) {
  'use strict';
  const api = factory(); root.HaedoLife ||= {}; root.HaedoLife.Rediscovery = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function () {
  'use strict';
  const LIMITS = Object.freeze({ bodyCharacters: 16000, results: 3, reasons: 4, minimumTerms: 2,
    termCharacters: 48, snippetCharacters: 180 });
  // Whole tokens only. In particular, Korean particles and verb endings are never stripped.
  const STOP = new Set(('그리고 그러나 하지만 그래서 또한 또는 다만 대한 대해 위한 위해 통해 함께 다시 ' +
    '지금 오늘 어제 내일 이번 지난 다음 최근 그냥 정말 매우 가장 이런 저런 그런 이것 저것 그것 여기 저기 ' +
    '우리 나는 내가 나의 너의 자신 자신의 있는 있다 있었다 없는 없다 없었다 하는 한다 했다 되는 된다 ' +
    '싶은 싶다 같은 같다 생각 기록 자료 본문 제목 메모 내용 경우 정도 만큼 모두 여러 다른 새로운 좋은 ' +
    'the and for with from this that these those about into over under after before have has had ' +
    'are was were been being can could would should will shall not but also then than here there ' +
    'you your our their they them its his her who what when where why how all any some more most ' +
    'only just very really new old one two title text note notes record records content source sources ' +
    'http https www com org net html htm').split(/\s+/));
  function fault(code) {
    const messages = { invalid_request: '관련 기록은 한 번에 1~3개까지 확인할 수 있습니다. 선택한 기록을 다시 열어 주세요.',
      invalid_data: '이 작업공간의 기록이나 정리 구성을 확인하지 못했습니다. 최신 내용을 다시 불러와 주세요.',
      seed_missing: '기준으로 삼은 원문 버전이 없습니다. 기록 목록에서 다른 원문을 골라 주세요.' };
    return Object.assign(new Error(messages[code]), { code });
  }
  function assert(value, code = 'invalid_data') { if (!value) throw fault(code); }
  const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  function boundary(text, offset) {
    if (offset <= 0 || offset >= text.length) return offset;
    const unit = text.charCodeAt(offset);
    return unit >= 0xdc00 && unit <= 0xdfff ? offset - 1 : offset;
  }
  function words(text, field, terms, filter) {
    // Two distinct literal matches are the entire term signal, not a similarity score.
    // Once established, repeated words and the rest of this candidate cannot strengthen it.
    if (filter && (filter.terms.size < LIMITS.minimumTerms || terms.size >= LIMITS.minimumTerms)) return;
    const prefix = text.slice(0, boundary(text, field === 'body' ? Math.min(text.length, LIMITS.bodyCharacters) : text.length));
    // Do not turn domain names, paths or query parameters into topic evidence.
    const urls = [...prefix.matchAll(/\bhttps?:\/\/\S+/giu)].map(match => [match.index, match.index + match[0].length]);
    let urlIndex = 0;
    const matches = prefix.matchAll(filter?.pattern || /[\p{L}\p{N}]+/gu);
    for (const match of matches) {
      const label = filter?.pattern ? match[2] : match[0];
      const offset = match.index + (filter?.pattern ? match[1].length : 0);
      // A word beginning with a digit is not split into a fabricated letter-only suffix.
      if (!/^\p{L}/u.test(label)) continue;
      if (offset + label.length === prefix.length && prefix.length < text.length &&
        /^[\p{L}\p{N}]/u.test(text.slice(prefix.length, prefix.length + 2))) continue;
      while (urls[urlIndex] && urls[urlIndex][1] <= offset) urlIndex++;
      if (urls[urlIndex] && urls[urlIndex][0] <= offset) continue;
      const key = label.toLowerCase();
      if (filter && !filter.terms.has(key)) continue;
      if (key.length < 2 || key.length > LIMITS.termCharacters || STOP.has(key) || /^\p{Script=Latin}{1,2}$/u.test(key)) continue;
      let term = terms.get(key);
      if (!term) { term = { key, label, title: null, body: null }; terms.set(key, term); }
      if (term[field] === null) term[field] = offset;
      if (filter && terms.size >= LIMITS.minimumTerms) break;
    }
  }
  function describe(source, version, filter) {
    assert(typeof source.title === 'string' && source.title.length <= 500);
    const body = version.contentText;
    assert(body === null || typeof body === 'string');
    const terms = new Map(); words(source.title, 'title', terms, filter);
    if (body !== null) words(body, 'body', terms, filter);
    return { terms, body };
  }
  function snippet(text, position = 0) {
    if (text === null || !text) return '';
    const start = boundary(text, Math.max(0, position - 55));
    const end = boundary(text, Math.min(text.length, start + LIMITS.snippetCharacters));
    return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  }
  function related(bundle, workbench, seedVersionId, options = {}) {
    assert(object(options) && Object.keys(options).every(key => key === 'limit'), 'invalid_request');
    const limit = options.limit === undefined ? LIMITS.results : options.limit;
    assert(Number.isInteger(limit) && limit >= 1 && limit <= LIMITS.results && identifier(seedVersionId), 'invalid_request');
    // Storage already validates full Core bundles. Repeating that validator here would scan
    // every historical body; this reader validates only the indexes and versions it consumes.
    assert(object(bundle) && bundle.schemaVersion === 1 && identifier(bundle.workspaceId) &&
      ['sources', 'sourceVersions', 'records', 'tombstones'].every(name => Array.isArray(bundle[name])));
    assert(object(workbench) && workbench.workspaceId === bundle.workspaceId && Array.isArray(workbench.groups));
    const sources = new Map(), versions = new Map(), latest = new Map();
    for (const source of bundle.sources) {
      assert(object(source) && identifier(source.id) && !sources.has(source.id)); sources.set(source.id, source);
    }
    for (const version of bundle.sourceVersions) {
      assert(object(version) && identifier(version.id) && identifier(version.sourceId) &&
        sources.has(version.sourceId) && !versions.has(version.id));
      versions.set(version.id, version); latest.set(version.sourceId, version);
    }
    const seed = versions.get(seedVersionId);
    assert(seed && sources.has(seed.sourceId), 'seed_missing');
    const excluded = new Set();
    if (workbench.discovery !== undefined) {
      assert(object(workbench.discovery) && Array.isArray(workbench.discovery.excludedPairs));
      for (const pair of workbench.discovery.excludedPairs) {
        assert(object(pair) && identifier(pair.seedSourceId) && identifier(pair.candidateSourceId));
        if (pair.seedSourceId === seed.sourceId) excluded.add(pair.candidateSourceId);
      }
    }
    const candidates = [...latest.values()].filter(version => version.sourceId !== seed.sourceId && !excluded.has(version.sourceId));
    if (!candidates.length) return [];
    const needed = new Set([seed.id, ...candidates.map(version => version.id)]);
    const dead = new Set();
    for (const tombstone of bundle.tombstones) {
      assert(object(tombstone) && tombstone.entityType === 'record' && identifier(tombstone.entityId));
      dead.add(tombstone.entityId);
    }
    const topics = new Map();
    for (const record of bundle.records) {
      assert(object(record) && identifier(record.id));
      if (dead.has(record.id)) continue;
      assert(record.kind === 'excerpt' && typeof record.topic === 'string' && record.topic.length <= 500 && Array.isArray(record.sourceRefs));
      const topic = record.topic.trim();
      if (!topic) continue;
      for (const ref of record.sourceRefs) {
        assert(object(ref) && identifier(ref.sourceVersionId) && identifier(ref.sourceId));
        if (!needed.has(ref.sourceVersionId)) continue;
        assert(versions.get(ref.sourceVersionId)?.sourceId === ref.sourceId);
        if (!topics.has(ref.sourceVersionId)) topics.set(ref.sourceVersionId, new Set());
        topics.get(ref.sourceVersionId).add(topic);
      }
    }
    const groups = new Map();
    for (const group of workbench.groups) {
      assert(object(group) && typeof group.title === 'string' && group.title.trim() && group.title.length <= 500 &&
        Array.isArray(group.versionIds) && group.versionIds.every(identifier));
      if (!group.versionIds.includes(seed.id)) continue;
      for (const id of group.versionIds) {
        if (id === seed.id || !needed.has(id)) continue;
        if (!groups.has(id)) groups.set(id, new Set());
        groups.get(id).add(group.title.trim());
      }
    }
    const seedTerms = describe(sources.get(seed.sourceId), seed).terms;
    // A small seed vocabulary can use the engine's native bounded-literal matcher.
    // Larger vocabularies retain the same results via the linear token path; none are truncated.
    const filter = { terms: seedTerms, pattern: null };
    // Some lowercase mappings expand a character (İ -> i + combining dot), which
    // an insensitive literal regexp cannot reverse. Preserve the linear semantics.
    if (seedTerms.size && seedTerms.size <= 512 && [...seedTerms.values()].every(term =>
      term.key.length === term.label.length && /^[\p{L}\p{N}]+$/u.test(term.key))) {
      const alternatives = [...seedTerms.keys()].map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      filter.pattern = new RegExp('(^|[^\\p{L}\\p{N}])(' + alternatives + ')(?![\\p{L}\\p{N}])', 'giu');
    }
    const seedTopics = topics.get(seed.id) || new Set(), results = [];
    for (const version of candidates) {
      const source = sources.get(version.sourceId), current = describe(source, version, filter);
      const groupLabels = [...(groups.get(version.id) || [])].sort(compare);
      const topicLabels = [...(topics.get(version.id) || [])].filter(topic => seedTopics.has(topic)).sort(compare);
      const terms = [...current.terms.values()].filter(term => seedTerms.has(term.key));
      terms.sort((a, b) => Number(b.title !== null) - Number(a.title !== null) || compare(a.key, b.key));
      const hasTerms = terms.length >= LIMITS.minimumTerms;
      if (!groupLabels.length && !topicLabels.length && !hasTerms) continue;
      const reasons = [];
      if (groupLabels.length) reasons.push({ kind: 'group', label: groupLabels[0] });
      if (topicLabels.length) reasons.push({ kind: 'topic', label: topicLabels[0] });
      if (hasTerms) for (const term of terms.slice(0, 2)) {
        const seedTerm = seedTerms.get(term.key);
        const field = term.title !== null && seedTerm.title !== null ? 'title' : term.body !== null && seedTerm.body !== null ? 'body' : null;
        reasons.push({ kind: 'term', label: term.label, ...(field ? { field } : {}) });
      }
      const firstBody = hasTerms ? terms.find(term => term.body !== null)?.body : undefined;
      results.push({ sourceId: source.id, versionId: version.id, reasons, snippet: snippet(current.body, firstBody || 0),
        rank: [Number(groupLabels.length > 0), Math.min(groupLabels.length, 5), Number(topicLabels.length > 0),
          Math.min(topicLabels.length, 5), hasTerms ? Math.min(terms.length, 6) : 0,
          hasTerms ? Math.min(terms.filter(term => term.title !== null).length, 6) : 0] });
    }
    results.sort((a, b) => {
      for (let index = 0; index < a.rank.length; index++) if (a.rank[index] !== b.rank[index]) return b.rank[index] - a.rank[index];
      return compare(a.sourceId, b.sourceId) || compare(a.versionId, b.versionId);
    });
    return results.slice(0, limit).map(({ rank: _rank, ...result }) => result);
  }
  return Object.freeze({ LIMITS, related });
});

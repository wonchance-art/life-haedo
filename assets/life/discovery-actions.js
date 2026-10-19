/* Explicit local reactions and dedicated portable copies. No fetch or source writes. */
(function (root, factory) {
  'use strict';
  const api = factory(() => root.HaedoLife?.Discovery || (typeof require === 'function' && require('./discovery.js')));
  (root.HaedoLife ||= {}).DiscoveryActions = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (discovery) {
  'use strict';
  const MAX_ENTRIES = 500, MAX_BYTES = 1024 * 1024, FORMAT = 'haedo-discovery-actions';
  const plain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const copy = value => structuredClone(value);
  function check(value, code = 'discovery_actions_invalid') {
    if (!value) throw Object.assign(new Error(code === 'discovery_actions_conflict' ? '다른 화면에서 좋아요·담기가 바뀌었습니다. 최신 내용을 확인해 주세요.' : code === 'discovery_actions_too_large' ? '좋아요·담기 보관 한도를 넘었습니다. 기존 선택은 유지했습니다.' : '좋아요·담기 자료의 형식과 출처를 확인해 주세요.'), { code });
  }
  function fields(value, allowed) { check(plain(value) && Object.keys(value).length === allowed.length && allowed.every(key => Object.hasOwn(value, key))); }
  function text(value, max, empty = false) {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return false;
    for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) { const d = value.charCodeAt(++i); if (!(d >= 0xdc00 && d <= 0xdfff)) return false; } else if (c >= 0xdc00 && c <= 0xdfff) return false; }
    return true;
  }
  const stamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
  const nullableStamp = value => value === null || stamp(value);
  function api() { const value = discovery(); check(typeof value?.canonicalUrl === 'function' && plain(value.ALLOWED_SOURCES), 'dependency_unavailable'); return value; }
  function key(value) { const result = api().canonicalUrl(value); check(result); return result; }
  function bounded(value) { check(new TextEncoder().encode(JSON.stringify(value)).length < MAX_BYTES, 'discovery_actions_too_large'); }
  function snapshot(value) {
    fields(value, ['id', 'sourceId', 'sourceName', 'url', 'canonicalUrl', 'title', 'author', 'language', 'tags', 'publishedAt', 'updatedAt', 'fetchedAt', 'coverage', 'rights']);
    check(id(value.id) && id(value.sourceId) && text(value.sourceName, 200) && text(value.title, 500) && (value.author === null || text(value.author, 200)) && text(value.language, 30));
    check(key(value.url) === value.canonicalUrl && key(value.canonicalUrl) === value.canonicalUrl);
    const hosts = api().ALLOWED_SOURCES[value.sourceId]; check(Array.isArray(hosts) && hosts.includes(new URL(value.canonicalUrl).hostname));
    check(Array.isArray(value.tags) && value.tags.length <= 50 && Array.from(value.tags).every(tag => text(tag, 200)) && new Set(value.tags).size === value.tags.length);
    check(nullableStamp(value.publishedAt) && nullableStamp(value.updatedAt) && stamp(value.fetchedAt) && value.coverage === 'link_only');
    fields(value.rights, ['label', 'url', 'mode']); check(text(value.rights.label, 500) && (value.rights.url === null || key(value.rights.url)) && value.rights.mode === 'metadata_only');
    return true;
  }
  function capture(article, source) {
    check(plain(article) && plain(source) && article.sourceId === source.id);
    check(text(source.name || source.sourceName, 200));
    check(plain(article.rights) && ['metadata_only', 'summary_allowed', 'full_text_allowed'].includes(article.rights.mode));
    check(['link_only', 'summary', 'full_text'].includes(article.coverage));
    check(article.coverage !== 'summary' || article.rights.mode !== 'metadata_only');
    check(article.coverage !== 'full_text' || article.rights.mode === 'full_text_allowed');
    const result = { id: article.id, sourceId: article.sourceId, sourceName: source.name || source.sourceName,
      url: article.url, canonicalUrl: key(article.url), title: article.title, author: article.author ?? null, language: article.language,
      tags: copy(article.tags || []), publishedAt: article.publishedAt ?? null, updatedAt: article.updatedAt ?? null,
      fetchedAt: article.fetchedAt, coverage: 'link_only', rights: { label: article.rights?.label, url: article.rights?.url ?? null, mode: 'metadata_only' } };
    if (article.canonicalUrl !== undefined) check(article.canonicalUrl === result.canonicalUrl);
    snapshot(result); return result;
  }
  function entry(value) {
    fields(value, ['canonicalUrl', 'snapshot', 'liked', 'bookmarked', 'excludedFromRecommendations', 'likedAt', 'bookmarkedAt', 'updatedAt']);
    snapshot(value.snapshot); check(value.canonicalUrl === value.snapshot.canonicalUrl && typeof value.liked === 'boolean' && typeof value.bookmarked === 'boolean' && typeof value.excludedFromRecommendations === 'boolean' && stamp(value.updatedAt));
    for (const kind of ['liked', 'bookmarked']) check(value[kind] ? stamp(value[kind + 'At']) && Date.parse(value[kind + 'At']) <= Date.parse(value.updatedAt) : value[kind + 'At'] === null);
  }
  function entries(values, activeOnly = false) {
    check(Array.isArray(values)); check(values.length <= MAX_ENTRIES, 'discovery_actions_too_large'); const seen = new Set();
    for (const value of values) { entry(value); check(!seen.has(value.canonicalUrl) && (!activeOnly || value.liked || value.bookmarked)); seen.add(value.canonicalUrl); }
  }
  function validate(profile) {
    fields(profile, ['schemaVersion', 'workspaceId', 'revision', 'deleted', 'updatedAt', 'personalizationEnabled', 'entries']);
    check(profile.schemaVersion === 1 && id(profile.workspaceId) && Number.isSafeInteger(profile.revision) && profile.revision >= 0 && typeof profile.deleted === 'boolean' && typeof profile.personalizationEnabled === 'boolean');
    check(profile.revision === 0 ? !profile.deleted && profile.updatedAt === null : stamp(profile.updatedAt));
    entries(profile.entries);
    if (profile.deleted || profile.revision === 0) check(!profile.personalizationEnabled && profile.entries.length === 0);
    for (const row of profile.entries) check(Date.parse(row.updatedAt) <= Date.parse(profile.updatedAt));
    bounded(profile); return true;
  }
  function empty(workspaceId) { const value = { schemaVersion: 1, workspaceId, revision: 0, deleted: false, updatedAt: null, personalizationEnabled: false, entries: [] }; validate(value); return value; }
  function clock(options) { const value = typeof options.now === 'function' ? options.now() : options.now === undefined ? new Date().toISOString() : options.now; check(stamp(value)); return value; }
  function next(profile, options) {
    validate(profile); check(plain(options) && Object.keys(options).every(name => ['expectedRevision', 'now'].includes(name)));
    check(Number.isSafeInteger(options.expectedRevision) && options.expectedRevision === profile.revision && profile.revision < Number.MAX_SAFE_INTEGER, 'discovery_actions_conflict');
    const updatedAt = clock(options); check(profile.updatedAt === null || Date.parse(updatedAt) >= Date.parse(profile.updatedAt));
    return { ...copy(profile), revision: profile.revision + 1, deleted: false, updatedAt };
  }
  function finish(value) { validate(value); return value; }
  function setReaction(profile, captured, kind, target, options = {}) {
    check(['liked', 'bookmarked'].includes(kind) && typeof target === 'boolean'); snapshot(captured);
    const result = next(profile, options); let row = result.entries.find(value => value.canonicalUrl === captured.canonicalUrl);
    if (!row) { row = { canonicalUrl: captured.canonicalUrl, snapshot: copy(captured), liked: false, bookmarked: false, excludedFromRecommendations: false, likedAt: null, bookmarkedAt: null, updatedAt: result.updatedAt }; result.entries.push(row); }
    // Only a new explicit like may replace its evidence. A bookmark while
    // already liked must not rewrite the public metadata that earned the like.
    if (kind === 'liked' && target && !row.liked) row.snapshot = copy(captured);
    if (row[kind] !== target) row[kind + 'At'] = target ? result.updatedAt : null;
    row[kind] = target; row.updatedAt = result.updatedAt;
    return finish(result);
  }
  function setPersonalization(profile, target, options = {}) { check(typeof target === 'boolean'); const result = next(profile, options); result.personalizationEnabled = target; return finish(result); }
  function setExcluded(profile, url, target, options = {}) {
    check(typeof target === 'boolean'); const canonical = key(url), result = next(profile, options), row = result.entries.find(value => value.canonicalUrl === canonical); check(row);
    row.excludedFromRecommendations = target; row.updatedAt = result.updatedAt; return finish(result);
  }
  function forget(profile, url, options = {}) { const canonical = key(url), result = next(profile, options); result.entries = result.entries.filter(value => value.canonicalUrl !== canonical); return finish(result); }
  function clear(profile, options = {}) { return finish({ ...next(profile, options), deleted: true, personalizationEnabled: false, entries: [] }); }
  function exportCopy(profile, options = {}) {
    validate(profile); check(plain(options) && Object.keys(options).every(name => name === 'now'));
    const result = { format: FORMAT, schemaVersion: 1, exportedAt: clock(options), entries: copy(profile.entries.filter(row => row.liked || row.bookmarked)) };
    previewCopy(result); return result;
  }
  function previewCopy(value) {
    fields(value, ['format', 'schemaVersion', 'exportedAt', 'entries']); check(value.format === FORMAT && value.schemaVersion === 1 && stamp(value.exportedAt)); entries(value.entries, true); bounded(value);
    for (const row of value.entries) check(Date.parse(row.updatedAt) <= Date.parse(value.exportedAt));
    return { ...copy(value), counts: { total: value.entries.length, liked: value.entries.filter(row => row.liked).length, bookmarked: value.entries.filter(row => row.bookmarked).length } };
  }
  function mergeCopy(profile, envelope, options = {}) {
    const incoming = previewCopy(envelope), result = next(profile, options), seen = new Set(result.entries.map(row => row.canonicalUrl));
    for (const row of incoming.entries) if (!seen.has(row.canonicalUrl)) {
      check(Date.parse(row.updatedAt) <= Date.parse(result.updatedAt));
      result.entries.push({ ...row, excludedFromRecommendations: true }); seen.add(row.canonicalUrl);
    }
    result.personalizationEnabled = false; return finish(result);
  }
  return Object.freeze({ MAX_ENTRIES, MAX_BYTES, FORMAT, empty, validate, capture, setReaction, setPersonalization, setExcluded, forget, clear, exportCopy, previewCopy, mergeCopy });
});

/* Explicit private discovery feedback. Reading/opening an article never calls
 * these mutations. Storage owns account/workspace CAS; source data is separate. */
(function (root, factory) {
  'use strict';
  const api = factory(() => root.HaedoLife?.Discovery || (typeof require === 'function' && require('./discovery.js')));
  (root.HaedoLife ||= {}).DiscoveryProfile = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (discovery) {
  'use strict';
  const MAX_BYTES = 128 * 1024, MAX_FEEDBACK = 500;
  const KINDS = Object.freeze(['not_relevant', 'already_read']);
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  const copy = value => JSON.parse(JSON.stringify(value));
  function check(condition, code = 'discovery_profile_invalid') {
    if (!condition) throw Object.assign(new Error(code === 'discovery_profile_conflict' ? '다른 화면에서 발견 피드백이 바뀌었습니다. 최신 상태를 확인해 주세요.' : code === 'discovery_profile_too_large' ? '발견 피드백이 보관 한도를 넘었습니다. 기존 피드백은 유지했습니다.' : '발견 피드백과 글 주소를 확인해 주세요.'), { code });
  }
  function fields(value, allowed) { check(plain(value) && Object.keys(value).every(key => allowed.includes(key))); }
  function canonicalURL(value) {
    const api = discovery(); check(typeof api?.canonicalUrl === 'function', 'discovery_dependency_unavailable');
    const canonical = api.canonicalUrl(value); check(typeof canonical === 'string' && canonical.length > 0 && canonical.length <= 8192);
    return canonical;
  }
  // URLs are the identity; a provider's article ID may change on a later feed.
  function articleKey(value) {
    if (typeof value === 'string') return canonicalURL(value);
    check(plain(value));
    const key = canonicalURL(value.canonicalUrl || value.url);
    if (value.canonicalUrl && value.url) check(key === canonicalURL(value.url));
    return key;
  }
  function validate(profile) {
    fields(profile, ['schemaVersion', 'workspaceId', 'revision', 'deleted', 'feedback', 'updatedAt']);
    check(profile.schemaVersion === 1 && id(profile.workspaceId) && Number.isSafeInteger(profile.revision) && profile.revision >= 0 && typeof profile.deleted === 'boolean');
    check(profile.updatedAt === null && profile.revision === 0 || timestamp(profile.updatedAt));
    check(Array.isArray(profile.feedback) && profile.feedback.length <= MAX_FEEDBACK);
    const seen = new Set();
    for (const row of profile.feedback) {
      fields(row, ['articleId', 'canonicalUrl', 'kind', 'updatedAt']);
      check(id(row.articleId) && KINDS.includes(row.kind) && timestamp(row.updatedAt));
      check(typeof row.canonicalUrl === 'string' && row.canonicalUrl === canonicalURL(row.canonicalUrl) && !seen.has(row.canonicalUrl));
      seen.add(row.canonicalUrl);
    }
    if (profile.deleted || profile.revision === 0) check(profile.feedback.length === 0);
    check(new TextEncoder().encode(JSON.stringify(profile)).length < MAX_BYTES, 'discovery_profile_too_large');
    return true;
  }
  function empty(workspaceId) {
    const result = { schemaVersion: 1, workspaceId, revision: 0, deleted: false, feedback: [], updatedAt: null };
    validate(result); return result;
  }
  function nextRevision(current, expectedRevision) {
    validate(current);
    check(Number.isSafeInteger(expectedRevision) && expectedRevision === current.revision, 'discovery_profile_conflict');
    check(current.revision < Number.MAX_SAFE_INTEGER, 'discovery_profile_conflict');
    return current.revision + 1;
  }
  function change(current, settings) {
    check(plain(settings));
    const revision = nextRevision(current, settings.expectedRevision);
    const updatedAt = typeof settings.now === 'function' ? settings.now() : settings.now || new Date().toISOString();
    check(timestamp(updatedAt));
    return { ...copy(current), revision, deleted: false, updatedAt };
  }
  function setFeedback(current, article, kind, settings = {}) {
    const result = change(current, settings), canonicalUrl = articleKey(article);
    check(plain(article) && id(article.id || article.articleId) && KINDS.includes(kind));
    const row = { articleId: article.id || article.articleId, canonicalUrl, kind, updatedAt: result.updatedAt };
    const index = result.feedback.findIndex(item => item.canonicalUrl === canonicalUrl);
    if (index < 0) result.feedback.push(row); else result.feedback[index] = row;
    validate(result); return result;
  }
  function undo(current, articleOrURL, settings = {}) {
    const result = change(current, settings), key = articleKey(articleOrURL);
    result.feedback = result.feedback.filter(row => row.canonicalUrl !== key);
    validate(result); return result;
  }
  function clear(current, settings = {}) {
    const result = { ...change(current, settings), deleted: true, feedback: [] };
    validate(result); return result;
  }
  return Object.freeze({ MAX_BYTES, MAX_FEEDBACK, KINDS, empty, validate, canonicalURL, articleKey, nextRevision, setFeedback, undo, clear });
});

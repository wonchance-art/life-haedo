/* Private, explicit discovery controls. No fetch, timer or source mutation. */
(function (root, factory) {
  'use strict';
  const api = factory();
  (root.HaedoLife ||= {}).DiscoverySettings = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function () {
  'use strict';
  const MAX_BYTES = 32 * 1024, MAX_INTERESTS = 40, MAX_SOURCES = 100;
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const copy = value => structuredClone(value);
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
  function check(condition, code = 'discovery_settings_invalid') {
    if (!condition) throw Object.assign(new Error(code === 'discovery_settings_conflict' ? '다른 화면에서 새 글 찾기 설정이 바뀌었습니다. 최신 상태를 확인해 주세요.' : code === 'discovery_settings_too_large' ? '새 글 찾기 설정이 보관 한도를 넘었습니다. 기존 설정은 유지했습니다.' : '새 글 찾기 설정을 확인해 주세요.'), { code });
  }
  function fields(value, allowed) { check(plain(value) && Object.keys(value).every(key => allowed.includes(key))); }
  function ids(value, max) { check(Array.isArray(value) && value.length <= max && Array.from(value).every(id) && new Set(value).size === value.length); }
  function validate(settings) {
    fields(settings, ['schemaVersion', 'workspaceId', 'revision', 'deleted', 'updatedAt', 'autoRefresh', 'disabledInterestIds', 'disabledSourceIds']);
    check(settings.schemaVersion === 1 && id(settings.workspaceId) && Number.isSafeInteger(settings.revision) && settings.revision >= 0 && typeof settings.deleted === 'boolean' && typeof settings.autoRefresh === 'boolean');
    check(settings.revision === 0 ? settings.updatedAt === null && !settings.deleted : timestamp(settings.updatedAt));
    ids(settings.disabledInterestIds, MAX_INTERESTS); ids(settings.disabledSourceIds, MAX_SOURCES);
    if (settings.deleted || settings.revision === 0) check(!settings.autoRefresh && settings.disabledInterestIds.length === 0 && settings.disabledSourceIds.length === 0);
    check(new TextEncoder().encode(JSON.stringify(settings)).length < MAX_BYTES, 'discovery_settings_too_large');
    return true;
  }
  function empty(workspaceId) {
    const result = { schemaVersion: 1, workspaceId, revision: 0, deleted: false, updatedAt: null, autoRefresh: false, disabledInterestIds: [], disabledSourceIds: [] };
    validate(result); return result;
  }
  function next(current, options) {
    validate(current); fields(options, ['expectedRevision', 'now']);
    check(Number.isSafeInteger(options.expectedRevision) && options.expectedRevision === current.revision && current.revision < Number.MAX_SAFE_INTEGER, 'discovery_settings_conflict');
    const updatedAt = typeof options.now === 'function' ? options.now() : options.now === undefined ? new Date().toISOString() : options.now;
    check(timestamp(updatedAt));
    return { ...copy(current), revision: current.revision + 1, deleted: false, updatedAt };
  }
  function update(current, patch, options = {}) {
    fields(patch, ['autoRefresh', 'disabledInterestIds', 'disabledSourceIds']);
    const result = next(current, options);
    for (const key of Object.keys(patch)) result[key] = copy(patch[key]);
    validate(result); return result;
  }
  function clear(current, options = {}) {
    const result = { ...next(current, options), deleted: true, autoRefresh: false, disabledInterestIds: [], disabledSourceIds: [] };
    validate(result); return result;
  }
  // These helpers only project explicit selections. Unknown disabled IDs are retained
  // by the model, so a temporarily absent source/topic does not become enabled later.
  function effectiveProfile(profile, settings) {
    validate(settings);
    check(plain(profile) && profile.workspaceId === settings.workspaceId && Array.isArray(profile.manual));
    const result = copy(profile), disabled = new Set(settings.disabledInterestIds);
    result.manual = result.manual.filter(item => !disabled.has(item.id));
    return result;
  }
  function filterFeed(feed, settings) {
    validate(settings); check(plain(feed) && Array.isArray(feed.sources) && Array.isArray(feed.articles));
    const result = copy(feed), disabled = new Set(settings.disabledSourceIds);
    result.sources = result.sources.filter(source => !disabled.has(source.id));
    result.articles = result.articles.filter(article => !disabled.has(article.sourceId));
    return result;
  }
  return Object.freeze({ MAX_BYTES, MAX_INTERESTS, MAX_SOURCES, empty, validate, update, clear, effectiveProfile, filterFeed });
});

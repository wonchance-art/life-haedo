/* Private, explicit discovery controls. No fetch, timer or source mutation. */
(function (root, factory) {
  'use strict';
  const api = factory();
  (root.HaedoLife ||= {}).DiscoverySettings = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function () {
  'use strict';
  const MAX_BYTES = 32 * 1024, MAX_INTERESTS = 40, MAX_SOURCES = 100;
  // 기사 이미지 보기: the list asks each publisher's server for article images only when this is on.
  // The one place that sets what an account sees before it has chosen (2026-11-11: off).
  const DEFAULT_SHOW_IMAGES = false;
  // 넓게 찾기: the interest topics typed in news settings go to the external news search only when this is on.
  // Off until chosen (owner approval 2026-11-11 covers "only when turned on in settings").
  const DEFAULT_WIDE_SEARCH = false;
  // Options added after the first settings format are stored as reserved entries of disabledSourceIds, not as new
  // fields. The validator shipped before them refuses unknown fields but accepts unknown ids in that list and keeps
  // them when it saves its own change, so a device still on the older shell reads these settings and cannot drop an
  // option. No source id may start with `option-` (asserted against the source registry by the tests).
  const OPTIONS = Object.freeze({
    showImages: Object.freeze({ on: 'option-images-on', off: 'option-images-off', initial: DEFAULT_SHOW_IMAGES }),
    wideSearch: Object.freeze({ on: 'option-wide-on', off: 'option-wide-off', initial: DEFAULT_WIDE_SEARCH }),
    // Set when 넓게 찾기 is turned off and taken away once the server copy of its results is confirmed erased,
    // so any device of the account can finish an erase that failed.
    wideClear: Object.freeze({ on: 'option-wide-clear', off: null, initial: false })
  });
  const OPTION_IDS = Object.freeze(Object.values(OPTIONS).flatMap(option => [option.on, option.off]).filter(Boolean));
  // 넓게 찾기 topics the server refused although the screen's copy of its rule took them (a safety net: the two
  // rules are the same, a browser's Unicode tables may not be). One reserved entry per topic, holding a 16-hex-digit
  // key of the topic (DiscoveryWideRemote.refusalKey), never its text, so a new opening does not ask again.
  const WIDE_REFUSED_PREFIX = 'option-wide-refused-', WIDE_REFUSED_MAX = 8;
  const wideRefusedEntry = value => typeof value === 'string' && value.startsWith(WIDE_REFUSED_PREFIX);
  const isOption = value => typeof value === 'string' && value.startsWith('option-');
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
    // An option is never both on and off. A reserved entry this version does not know is kept as it is
    // (a later version's option), exactly as the first format kept unknown ids.
    for (const option of Object.values(OPTIONS)) check(!(option.off && settings.disabledSourceIds.includes(option.on) && settings.disabledSourceIds.includes(option.off)));
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
    fields(patch, ['autoRefresh', 'disabledInterestIds', 'disabledSourceIds', 'wideRefused', ...Object.keys(OPTIONS)]);
    const result = next(current, options);
    for (const key of ['autoRefresh', 'disabledInterestIds']) if (Object.hasOwn(patch, key)) result[key] = copy(patch[key]);
    // A new source selection never carries options in or out: the stored options stay unless this patch names them.
    let sources = result.disabledSourceIds;
    if (Object.hasOwn(patch, 'disabledSourceIds')) {
      check(Array.isArray(patch.disabledSourceIds));
      sources = [...Array.from(patch.disabledSourceIds).filter(value => !isOption(value)), ...current.disabledSourceIds.filter(isOption)];
    }
    for (const [name, option] of Object.entries(OPTIONS)) if (Object.hasOwn(patch, name)) {
      check(typeof patch[name] === 'boolean');
      sources = [...sources.filter(value => value !== option.on && value !== option.off), ...(patch[name] ? [option.on] : option.off ? [option.off] : [])];
    }
    if (Object.hasOwn(patch, 'wideRefused')) {
      check(Array.isArray(patch.wideRefused) && patch.wideRefused.length <= WIDE_REFUSED_MAX && patch.wideRefused.every(key => typeof key === 'string' && /^[0-9a-f]{16}$/.test(key)) && new Set(patch.wideRefused).size === patch.wideRefused.length);
      sources = [...sources.filter(value => !wideRefusedEntry(value)), ...patch.wideRefused.map(key => WIDE_REFUSED_PREFIX + key)];
    }
    result.disabledSourceIds = sources;
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
  function option(settings, name) {
    const stored = Array.isArray(settings?.disabledSourceIds) ? settings.disabledSourceIds : [];
    return stored.includes(OPTIONS[name].on) ? true : stored.includes(OPTIONS[name].off) ? false : OPTIONS[name].initial;
  }
  const showImages = settings => option(settings, 'showImages');
  const wideSearch = settings => option(settings, 'wideSearch');
  const wideClear = settings => option(settings, 'wideClear');
  // The refusal keys kept for 넓게 찾기 (see WIDE_REFUSED_PREFIX).
  const wideRefused = settings => (Array.isArray(settings?.disabledSourceIds) ? settings.disabledSourceIds : []).filter(wideRefusedEntry).map(value => value.slice(WIDE_REFUSED_PREFIX.length)).filter(key => /^[0-9a-f]{16}$/.test(key));
  // The sources actually turned off, without the reserved option entries.
  const disabledSources = settings => (Array.isArray(settings?.disabledSourceIds) ? settings.disabledSourceIds : []).filter(value => !isOption(value));
  return Object.freeze({ MAX_BYTES, MAX_INTERESTS, MAX_SOURCES, DEFAULT_SHOW_IMAGES, DEFAULT_WIDE_SEARCH, OPTION_IDS, WIDE_REFUSED_MAX, showImages, wideSearch, wideClear, wideRefused, disabledSources,
    empty, validate, update, clear, effectiveProfile, filterFeed });
});

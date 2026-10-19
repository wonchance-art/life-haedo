/* Private discovery language choices. Translation links are explicit, public-URL
 * navigation only; this module does not translate, fetch or change source data. */
(function (root, factory) {
  'use strict';
  const api = factory(() => root.HaedoLife?.Discovery || (typeof require === 'function' && require('./discovery.js')));
  (root.HaedoLife ||= {}).DiscoveryLanguageSettings = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (discovery) {
  'use strict';
  const MAX_BYTES = 16 * 1024;
  const CONTENT_LANGUAGE_LABELS = Object.freeze({ ko: '한국어', en: '영어', ja: '일본어', zh: '중국어', es: '스페인어', fr: '프랑스어', de: '독일어', und: '언어 미확인', mul: '여러 언어', other: '기타 언어' });
  const TRANSLATION_TARGET_LABELS = Object.freeze({ original: '원문 보기(번역 끄기)', ko: '한국어', en: '영어', ja: '일본어', 'zh-CN': '중국어(간체)', 'zh-TW': '중국어(번체)', es: '스페인어', fr: '프랑스어', de: '독일어' });
  const CONTENT_LANGUAGE_CODES = Object.freeze(Object.keys(CONTENT_LANGUAGE_LABELS));
  const TRANSLATION_TARGET_CODES = Object.freeze(Object.keys(TRANSLATION_TARGET_LABELS));
  const plain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const copy = value => structuredClone(value);
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
  function check(condition, code = 'discovery_language_settings_invalid') {
    if (!condition) throw Object.assign(new Error(code === 'discovery_language_settings_conflict' ? '다른 화면에서 언어 옵션이 바뀌었습니다. 최신 상태를 확인해 주세요.' : code === 'discovery_language_settings_too_large' ? '언어 옵션이 보관 한도를 넘었습니다. 기존 설정은 유지했습니다.' : '원문·번역 언어 옵션을 확인해 주세요.'), { code });
  }
  function allowedFields(value, keys) { check(plain(value) && Object.keys(value).every(key => keys.includes(key))); }
  function validate(settings) {
    const keys = ['schemaVersion', 'workspaceId', 'revision', 'deleted', 'updatedAt', 'contentLanguages', 'translationTarget'];
    allowedFields(settings, keys); check(Object.keys(settings).length === keys.length && keys.every(key => Object.hasOwn(settings, key)));
    check(settings.schemaVersion === 1 && id(settings.workspaceId) && Number.isSafeInteger(settings.revision) && settings.revision >= 0 && typeof settings.deleted === 'boolean');
    check(settings.revision === 0 ? settings.updatedAt === null && !settings.deleted : timestamp(settings.updatedAt));
    const languages = settings.contentLanguages;
    check(languages === null || Array.isArray(languages) && languages.length <= CONTENT_LANGUAGE_CODES.length && Array.from(languages).every(code => CONTENT_LANGUAGE_CODES.includes(code)) && new Set(languages).size === languages.length);
    check(TRANSLATION_TARGET_CODES.includes(settings.translationTarget));
    if (settings.deleted || settings.revision === 0) check(languages === null && settings.translationTarget === 'original');
    check(new TextEncoder().encode(JSON.stringify(settings)).length < MAX_BYTES, 'discovery_language_settings_too_large');
    return true;
  }
  function empty(workspaceId) {
    const result = { schemaVersion: 1, workspaceId, revision: 0, deleted: false, updatedAt: null, contentLanguages: null, translationTarget: 'original' };
    validate(result); return result;
  }
  function next(current, options) {
    validate(current); allowedFields(options, ['expectedRevision', 'now']);
    check(Number.isSafeInteger(options.expectedRevision) && options.expectedRevision === current.revision && current.revision < Number.MAX_SAFE_INTEGER, 'discovery_language_settings_conflict');
    const updatedAt = typeof options.now === 'function' ? options.now() : options.now === undefined ? new Date().toISOString() : options.now;
    check(timestamp(updatedAt));
    return { ...copy(current), revision: current.revision + 1, deleted: false, updatedAt };
  }
  function update(current, patch, options = {}) {
    allowedFields(patch, ['contentLanguages', 'translationTarget']);
    const result = next(current, options);
    for (const key of Object.keys(patch)) result[key] = copy(patch[key]);
    validate(result); return result;
  }
  function clear(current, options = {}) {
    const result = { ...next(current, options), deleted: true, contentLanguages: null, translationTarget: 'original' };
    validate(result); return result;
  }
  function buildTranslationURL(article, target) {
    if (target === 'original' || !TRANSLATION_TARGET_CODES.includes(target) || !plain(article) || !id(article.sourceId)) return null;
    const api = discovery();
    if (typeof api?.canonicalUrl !== 'function' || !Object.hasOwn(api.ALLOWED_SOURCES || {}, article.sourceId)) return null;
    const canonical = api.canonicalUrl(article.url);
    if (!canonical || article.canonicalUrl !== undefined && article.canonicalUrl !== canonical) return null;
    try {
      if (!api.ALLOWED_SOURCES[article.sourceId].includes(new URL(canonical).hostname)) return null;
      const destination = new URL('https://translate.google.com/translate');
      destination.search = new URLSearchParams({ sl: 'auto', tl: target, u: canonical }).toString();
      return destination.href;
    } catch (_) { return null; }
  }
  return Object.freeze({ MAX_BYTES, CONTENT_LANGUAGE_CODES, CONTENT_LANGUAGE_LABELS, TRANSLATION_TARGET_CODES, TRANSLATION_TARGET_LABELS, empty, validate, update, clear, buildTranslationURL });
});

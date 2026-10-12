/* Private collection metadata. No source text, network, synchronization or publishing. */
(function (root, factory) {
  'use strict';
  const api = factory();
  root.HaedoLife ||= {}; root.HaedoLife.Collection = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function () {
  'use strict';
  const TYPES = Object.freeze({ music: '음악', book: '책', film: '영화', video: '영상', article: '글', artwork: '예술 작품', tool: '도구', person: '인물', place: '장소', other: '기타' });
  const GROUPS = Object.freeze([
    { id: 'content', label: '콘텐츠·작품', types: ['music', 'book', 'film', 'video', 'article', 'artwork'] },
    { id: 'tools', label: '도구·서비스', types: ['tool'] }, { id: 'people', label: '인물', types: ['person'] },
    { id: 'places', label: '장소', types: ['place'] }, { id: 'other', label: '기타', types: ['other'] }
  ].map(value => Object.freeze({ ...value, types: Object.freeze(value.types) })));
  const DETAILS = Object.freeze({ year: '연도', medium: '재료·매체', holding: '소장처', country: '국가', duration: '상영시간', field: '활동 분야', rights: '이미지 권리 메모' });
  const TYPE_FIELDS = Object.freeze({ music: ['year'], book: ['year'], film: ['year', 'country', 'duration'], video: ['year'], article: ['year'],
    artwork: ['year', 'medium', 'holding', 'rights'], tool: [], person: ['field'], place: [], other: [] });
  Object.values(TYPE_FIELDS).forEach(Object.freeze);
  const LIMITS = Object.freeze({ items: 1000, bytes: 2 * 1024 * 1024, title: 500, note: 10000, url: 2048, tags: 12, tag: 60 });
  const clone = value => JSON.parse(JSON.stringify(value));
  const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  function fail(message, code = 'invalid_collection') { throw Object.assign(new Error(message), { code }); }
  function fields(value, keys) {
    if (!plain(value) || Reflect.ownKeys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) fail('컬렉션 항목의 형식을 확인해 주세요. 기존 자료는 보존했습니다.');
  }
  function text(value, max, required = false) {
    if (typeof value !== 'string' || value.length > max || required && !value.trim() || /[\u0000]/u.test(value) || !wellFormed(value)) fail('입력의 길이와 문자 형식을 확인해 주세요.');
  }
  function wellFormed(value) {
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
      else if (c >= 0xdc00 && c <= 0xdfff) return false;
    }
    return true;
  }
  function id(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail('컬렉션 식별자를 확인해 주세요.'); }
  function date(value) { if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('컬렉션 날짜를 확인해 주세요.'); }
  function url(value) {
    text(value, LIMITS.url);
    if (!value) return;
    try { const u = new URL(value); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || /[\s\\]/u.test(value)) throw new Error(); }
    catch (_) { fail('출처는 아이디·비밀번호가 없는 http 또는 https 주소로 입력해 주세요.', 'invalid_collection_url'); }
  }
  function validateItem(value) {
    fields(value, ['id', 'type', 'title', 'creator', 'url', 'note', 'tags', 'details', 'archived', 'createdAt', 'updatedAt']);
    id(value.id); if (!Object.hasOwn(TYPES, value.type)) fail('지원하는 자료 종류를 선택해 주세요.');
    text(value.title, LIMITS.title, true); text(value.creator, LIMITS.title); text(value.note, LIMITS.note); url(value.url);
    if (value.type === 'person' && value.creator !== '') fail('인물의 활동 분야는 만든 사람과 구분해 주세요.');
    if (!Array.isArray(value.tags) || value.tags.length > LIMITS.tags || new Set(value.tags).size !== value.tags.length) fail('주제는 중복 없이 12개까지 입력해 주세요.');
    value.tags.forEach(tag => { text(tag, LIMITS.tag, true); if (tag !== tag.trim()) fail('주제 앞뒤의 공백을 지워 주세요.'); });
    if (!plain(value.details) || Reflect.ownKeys(value.details).some(key => !TYPE_FIELDS[value.type].includes(key))) fail('자료 종류에 맞는 상세 정보인지 확인해 주세요.');
    Object.values(value.details).forEach(v => text(v, 500));
    if (typeof value.archived !== 'boolean') fail('보관 상태를 확인해 주세요.');
    date(value.createdAt); date(value.updatedAt);
    if (value.updatedAt < value.createdAt) fail('수정 시각이 등록 시각보다 빠릅니다.');
    return value;
  }
  function size(value) { if (new TextEncoder().encode(JSON.stringify(value)).length > LIMITS.bytes) fail('컬렉션은 2 MiB까지 보관할 수 있습니다. 기존 자료를 백업한 뒤 확인해 주세요.', 'collection_limit'); }
  function items(value) {
    if (!Array.isArray(value) || value.length > LIMITS.items) fail('컬렉션은 1,000개까지 보관할 수 있습니다.', 'collection_limit');
    const seen = new Set();
    for (const item of value) { validateItem(item); if (seen.has(item.id)) fail('같은 식별자가 중복된 파일입니다.'); seen.add(item.id); }
  }
  function empty(workspaceId) { id(workspaceId); return { format: 'life-collection-v1', workspaceId, revision: 0, items: [] }; }
  function validate(value) {
    fields(value, ['format', 'workspaceId', 'revision', 'items']);
    if (value.format !== 'life-collection-v1') fail('지원하지 않는 컬렉션 형식입니다.');
    id(value.workspaceId);
    if (!Number.isSafeInteger(value.revision) || value.revision < 0) fail('컬렉션 저장 기준을 확인해 주세요.');
    items(value.items); size(value); return value;
  }
  function makeBackup(value) { validate(value); const backup = { format: 'life-collection-backup-v1', exportedAt: new Date().toISOString(), items: clone(value.items) }; size(backup); return backup; }
  function readBackup(input) {
    if (typeof input === 'string') { if (new TextEncoder().encode(input).length > LIMITS.bytes) fail('백업 파일이 2 MiB를 넘습니다.', 'collection_limit'); try { input = JSON.parse(input); } catch (_) { fail('JSON 백업 파일을 읽지 못했습니다.'); } }
    fields(input, ['format', 'exportedAt', 'items']);
    if (input.format !== 'life-collection-backup-v1') fail('컬렉션 전용 백업 파일을 선택해 주세요.');
    date(input.exportedAt); items(input.items); size(input); return clone(input);
  }
  function appendBackup(state, backup, makeId) {
    validate(state); backup = readBackup(backup);
    const next = clone(state);
    for (const item of backup.items) next.items.push({ ...item, id: makeId() });
    validate(next); return next;
  }
  function groupFor(type) { return GROUPS.find(group => group.types.includes(type)); }
  function matches(item, { category = 'all', type = 'all', query = '', archived = false, tag = '' } = {}) {
    const q = query.trim().toLocaleLowerCase('ko');
    return item.archived === archived && (category === 'all' || groupFor(item.type)?.id === category) && (type === 'all' || item.type === type) && (!tag || item.tags.includes(tag)) &&
      [item.title, item.creator, item.note, item.url, ...item.tags, ...Object.values(item.details)].join('\n').toLocaleLowerCase('ko').includes(q);
  }
  return Object.freeze({ TYPES, GROUPS, DETAILS, TYPE_FIELDS, LIMITS, empty, validate, validateItem, makeBackup, readBackup, appendBackup, matches, groupFor, clone });
});

/* Private ordered collections of exact saved PhotoPost snapshots. No storage or network. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).BlogSeries = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const FORMAT = 'life-blog-series-v1';
  const LIMITS = Object.freeze({ series: 20, items: 20, title: 500, intro: 10000, json: 2 * 1024 * 1024, snapshotJson: 16 * 1024 * 1024, photos: 200, bytes: 256 * 1024 * 1024 });
  const clone = value => structuredClone(value);
  const photoPost = () => root.HaedoLife?.PhotoPost || require('./photo-post.js');
  const fresh = () => root.crypto.randomUUID();
  const fail = message => { throw Object.assign(new Error(message), { code: 'invalid_blog_series' }); };
  const plain = value => value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  function fields(value, keys) {
    if (!plain(value) || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('모음의 형식을 확인해 주세요. 기존 글은 보존했습니다.');
  }
  function id(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail('모음과 글의 식별자를 확인해 주세요.'); }
  function text(value, max) {
    if (typeof value !== 'string' || value.length > max || value.includes('\0')) fail('모음 입력의 길이와 문자 형식을 확인해 주세요.');
    for (let i = 0; i < value.length; i++) {
      const point = value.charCodeAt(i);
      if (point >= 0xd800 && point <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail('모음 문자의 형식을 확인해 주세요.'); }
      else if (point >= 0xdc00 && point <= 0xdfff) fail('모음 문자의 형식을 확인해 주세요.');
    }
  }
  function revision(value, positive = false) { if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) fail('모음과 글의 저장 기준을 확인해 주세요.'); }
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('모음의 날짜를 확인해 주세요.');
  }
  function validateSeries(value) {
    fields(value, ['id', 'title', 'intro', 'createdAt', 'updatedAt', 'items']); id(value.id); text(value.title, LIMITS.title); text(value.intro, LIMITS.intro);
    date(value.createdAt); date(value.updatedAt); if (value.updatedAt < value.createdAt) fail('모음 수정 시각이 등록 시각보다 빠릅니다.');
    if (!Array.isArray(value.items) || value.items.length > LIMITS.items) fail('한 모음에는 글을 20편까지 담을 수 있습니다.');
    const ids = new Set([value.id]), origins = new Set();
    for (const item of value.items) {
      fields(item, ['id', 'postId', 'postRevision', 'title']); id(item.id); id(item.postId); revision(item.postRevision, true); text(item.title, LIMITS.title);
      const origin = JSON.stringify([item.postId, item.postRevision]);
      if (ids.has(item.id) || origins.has(origin)) fail('같은 글이나 목차 항목이 중복된 모음입니다.'); ids.add(item.id); origins.add(origin);
    }
    return value;
  }
  function empty(workspaceId) { id(workspaceId); return { format: FORMAT, workspaceId, revision: 0, series: [] }; }
  function validate(value) {
    fields(value, ['format', 'workspaceId', 'revision', 'series']); if (value.format !== FORMAT) fail('지원하지 않는 모음 형식입니다.');
    id(value.workspaceId); revision(value.revision);
    if (!Array.isArray(value.series) || value.series.length > LIMITS.series) fail('모음은 20개까지 보관할 수 있습니다.');
    const ids = new Set();
    for (const series of value.series) { validateSeries(series); for (const key of [series.id, ...series.items.map(item => item.id)]) { if (ids.has(key)) fail('모음 식별자가 중복됐습니다.'); ids.add(key); } }
    if (new TextEncoder().encode(JSON.stringify(value)).length > LIMITS.json) fail('모음 설명과 목차는 2 MiB까지 보관할 수 있습니다.');
    return value;
  }
  function create(makeId = fresh, now = new Date().toISOString()) {
    const value = { id: makeId(), title: '', intro: '', createdAt: now, updatedAt: now, items: [] }; validateSeries(value); return value;
  }
  function item(doc, makeId = fresh) {
    photoPost().validate(doc);
    if (doc.status !== 'saved' || doc.archived || doc.revision < 1) fail('보관함 밖의 저장한 글만 모음에 담을 수 있습니다.');
    const value = { id: makeId(), postId: doc.id, postRevision: doc.revision, title: doc.title };
    id(value.id); id(value.postId); revision(value.postRevision, true); text(value.title, LIMITS.title); return value;
  }
  function validateSnapshot(value) {
    fields(value, ['series', 'posts']); validateSeries(value.series);
    if (!Array.isArray(value.posts) || value.posts.length !== value.series.items.length) fail('모음의 고정 글 사본이 누락됐습니다. 최신 글로 바꾸지 않았습니다.');
    let bytes = 0, count = 0;
    for (let i = 0; i < value.posts.length; i++) {
      const row = value.posts[i], entry = value.series.items[i]; fields(row, ['itemId', 'doc']);
      const used = photoPost().validate(row.doc);
      if (row.itemId !== entry.id || row.doc.id !== entry.postId || row.doc.revision !== entry.postRevision || row.doc.title !== entry.title || row.doc.status !== 'saved' || row.doc.archived) fail('목차가 가리키는 정확한 저장 글을 확인하지 못했습니다.');
      if (row.doc.photos.some(photo => !used.has(photo.id))) fail('본문에서 사용한 원본 사진만 모음에 보관해 주세요.');
      for (const photo of row.doc.photos) { bytes += photo.size; count++; }
    }
    const metadata = { series: value.series, posts: value.posts.map(row => ({ itemId: row.itemId, doc: { ...row.doc, photos: row.doc.photos.map(({ blob, ...photo }) => photo) } })) };
    const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata)).length;
    if (metadataBytes > LIMITS.snapshotJson || count > LIMITS.photos || bytes + metadataBytes > LIMITS.bytes) fail('모음은 설명·본문 16 MiB, 원본 사진 200장·전체 256 MiB까지 보관할 수 있습니다.');
    return value;
  }
  return Object.freeze({ FORMAT, LIMITS, empty, create, item, validate, validateSeries, validateSnapshot, clone });
});

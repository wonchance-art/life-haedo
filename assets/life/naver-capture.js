/* Immutable acquired Naver text/photo metadata. No network, storage or DOM. */
(function (root, factory) {
  'use strict';
  const api = factory(root); (root.HaedoLife ||= {}).NaverCapture = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const LIMITS = Object.freeze({ photos: 20, file: 64 * 1024 * 1024, bytes: 256 * 1024 * 1024,
    body: 1024 * 1024, payload: 2 * 1024 * 1024, omissions: 100 });
  const PAYLOAD = ['version', 'blogId', 'logNo', 'url', 'title', 'format', 'body', 'bodyHash', 'htmlHash',
    'coverage', 'omissions', 'publishedAt', 'author', 'extractedAt', 'extractor', 'photos'];
  const PHOTO = ['index', 'url', 'storagePath', 'sha256', 'mimeType', 'width', 'height', 'bytes', 'alt', 'caption', 'status', 'error', 'originalStatus'];
  const ROW = ['id', 'owner_id', 'blog_id', 'log_no', 'capture_hash', 'created_at', 'payload'];
  const SHA = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const naver = () => root.HaedoLife?.NaverBlog || (typeof require === 'function' && require('./naver-blog.js'));
  function check(condition) {
    if (!condition) throw Object.assign(new Error('수집한 네이버 글과 사진의 보관 형식을 확인해 주세요.'), { code: 'naver_capture_invalid' });
  }
  function object(value, fields) {
    check(value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
    const keys = Reflect.ownKeys(value);
    check(keys.length === fields.length && fields.every(key => Object.hasOwn(value, key)) && keys.every(key =>
      typeof key === 'string' && fields.includes(key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')));
  }
  function array(value, max) {
    check(Array.isArray(value) && value.length <= max && Reflect.ownKeys(value).length === value.length + 1);
    for (let i = 0; i < value.length; i++) check(Object.hasOwn(value, i) &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(i)), 'value'));
  }
  function text(value, max, empty = false) {
    return typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0) &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(value);
  }
  const utf8 = value => new TextEncoder().encode(value);
  function stamp(value) {
    return typeof value === 'string' && value.length <= 40 &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
  }
  function imageURL(value) {
    if (!text(value, 8192) || /[\s\\]/.test(value)) return false;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port; }
    catch (_) { return false; }
  }
  function options(input = {}) {
    check(input !== null && typeof input === 'object');
    const keys = Reflect.ownKeys(input);
    check(keys.every(key => ['local', 'ownerId'].includes(key) && Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), 'value')));
    check(input.local === undefined || typeof input.local === 'boolean');
    check(input.ownerId === undefined || typeof input.ownerId === 'string' && UUID.test(input.ownerId));
    check(!(input.local && input.ownerId !== undefined));
    return { local: input.local === true, ownerId: input.ownerId };
  }
  function snapshot(value, opts = {}) {
    const opt = options(opts); object(value, PAYLOAD);
    check(value.version === 1 && typeof value.blogId === 'string' && /^[A-Za-z0-9_-]{1,50}$/.test(value.blogId) &&
      typeof value.logNo === 'string' && /^[1-9][0-9]{0,29}$/.test(value.logNo));
    const identity = naver().postIdentity(value.url);
    check(identity && identity.blogId === value.blogId && identity.logNo === value.logNo && value.url === identity.url);
    check(text(value.title, 500) && ['text/plain', 'text/markdown'].includes(value.format) &&
      typeof value.htmlHash === 'string' && SHA.test(value.htmlHash) && text(value.author, 500, true) &&
      (value.publishedAt === null || stamp(value.publishedAt)) && stamp(value.extractedAt) && text(value.extractor, 200));
    if (value.body === null) check(value.bodyHash === null && value.coverage === 'link_only');
    else check(text(value.body, LIMITS.body, true) && value.body.length > 0 && utf8(value.body).length <= LIMITS.body &&
      typeof value.bodyHash === 'string' && SHA.test(value.bodyHash) && ['partial', 'full_text', 'unknown'].includes(value.coverage));
    array(value.omissions, LIMITS.omissions); check(value.omissions.every(item => text(item, 500)));
    array(value.photos, LIMITS.photos);
    let total = 0, failed = false;
    const photos = value.photos.map((photo, index) => {
      object(photo, PHOTO);
      check(photo.index === index && imageURL(photo.url) && text(photo.alt, 2000, true) && text(photo.caption, 2000, true) && photo.originalStatus === 'unverified');
      if (photo.status === 'stored') {
        check(typeof photo.sha256 === 'string' && SHA.test(photo.sha256) && ['image/jpeg', 'image/png', 'image/webp'].includes(photo.mimeType) &&
          [photo.width, photo.height, photo.bytes].every(n => Number.isSafeInteger(n) && n > 0) &&
          Number.isSafeInteger(photo.width * photo.height) && photo.bytes <= LIMITS.file && photo.error === null);
        total += photo.bytes; check(total <= LIMITS.bytes);
        if (opt.local) check(photo.storagePath === null);
        else {
          check(typeof photo.storagePath === 'string');
          const owner = photo.storagePath.split('/')[0];
          check(UUID.test(owner) && (!opt.ownerId || owner === opt.ownerId) &&
            photo.storagePath === owner + '/naver/' + value.blogId + '/' + value.logNo + '/' + photo.sha256);
        }
      } else {
        check(photo.status === 'failed' && ['storagePath', 'sha256', 'mimeType', 'width', 'height', 'bytes'].every(key => photo[key] === null) &&
          typeof photo.error === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(photo.error)); failed = true;
      }
      return Object.fromEntries(PHOTO.map(key => [key, photo[key]]));
    });
    check(!failed || value.omissions.length > 0);
    const result = Object.fromEntries(PAYLOAD.map(key => [key, value[key]]));
    result.omissions = value.omissions.slice(); result.photos = photos;
    check(utf8(JSON.stringify(result)).length <= LIMITS.payload);
    return result;
  }
  function validatePayload(value, opts) { snapshot(value, opts); return true; }
  async function sha(value) {
    const subtle = root.crypto?.subtle || (typeof require === 'function' && require('node:crypto').webcrypto.subtle);
    check(subtle); const bytes = await subtle.digest('SHA-256', utf8(value));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function verifyOwned(value) {
    if (value.body !== null) check(await sha(value.body) === value.bodyHash);
    return value;
  }
  async function verifyPayload(value, opts) { return verifyOwned(snapshot(value, opts)); }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  function hashInput(value) {
    const { extractedAt, ...payload } = value;
    payload.photos = value.photos.map(({ storagePath, ...photo }) => photo);
    return canonical(payload);
  }
  async function fingerprint(value, opts) {
    const owned = await verifyPayload(value, opts); return sha(hashInput(owned));
  }
  async function validateCaptureRow(value, opts = {}) {
    object(value, ROW); check(opts !== null && typeof opts === 'object');
    object(opts, Object.hasOwn(opts, 'ownerId') ? ['ownerId'] : []);
    check(typeof value.id === 'string' && UUID.test(value.id) && typeof value.owner_id === 'string' && UUID.test(value.owner_id) &&
      (opts.ownerId === undefined || opts.ownerId === value.owner_id) && stamp(value.created_at) &&
      typeof value.capture_hash === 'string' && SHA.test(value.capture_hash));
    const payload = snapshot(value.payload, { ownerId: value.owner_id });
    check(value.blog_id === payload.blogId && value.log_no === payload.logNo);
    const result = Object.fromEntries(ROW.map(key => [key, value[key]])); result.payload = payload;
    await verifyOwned(payload); check(await sha(hashInput(payload)) === result.capture_hash);
    return result;
  }
  function toImportInput(value, input = {}) {
    check(input !== null && typeof input === 'object');
    const keys = Reflect.ownKeys(input);
    object(input, keys); check(keys.every(key => ['existingSourceId', 'existingSourceUrl', 'local'].includes(key)));
    const payload = snapshot(value, { local: input.local === true });
    check(input.local === undefined || typeof input.local === 'boolean');
    let url = payload.url;
    if (input.existingSourceId !== undefined) {
      check(typeof input.existingSourceId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(input.existingSourceId));
      if (input.existingSourceUrl !== undefined) {
        const identity = naver().postIdentity(input.existingSourceUrl);
        check(identity && identity.blogId === payload.blogId && identity.logNo === payload.logNo); url = input.existingSourceUrl;
      }
    } else check(input.existingSourceUrl === undefined);
    return { origin: 'naver_blog', title: payload.title, url, text: payload.body, format: payload.format,
      author: payload.author, authorRelation: 'unknown', originalCreatedAt: payload.publishedAt,
      coverage: { status: payload.coverage, omissions: payload.omissions.slice() },
      ...(input.existingSourceId === undefined ? {} : { existingSourceId: input.existingSourceId }) };
  }
  return Object.freeze({ LIMITS, validatePayload, verifyPayload, validateCaptureRow, fingerprint, toImportInput });
});

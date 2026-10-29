/* Immutable source-version pointers to a verified Naver capture hash. A pointer
 * is not proof of server storage: the current account must revalidate its row.
 * No Core dependency, account identifier, storage path, I/O or photo bytes. */
(function (root, factory) {
  'use strict';
  const api = factory(root); (root.HaedoLife ||= {}).NaverCaptureReference = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const KIND = 'naver_capture_reference', FORMAT = 'haedo.naver.capture-reference.v1';
  const LINK = ['id', 'kind', 'note', 'entityRefs', 'revision', 'createdAt', 'updatedAt'];
  const NOTE = ['format', 'blogId', 'logNo', 'captureHash'];
  const REFERENCE = ['sourceVersionId', 'blogId', 'logNo', 'captureHash'];
  const ID = /^[A-Za-z0-9_-]{1,128}$/, BLOG = /^[A-Za-z0-9_-]{1,50}$/, LOG = /^[1-9][0-9]{0,29}$/, SHA = /^[a-f0-9]{64}$/;
  const clone = value => JSON.parse(JSON.stringify(value));
  function need(condition, code = 'invalid_naver_capture_reference') {
    if (!condition) throw Object.assign(new Error(code === 'immutable_source_version' ?
      '사진이 연결된 정확한 원문 판은 변경할 수 없습니다. 기존 원문과 사진을 유지했습니다.' :
      '원문 판과 사진 연결을 확인해 주세요. 기존 원문과 사진을 유지했습니다.'), { code });
  }
  function plain(value) {
    return value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  }
  function fields(value, keys) {
    need(plain(value)); const names = Reflect.ownKeys(value);
    need(names.length === keys.length && keys.every(key => Object.hasOwn(value, key)) && names.every(key =>
      typeof key === 'string' && keys.includes(key) && Object.getOwnPropertyDescriptor(value, key).enumerable &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')));
  }
  function identifier(value) { need(typeof value === 'string' && ID.test(value)); }
  function stamp(value) {
    need(typeof value === 'string' && value.length <= 40 && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)));
  }
  function reference(value) {
    fields(value, REFERENCE); identifier(value.sourceVersionId);
    need(typeof value.blogId === 'string' && BLOG.test(value.blogId) && typeof value.logNo === 'string' && LOG.test(value.logNo) &&
      typeof value.captureHash === 'string' && SHA.test(value.captureHash));
    return Object.fromEntries(REFERENCE.map(key => [key, value[key]]));
  }
  function validate(link) {
    fields(link, LINK); identifier(link.id);
    need(link.kind === KIND && link.revision === 1); stamp(link.createdAt); stamp(link.updatedAt);
    need(link.createdAt === link.updatedAt);
    need(Array.isArray(link.entityRefs) && link.entityRefs.length === 1 && Reflect.ownKeys(link.entityRefs).length === 2 &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(link.entityRefs, '0') || {}, 'value'));
    const target = link.entityRefs[0]; fields(target, ['entityType', 'entityId']);
    need(target.entityType === 'sourceVersion'); identifier(target.entityId);
    need(typeof link.note === 'string' && link.note.length <= 512);
    let value; try { value = JSON.parse(link.note); } catch (_) { need(false); }
    fields(value, NOTE); need(value.format === FORMAT);
    // Round-trip form also rejects duplicate JSON keys and hidden extra values.
    need(JSON.stringify(value) === link.note);
    return reference({ sourceVersionId: target.entityId, blogId: value.blogId, logNo: value.logNo, captureHash: value.captureHash });
  }
  function create(input, options) {
    const value = reference(input); fields(options, ['id', 'createdAt']); identifier(options.id); stamp(options.createdAt);
    const link = { id: options.id, kind: KIND, note: JSON.stringify({ format: FORMAT, blogId: value.blogId,
      logNo: value.logNo, captureHash: value.captureHash }), entityRefs: [{ entityType: 'sourceVersion', entityId: value.sourceVersionId }],
      revision: 1, createdAt: options.createdAt, updatedAt: options.createdAt };
    validate(link); return link;
  }
  function index(bundle) {
    need(plain(bundle) && Array.isArray(bundle.sources) && Array.isArray(bundle.sourceVersions) && Array.isArray(bundle.links));
    const sources = new Map(), versions = new Map(), links = new Map(), ids = new Set();
    for (const source of bundle.sources) { need(plain(source)); identifier(source.id); need(!sources.has(source.id)); sources.set(source.id, source); }
    for (const version of bundle.sourceVersions) { need(plain(version)); identifier(version.id); need(!versions.has(version.id)); versions.set(version.id, version); }
    for (const link of bundle.links) {
      need(plain(link)); const descriptor = Object.getOwnPropertyDescriptor(link, 'kind');
      if (!descriptor) continue;
      need(Object.hasOwn(descriptor, 'value'));
      if (descriptor.value !== KIND) continue;
      const value = validate(link), version = versions.get(value.sourceVersionId), source = version && sources.get(version.sourceId);
      need(!links.has(value.sourceVersionId) && !ids.has(link.id), 'duplicate_naver_capture_reference'); ids.add(link.id);
      need(version && source && source.origin === 'naver_blog');
      const naver = root.HaedoLife?.NaverBlog || (typeof require === 'function' && require('./naver-blog.js'));
      need(naver?.postIdentity, 'dependency_unavailable'); const identity = naver.postIdentity(source.url);
      need(identity && identity.blogId === value.blogId && identity.logNo === value.logNo);
      links.set(value.sourceVersionId, { link, reference: value });
    }
    return { sources, versions, links };
  }
  function validateWorkspace(bundle) { index(bundle); return true; }
  function get(bundle, sourceId, sourceVersionId) {
    identifier(sourceId); identifier(sourceVersionId); const current = index(bundle), version = current.versions.get(sourceVersionId);
    need(current.sources.has(sourceId) && version?.sourceId === sourceId);
    const value = current.links.get(sourceVersionId); return value ? clone(value) : null;
  }
  function find(bundle, sourceVersionId) {
    identifier(sourceVersionId); const current = index(bundle), version = current.versions.get(sourceVersionId);
    need(version && current.sources.has(version.sourceId)); const value = current.links.get(sourceVersionId);
    return value ? clone(value) : null;
  }
  function assertCapture(input, capture) {
    const value = reference(input);
    // The caller first verifies Capture.validateCaptureRow and the current owner.
    need(plain(capture) && plain(capture.payload) && capture.capture_hash === value.captureHash && capture.blog_id === value.blogId &&
      capture.log_no === value.logNo && capture.payload.blogId === value.blogId && capture.payload.logNo === value.logNo,
    'naver_capture_reference_mismatch');
    return true;
  }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  function assertPreserved(previous, incoming) {
    const before = index(previous), after = index(incoming);
    for (const [versionId, value] of before.links) {
      const retained = after.links.get(versionId);
      need(retained && canonical(retained.link) === canonical(value.link), 'immutable_naver_capture_reference');
      need(canonical(before.versions.get(versionId)) === canonical(after.versions.get(versionId)), 'immutable_source_version');
    }
    return true;
  }
  return Object.freeze({ KIND, FORMAT, create, validate, get, find, validateWorkspace, assertCapture, assertPreserved });
});

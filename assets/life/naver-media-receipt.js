/* Exact private source-version to server-capture identity. No photo bytes or
 * ownership inference: callers must verify the server capture and its owner. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).NaverMediaReceipt = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const KEYS = ['workspaceId', 'sourceId', 'sourceVersionId', 'captureId', 'captureHash'];
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const ID = /^[A-Za-z0-9_-]{1,128}$/, HASH = /^[a-f0-9]{64}$/;
  const need = value => {
    if (!value) throw Object.assign(new Error('원문 판과 사진 수집 사본의 정확한 연결을 확인해 주세요.'), { code: 'invalid_naver_media_receipt' });
  };
  function object(value) {
    need(value && typeof value === 'object' && !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  }
  function field(value, key) {
    object(value);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(descriptor?.enumerable && Object.hasOwn(descriptor, 'value'));
    return descriptor.value;
  }
  function validate(value) {
    object(value);
    const keys = Reflect.ownKeys(value);
    need(keys.length === KEYS.length && keys.every(key => typeof key === 'string' && KEYS.includes(key)));
    const result = Object.fromEntries(KEYS.map(key => [key, field(value, key)]));
    need(typeof result.workspaceId === 'string' && UUID.test(result.workspaceId));
    need(typeof result.sourceId === 'string' && ID.test(result.sourceId));
    need(typeof result.sourceVersionId === 'string' && ID.test(result.sourceVersionId));
    need(typeof result.captureId === 'string' && UUID.test(result.captureId));
    need(typeof result.captureHash === 'string' && HASH.test(result.captureHash));
    return result;
  }
  function fromAttachment(workspaceId, attachment) {
    need(field(attachment, 'localOnly') === false);
    const capture = field(attachment, 'capture');
    return validate({ workspaceId, sourceId: field(attachment, 'sourceId'), sourceVersionId: field(attachment, 'sourceVersionId'),
      captureId: field(capture, 'id'), captureHash: field(capture, 'capture_hash') });
  }
  function checkAttachment(input, attachment) {
    const receipt = validate(input), other = fromAttachment(receipt.workspaceId, attachment);
    need(KEYS.every(key => receipt[key] === other[key]));
    return true;
  }
  function checkTarget(bundle, input) {
    const receipt = validate(input), core = root.HaedoLife?.Core || (typeof require === 'function' && require('./core.js'));
    need(core?.validateWorkspace); core.validateWorkspace(bundle);
    need(bundle.workspaceId === receipt.workspaceId);
    const source = bundle.sources.find(value => value.id === receipt.sourceId);
    const version = bundle.sourceVersions.find(value => value.id === receipt.sourceVersionId);
    need(source?.origin === 'naver_blog' && version?.sourceId === source.id);
    return true;
  }
  return Object.freeze({ validate, fromAttachment, checkAttachment, checkTarget });
});

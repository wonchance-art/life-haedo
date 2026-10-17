/* Exact private source evidence. No saved note, authorship inference or latest-version substitution. */
(function (root, factory) {
  const api = factory(root);
  (root.HaedoLife ||= {}).SourceReference = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const FORMAT = 'life-source-reference-v1';
  const keys = ['format', 'workspaceId', 'sourceId', 'sourceVersionId', 'locator', 'quote', 'contentHash', 'title', 'sourceKey', 'url'];
  const core = () => root.HaedoLife?.Core || require('./core.js');
  const fail = message => { throw Object.assign(new Error(message), { code: 'invalid_source_reference' }); };
  const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  function fields(value, allowed) {
    if (!plain(value) || Reflect.ownKeys(value).length !== allowed.length || allowed.some(key => !Object.hasOwn(value, key))) fail('원문 근거 형식을 확인해 주세요.');
  }
  function text(value, max) {
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(value)) fail('원문 근거의 문자와 길이를 확인해 주세요.');
  }
  function safeUrl(value) {
    if (!value) return '';
    text(value, 2048);
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || /[\s\\]/u.test(value)) throw 0;
      return value;
    } catch (_) { fail('출처는 계정 정보가 없는 http 또는 https 주소여야 합니다.'); }
  }
  function validate(ref) {
    fields(ref, keys);
    if (ref.format !== FORMAT) fail('원문 근거 형식을 확인해 주세요.');
    for (const key of ['workspaceId', 'sourceId', 'sourceVersionId']) if (typeof ref[key] !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(ref[key])) fail('원문의 정확한 식별자를 확인해 주세요.');
    fields(ref.locator, ['start', 'end']);
    if (!Number.isSafeInteger(ref.locator.start) || !Number.isSafeInteger(ref.locator.end) || ref.locator.start < 0 || ref.locator.end <= ref.locator.start) fail('인용할 원문 구절을 선택해 주세요.');
    text(ref.quote, 50000); text(ref.title, 500); text(ref.sourceKey, 2000); safeUrl(ref.url);
    if (ref.quote.length !== ref.locator.end - ref.locator.start || !/^[a-f0-9]{64}$/.test(ref.contentHash)) fail('원문의 구절과 해시를 확인해 주세요.');
    return true;
  }
  const freeze = ref => Object.freeze({ ...ref, locator: Object.freeze({ ...ref.locator }) });
  const hash = async text => Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
  async function build({ bundle, sourceId, versionId, locator }) {
    core().validateWorkspace(bundle);
    const source = bundle.sources.find(value => value.id === sourceId);
    const version = bundle.sourceVersions.find(value => value.id === versionId && value.sourceId === sourceId);
    if (!source || !version || typeof version.contentText !== 'string') fail('선택한 원문 버전의 본문을 찾을 수 없습니다. 다른 버전으로 바꾸지 않았습니다.');
    if (!locator || !Number.isSafeInteger(locator.start) || !Number.isSafeInteger(locator.end) || locator.start < 0 || locator.end > version.contentText.length || locator.end <= locator.start) fail('인용할 원문 구절을 선택해 주세요.');
    const ref = { format: FORMAT, workspaceId: bundle.workspaceId, sourceId, sourceVersionId: versionId,
      locator: { start: locator.start, end: locator.end }, quote: version.contentText.slice(locator.start, locator.end), contentHash: version.contentHash,
      title: source.title, sourceKey: source.sourceKey || '', url: safeUrl(source.url || '') };
    validate(ref);
    if (await hash(version.contentText) !== ref.contentHash) fail('원문 해시가 일치하지 않습니다. 원본을 확인해 주세요.');
    return freeze(ref);
  }
  async function resolve(bundle, ref) {
    validate(ref);
    if (bundle.workspaceId !== ref.workspaceId) fail('다른 작업공간의 원문 근거입니다.');
    const current = await build({ bundle, sourceId: ref.sourceId, versionId: ref.sourceVersionId, locator: ref.locator });
    if (current.contentHash !== ref.contentHash || current.quote !== ref.quote) fail('보관한 정확한 원문 근거와 일치하지 않습니다.');
    return Object.freeze({ sourceId: ref.sourceId, sourceVersionId: ref.sourceVersionId, locator: Object.freeze({ ...ref.locator }) });
  }
  function validatePost(ref) {
    fields(ref, ['format', 'workspaceId', 'postId', 'postRevision', 'locator', 'quote', 'contentHash', 'title']);
    if (ref.format !== 'life-post-reference-v1') fail('저장 글의 근거 형식을 확인해 주세요.');
    for (const key of ['workspaceId', 'postId']) if (typeof ref[key] !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(ref[key])) fail('저장 글의 식별자를 확인해 주세요.');
    if (!Number.isSafeInteger(ref.postRevision) || ref.postRevision < 1) fail('저장 글의 버전을 확인해 주세요.');
    fields(ref.locator, ['start', 'end']);
    text(ref.title, 500); text(ref.quote, 50000);
    if (!Number.isSafeInteger(ref.locator.start) || !Number.isSafeInteger(ref.locator.end) || ref.locator.start < 0 || ref.locator.end <= ref.locator.start || ref.quote.length !== ref.locator.end - ref.locator.start || !/^[a-f0-9]{64}$/.test(ref.contentHash)) fail('저장 글의 정확한 구절을 확인해 주세요.');
    return true;
  }
  async function buildPost({ workspaceId, post, locator }) {
    const model = root.HaedoLife?.PhotoPost || require('./photo-post.js'); model.validate(post);
    if (post.status !== 'saved' || post.archived) fail('보관하지 않은 저장 글을 선택해 주세요.');
    const body = model.plainText(post), range = locator || { start: 0, end: body.length };
    const ref = { format: 'life-post-reference-v1', workspaceId, postId: post.id, postRevision: post.revision,
      locator: { start: range.start, end: range.end }, quote: body.slice(range.start, range.end), contentHash: await hash(body), title: post.title };
    validatePost(ref); return freeze(ref);
  }
  async function resolvePost({ workspaceId, post }, ref) {
    validatePost(ref);
    if (workspaceId !== ref.workspaceId || post.id !== ref.postId || post.revision !== ref.postRevision) fail('저장 글이 바뀌었거나 다른 작업공간의 근거입니다. 최신 글로 바꾸지 않았습니다.');
    const current = await buildPost({ workspaceId, post, locator: ref.locator });
    if (current.quote !== ref.quote || current.contentHash !== ref.contentHash) fail('보관한 저장 글의 본문과 일치하지 않습니다.');
    return Object.freeze({ postId: ref.postId, postRevision: ref.postRevision, locator: Object.freeze({ ...ref.locator }) });
  }
  function remap(ref, { workspaceId, sourceIds, versionIds }) {
    validate(ref);
    const next = { ...ref, workspaceId, sourceId: sourceIds[ref.sourceId], sourceVersionId: versionIds[ref.sourceVersionId], locator: { ...ref.locator } };
    validate(next); return freeze(next);
  }
  return Object.freeze({ FORMAT, validate, safeUrl, build, resolve, remap, validatePost, buildPost, resolvePost });
});

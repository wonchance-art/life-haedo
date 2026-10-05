/* Authored plain text reuses immutable source versions. Drafts stay local. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  root.HaedoLife ||= {};
  root.HaedoLife.Writing = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';

  const FORMAT = 'life-writing-draft-v1';
  const SOURCE_KEY_PREFIX = 'haedo:writing:';
  const SOURCE_KEY = /^haedo:writing:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  const LIMITS = Object.freeze({ title: 500, bytes: 1024 * 1024 });
  const clone = value => structuredClone(value);
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  function fail(code, message) { throw Object.assign(new Error(message), { code }); }
  function assert(value, code, message) { if (!value) fail(code, message); }
  function fields(value, required, optional = []) {
    assert(plain(value) && Reflect.ownKeys(value).every(key => required.includes(key) || optional.includes(key)) &&
      required.every(key => Object.hasOwn(value, key)), 'invalid_writing', '글쓰기 초안의 항목과 형식을 확인해 주세요.');
  }
  function identifier(value) {
    assert(typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value), 'invalid_writing', '글쓰기 자료 식별자를 확인해 주세요.');
  }
  function revision(value, minimum = 0) {
    assert(Number.isSafeInteger(value) && value >= minimum, 'invalid_writing', '글쓰기 저장 버전을 확인해 주세요.');
  }
  function timestamp(value) {
    assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
      'invalid_writing', '글쓰기 저장 시각을 확인해 주세요.');
  }
  function text(value, maximum) {
    assert(typeof value === 'string' && value.length <= maximum, 'invalid_writing', '제목과 본문의 길이 또는 형식을 확인해 주세요.');
    assert(!value.includes('\u0000'), 'invalid_encoding', '글에 읽을 수 없는 문자가 있습니다.');
    for (let index = 0; index < value.length; index++) {
      const unit = value.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(++index);
        assert(next >= 0xdc00 && next <= 0xdfff, 'invalid_encoding', '글의 문자 인코딩을 확인해 주세요.');
      } else assert(unit < 0xdc00 || unit > 0xdfff, 'invalid_encoding', '글의 문자 인코딩을 확인해 주세요.');
    }
  }
  function core() {
    const value = root.HaedoLife?.Core || (typeof require === 'function' ? require('./core.js') : null);
    assert(value?.validateWorkspace && value?.prepareImport && value?.buildImportChanges && value?.id,
      'dependency_unavailable', '자료 모듈을 불러오지 못했습니다.');
    return value;
  }
  // This is a managed app-origin marker, not proof of authorship. An imported
  // self relation is insufficient; normal file imports cannot produce this key.
  // The marker is independent of source.id so copying a backup can remap IDs.
  function isWritingSource(source) {
    return !!(plain(source) && source.origin === 'other' && source.url === undefined &&
      typeof source.sourceKey === 'string' && SOURCE_KEY.test(source.sourceKey));
  }
  function latestVersion(bundle, sourceId) {
    if (!Array.isArray(bundle?.sourceVersions)) return null;
    return bundle.sourceVersions.findLast(version => version.sourceId === sourceId) || null;
  }
  function isOwnSource(source, bundle) {
    if (!isWritingSource(source) || !Array.isArray(bundle?.sourceVersions) ||
        !bundle.sources?.some(item => item.id === source.id && item.sourceKey === source.sourceKey && isWritingSource(item))) return false;
    const versions = bundle.sourceVersions.filter(version => version.sourceId === source.id);
    return versions.length > 0 && versions.every(version => version.format === 'text/plain' &&
      typeof version.contentText === 'string' && version.contentText.length > 0 &&
      version.originalAuthor?.relation === 'self' && version.coverage?.status === 'full_text' &&
      Array.isArray(version.coverage.omissions) && version.coverage.omissions.length === 0);
  }
  function validateDraft(stage) {
    fields(stage, ['kind', 'format', 'stageId', 'workspaceId', 'revision', 'state', 'sourceId',
      'baseSourceRevision', 'baseSourceVersionId', 'title', 'text', 'createdAt', 'updatedAt'], ['appliedResult', 'baseChanged']);
    assert(stage.kind === 'writing' && stage.format === FORMAT, 'invalid_writing', '지원하는 글쓰기 초안이 아닙니다.');
    identifier(stage.stageId); identifier(stage.workspaceId); revision(stage.revision);
    timestamp(stage.createdAt); timestamp(stage.updatedAt);
    assert(stage.state === 'draft' || stage.state === 'applied', 'invalid_writing', '글쓰기 초안 상태를 확인해 주세요.');
    text(stage.title, LIMITS.title); text(stage.text, LIMITS.bytes);
    assert(new TextEncoder().encode(stage.text).length <= LIMITS.bytes, 'text_too_large', '본문은 UTF-8 기준 1 MiB까지 보관할 수 있습니다.');
    if (stage.sourceId === null) {
      assert(stage.baseSourceRevision === null && stage.baseSourceVersionId === null, 'invalid_writing', '새 글에 이전 원문 버전을 연결할 수 없습니다.');
    } else {
      identifier(stage.sourceId); revision(stage.baseSourceRevision, 1); identifier(stage.baseSourceVersionId);
    }
    if (Object.hasOwn(stage, 'baseChanged')) assert(stage.baseChanged === true && stage.sourceId !== null,
      'invalid_writing', '다른 원문으로 바뀐 초안의 기준을 확인해 주세요.');
    if (stage.appliedResult !== undefined) {
      assert(stage.state === 'applied', 'invalid_writing', '초안에 확정된 원문을 연결할 수 없습니다.');
      fields(stage.appliedResult, ['sourceId', 'sourceVersionId']);
      identifier(stage.appliedResult.sourceId); identifier(stage.appliedResult.sourceVersionId);
    }
    return true;
  }
  function isDraft(stage) {
    try { validateDraft(stage); return stage.state === 'draft'; } catch (_) { return false; }
  }
  function createDraft(bundle, options = {}) {
    core().validateWorkspace(bundle); fields(options, [], ['sourceId']);
    const time = new Date().toISOString();
    const draft = { kind: 'writing', format: FORMAT, stageId: core().id(), workspaceId: bundle.workspaceId,
      revision: 0, state: 'draft', sourceId: null, baseSourceRevision: null, baseSourceVersionId: null,
      title: '', text: '', createdAt: time, updatedAt: time };
    if (options.sourceId !== undefined) {
      identifier(options.sourceId);
      const source = bundle.sources.find(item => item.id === options.sourceId);
      assert(isOwnSource(source, bundle), 'not_own_writing', '해도에서 직접 쓴 글만 수정할 수 있습니다.');
      const version = latestVersion(bundle, source.id);
      Object.assign(draft, { sourceId: source.id, baseSourceRevision: source.revision,
        baseSourceVersionId: version.id, title: source.title, text: version.contentText });
    }
    validateDraft(draft);
    return draft;
  }
  function recoverDraft(stage, options = {}) {
    validateDraft(stage); fields(options, [], ['asNew']);
    assert(stage.state === 'draft' && (options.asNew === undefined || typeof options.asNew === 'boolean'),
      'invalid_writing', '확정 전 글의 입력만 새 초안으로 보존할 수 있습니다.');
    const result = { ...clone(stage), stageId: core().id(), revision: 0, updatedAt: new Date().toISOString() };
    if (options.asNew) {
      Object.assign(result, { sourceId: null, baseSourceRevision: null, baseSourceVersionId: null });
      delete result.baseChanged;
    }
    validateDraft(result);
    return result;
  }
  async function prepareSave(bundle, stage) {
    core().validateWorkspace(bundle); validateDraft(stage);
    assert(stage.state === 'draft', 'invalid_writing', '이미 보관한 초안입니다. 글에서 수정을 시작해 주세요.');
    assert(stage.workspaceId === bundle.workspaceId, 'workspace_mismatch', '이 글의 작업공간이 바뀌었습니다. 입력을 보존하고 다시 열어 주세요.');
    assert(stage.text.trim().length > 0, 'missing_text', '보관할 본문을 써 주세요.');
    // Own both inputs before Core's asynchronous hash calculation yields.
    const snapshot = clone(bundle), draft = clone(stage);
    let source = null, head = null;
    if (draft.sourceId !== null) {
      source = snapshot.sources.find(item => item.id === draft.sourceId);
      assert(isOwnSource(source, snapshot), 'not_own_writing', '해도에서 직접 쓴 글만 수정할 수 있습니다.');
      head = latestVersion(snapshot, source.id);
      assert(!draft.baseChanged && source.revision === draft.baseSourceRevision && head.id === draft.baseSourceVersionId,
        'writing_conflict', '다른 곳에서 이 글을 수정했습니다. 입력을 보존하고 새 글로 보관하거나 최신 글을 확인해 주세요.');
    }
    // Always create a new immutable version, including a revert to earlier text.
    // Import's historical duplicate matching must not silently select an old head.
    const prepared = await core().prepareImport({ origin: 'other', title: draft.title.trim() || '제목 없는 글',
      text: draft.text, format: 'text/plain', authorRelation: 'self', coverage: 'full_text',
      originalCreatedAt: head ? head.originalCreatedAt : draft.createdAt, forceSeparate: true }, snapshot);
    if (source) {
      prepared.source = { ...clone(source), title: prepared.source.title, revision: source.revision + 1,
        updatedAt: prepared.source.updatedAt };
      prepared.version.sourceId = source.id;
      prepared.match = { kind: 'new_revision', sourceId: source.id };
    } else prepared.source.sourceKey = SOURCE_KEY_PREFIX + core().id();
    const changes = core().buildImportChanges(snapshot, prepared);
    return { changes, stageResult: { sourceId: prepared.source.id, sourceVersionId: prepared.version.id },
      source: prepared.source, version: prepared.version };
  }
  function toText(stage) {
    // Recovery export must also work after a draft exceeds the storage limit.
    // Validate the text encoding, but do not impose persistence metadata/size
    // requirements or silently replace malformed UTF-16 through Blob encoding.
    assert(plain(stage), 'invalid_writing', '내보낼 글을 확인해 주세요.');
    text(stage.title, Number.MAX_SAFE_INTEGER); text(stage.text, Number.MAX_SAFE_INTEGER);
    return (stage.title ? stage.title + '\n\n' : '') + stage.text;
  }

  return Object.freeze({ FORMAT, SOURCE_KEY_PREFIX, LIMITS, isWritingSource, isOwnSource, latestVersion,
    isDraft, validateDraft, createDraft, recoverDraft, prepareSave, toText });
});

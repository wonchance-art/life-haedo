/* Local source-copy editing. Immutable originals and source identity stay intact. */
(function (root, factory) {
  'use strict';
  const api = factory(root); root.HaedoLife ||= {}; root.HaedoLife.SourceEdit = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const FORMAT = 'life-source-edit-v1', LIMITS = Object.freeze({ title: 500, bytes: 1024 * 1024 });
  const copy = value => structuredClone(value);
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : plain(value) ?
    '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
  const same = (a, b) => canonical(a) === canonical(b);
  function fail(code, message) { throw Object.assign(new Error(message), { code }); }
  function assert(value, code = 'invalid_source_edit', message = '자료 수정 초안의 항목과 형식을 확인해 주세요.') { if (!value) fail(code, message); }
  function fields(value, required, optional = []) {
    assert(plain(value) && Reflect.ownKeys(value).every(key => required.includes(key) || optional.includes(key)) && required.every(key => Object.hasOwn(value, key)));
  }
  function identifier(value) { assert(typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)); }
  function revision(value, minimum = 0) { assert(Number.isSafeInteger(value) && value >= minimum); }
  function timestamp(value) { assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))); }
  function text(value, max) {
    assert(typeof value === 'string' && value.length <= max && !value.includes('\0'));
    for (let index = 0; index < value.length; index++) {
      const unit = value.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(++index); assert(next >= 0xdc00 && next <= 0xdfff);
      } else assert(unit < 0xdc00 || unit > 0xdfff);
    }
  }
  function core() { const value = root.HaedoLife?.Core || (typeof require === 'function' && require('./core.js')); assert(value?.sourceState && value?.prepareImport, 'dependency_unavailable', '자료 모듈을 불러오지 못했습니다.'); return value; }
  function validate(stage) {
    fields(stage, ['kind', 'format', 'stageId', 'workspaceId', 'revision', 'state', 'baseSourceId', 'baseSourceRevision',
      'baseSourceVersionId', 'baseHash', 'lifecycleRevision', 'restoreVersionId', 'input', 'createdAt', 'updatedAt'], ['appliedResult', 'baseChanged']);
    assert(stage.kind === 'source-edit' && stage.format === FORMAT);
    for (const key of ['stageId', 'workspaceId', 'baseSourceId', 'baseSourceVersionId']) identifier(stage[key]);
    revision(stage.revision); revision(stage.baseSourceRevision, 1); revision(stage.lifecycleRevision);
    assert(stage.baseHash === null || typeof stage.baseHash === 'string' && /^[a-f0-9]{64}$/.test(stage.baseHash));
    assert(stage.restoreVersionId === null || typeof stage.restoreVersionId === 'string'); if (stage.restoreVersionId !== null) identifier(stage.restoreVersionId);
    assert(stage.state === 'draft' || stage.state === 'applied'); timestamp(stage.createdAt); timestamp(stage.updatedAt);
    assert(Date.parse(stage.updatedAt) >= Date.parse(stage.createdAt));
    fields(stage.input, ['title', 'text', 'format']); text(stage.input.title, LIMITS.title); text(stage.input.text, LIMITS.bytes);
    assert(new TextEncoder().encode(stage.input.text).length <= LIMITS.bytes, 'text_too_large', '본문은 UTF-8 기준 1 MiB까지 보관할 수 있습니다.');
    assert(['text/plain', 'text/markdown'].includes(stage.input.format));
    if (stage.baseChanged !== undefined) assert(stage.baseChanged === true);
    if (stage.appliedResult !== undefined) {
      assert(stage.state === 'applied'); fields(stage.appliedResult, ['sourceId', 'sourceVersionId']);
      identifier(stage.appliedResult.sourceId); identifier(stage.appliedResult.sourceVersionId); assert(stage.appliedResult.sourceId === stage.baseSourceId);
    }
    return true;
  }
  function managedWriting(source) {
    return source.origin === 'other' && source.url === undefined && typeof source.sourceKey === 'string' &&
      /^haedo:writing:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(source.sourceKey);
  }
  function validateCurrent(bundle, stage) {
    core().validateWorkspace(bundle); validate(stage);
    assert(stage.state === 'draft', 'source_edit_applied', '이미 저장한 수정 초안입니다. 자료에서 다시 수정을 시작해 주세요.');
    assert(bundle.workspaceId === stage.workspaceId, 'workspace_mismatch', '자료의 작업공간이 바뀌었습니다. 수정 입력은 유지합니다.');
    const source = bundle.sources.find(value => value.id === stage.baseSourceId);
    assert(source && !managedWriting(source), 'not_imported_source', '해도에서 직접 쓴 글은 기존 글 수정에서 열어 주세요.');
    const head = bundle.sourceVersions.findLast(value => value.sourceId === source.id), lifecycle = core().sourceState(bundle, source.id);
    assert(lifecycle.status === 'active', 'source_trashed', '휴지통의 자료는 복원한 뒤 수정해 주세요. 입력은 남아 있습니다.');
    assert(!stage.baseChanged && source.revision === stage.baseSourceRevision && head?.id === stage.baseSourceVersionId && head.contentHash === stage.baseHash && lifecycle.revision === stage.lifecycleRevision,
      'source_edit_conflict', '다른 곳에서 자료나 휴지통 상태가 바뀌었습니다. 수정 입력을 보존하고 최신 자료와 비교해 주세요.');
    const selected = stage.restoreVersionId === null ? head : bundle.sourceVersions.find(value => value.id === stage.restoreVersionId && value.sourceId === source.id);
    assert(selected, 'missing_reference', '복원할 정확한 원문 판을 찾지 못했습니다. 다른 판으로 바꾸지 않았습니다.');
    return { source, head, selected, lifecycle };
  }
  function begin(bundle, sourceId, options = {}) {
    core().validateWorkspace(bundle); identifier(sourceId); fields(options, [], ['versionId', 'restore']);
    assert(options.restore === undefined || typeof options.restore === 'boolean');
    const source = bundle.sources.find(value => value.id === sourceId), head = bundle.sourceVersions.findLast(value => value.sourceId === sourceId);
    assert(source && head, 'missing_reference', '수정할 자료를 찾을 수 없습니다.');
    const selected = options.versionId === undefined ? head : bundle.sourceVersions.find(value => value.id === options.versionId && value.sourceId === sourceId);
    assert(selected, 'missing_reference', '선택한 정확한 원문 판을 찾을 수 없습니다.');
    assert(options.restore || selected.id === head.id, 'source_edit_old_version', '이전 판은 명시적으로 이 버전으로 복원할 때만 새 판으로 저장합니다.');
    const time = new Date().toISOString(), lifecycle = core().sourceState(bundle, sourceId);
    const stage = { kind: 'source-edit', format: FORMAT, stageId: core().id(), workspaceId: bundle.workspaceId, revision: 0, state: 'draft',
      baseSourceId: sourceId, baseSourceRevision: source.revision, baseSourceVersionId: head.id, baseHash: head.contentHash,
      lifecycleRevision: lifecycle.revision, restoreVersionId: options.restore ? selected.id : null,
      input: { title: source.title, text: selected.contentText ?? '', format: selected.format }, createdAt: time, updatedAt: time };
    validateCurrent(bundle, stage); return stage;
  }
  function edit(stage, patch) {
    validate(stage); assert(stage.state === 'draft', 'source_edit_applied'); fields(patch, [], ['title', 'text', 'format']);
    const result = copy(stage); Object.assign(result.input, copy(patch)); result.updatedAt = new Date().toISOString(); validate(result); return result;
  }
  function expected(bundle, stage) {
    const current = validateCurrent(bundle, stage), { source, head, selected } = current;
    const title = stage.input.title.trim() || '제목 없는 자료', contentText = stage.input.text === '' ? null : stage.input.text;
    assert(contentText !== null || !!source.url, 'missing_text', '보관할 본문을 입력해 주세요. 자료 삭제는 휴지통에서 합니다.');
    assert(contentText !== null || selected.contentText === null, 'missing_text', '본문을 비워 자료를 삭제하지 않습니다. 휴지통으로 이동해 주세요.');
    assert(contentText === null || contentText === selected.contentText || contentText.trim().length > 0, 'missing_text', '보관할 본문을 입력해 주세요. 자료 삭제는 휴지통에서 합니다.');
    assert(contentText !== null || stage.input.format === 'text/plain', 'missing_text', '본문 없는 링크의 형식을 Markdown으로 바꾸지 않습니다.');
    const coverage = contentText === selected.contentText ? copy(selected.coverage) : { status: contentText === null ? 'link_only' : 'unknown', omissions: copy(selected.coverage.omissions) };
    const value = { sourceId: source.id, format: contentText === null ? 'text/plain' : stage.input.format, contentText,
      coverage, originalAuthor: copy(selected.originalAuthor), originalCreatedAt: selected.originalCreatedAt };
    const unchanged = stage.restoreVersionId === null && source.title === title && head.format === value.format && head.contentText === value.contentText;
    return { ...current, title, value, unchanged };
  }
  function resultFields(value) { fields(value, ['sourceId', 'sourceVersionId']); identifier(value.sourceId); identifier(value.sourceVersionId); }
  function checkPrepared(bundle, stage, changes, stageResult) {
    const e = expected(bundle, stage); resultFields(stageResult); fields(changes, ['put']);
    if (e.unchanged) {
      fields(changes.put, []); assert(stageResult.sourceId === e.source.id && stageResult.sourceVersionId === e.head.id, 'source_edit_mismatch', '변경 없는 자료의 저장 결과를 확인해 주세요.'); return true;
    }
    fields(changes.put, ['sources', 'sourceVersions', 'links']);
    assert(Array.isArray(changes.put.sources) && changes.put.sources.length === 1 && Array.isArray(changes.put.sourceVersions) && changes.put.sourceVersions.length === 1 && Array.isArray(changes.put.links) && changes.put.links.length === 2, 'source_edit_mismatch');
    const source = changes.put.sources[0], version = changes.put.sourceVersions[0];
    assert(source.id === e.source.id && stageResult.sourceId === source.id && stageResult.sourceVersionId === version.id && !bundle.sourceVersions.some(value => value.id === version.id), 'source_edit_mismatch');
    const projected = { ...e.source, title: e.title, revision: e.source.revision + 1, updatedAt: version.importedAt };
    assert(same(source, projected), 'source_edit_mismatch', '자료 수정에서 원천 주소나 작성 관계를 바꾸지 않았습니다.');
    for (const key of Object.keys(e.value)) assert(same(version[key], e.value[key]), 'source_edit_mismatch', '검토한 수정 입력과 저장할 원문 판이 다릅니다.');
    assert(version.revision === 1 && (version.contentText === null ? version.contentHash === null : /^[a-f0-9]{64}$/.test(version.contentHash)), 'source_edit_mismatch');
    const marker = changes.put.links.find(link => link.kind === 'source_edited_copy'), base = changes.put.links.find(link => link.kind === 'source_edit_base');
    assert(marker && base && same(marker.entityRefs, [{ entityType: 'sourceVersion', entityId: version.id }]) &&
      same(base.entityRefs, [{ entityType: 'sourceVersion', entityId: e.selected.id }, { entityType: 'sourceVersion', entityId: version.id }]), 'source_edit_mismatch', '수정 판의 표식과 기준 판을 확인해 주세요.');
    for (const link of changes.put.links) assert(link.createdAt === version.importedAt && link.updatedAt === version.importedAt && !bundle.links.some(value => value.id === link.id), 'source_edit_mismatch');
    core().applyChanges(bundle, changes); return true;
  }
  async function prepare(bundle, stage) {
    const snapshot = copy(bundle), draft = copy(stage), e = expected(snapshot, draft);
    if (e.unchanged) return { changes: { put: {} }, stageResult: { sourceId: e.source.id, sourceVersionId: e.head.id }, source: copy(e.source), version: copy(e.head), unchanged: true };
    const prepared = await core().prepareImport({ origin: e.source.origin, title: e.title, text: e.value.contentText,
      ...(e.source.url ? { url: e.source.url } : {}), existingSourceId: e.source.id, format: e.value.format,
      author: e.value.originalAuthor.label, authorRelation: e.value.originalAuthor.relation, originalCreatedAt: e.value.originalCreatedAt,
      coverage: e.value.coverage }, snapshot, { forceNewVersion: true });
    // Existing metadata strings may be deliberately untrimmed in a validated backup.
    prepared.version.originalAuthor = copy(e.value.originalAuthor); prepared.version.originalCreatedAt = e.value.originalCreatedAt;
    const changes = core().buildImportChanges(snapshot, prepared), time = prepared.version.importedAt;
    const marker = { id: core().id(), kind: 'source_edited_copy', entityRefs: [{ entityType: 'sourceVersion', entityId: prepared.version.id }], revision: 1, createdAt: time, updatedAt: time };
    const base = { id: core().id(), kind: 'source_edit_base', entityRefs: [{ entityType: 'sourceVersion', entityId: e.selected.id }, { entityType: 'sourceVersion', entityId: prepared.version.id }], revision: 1, createdAt: time, updatedAt: time };
    delete changes.put.records; changes.put.links = [marker, base];
    const stageResult = { sourceId: prepared.source.id, sourceVersionId: prepared.version.id };
    checkPrepared(snapshot, draft, changes, stageResult);
    return { changes, stageResult, source: prepared.source, version: prepared.version, unchanged: false };
  }
  return Object.freeze({ FORMAT, LIMITS, begin, createDraft: begin, edit, validate, validateDraft: validate, validateCurrent, checkPrepared, prepare, prepareSave: prepare });
});

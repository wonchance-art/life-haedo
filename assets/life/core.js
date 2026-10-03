(function (root, factory) {
  'use strict';
  const api = factory(root);
  root.HaedoLife = root.HaedoLife || {};
  root.HaedoLife.Core = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  'use strict';

  const MAX_IMPORT_BYTES = 1024 * 1024;
  const ORIGINS = ['apple_notes', 'obsidian', 'naver_blog', 'instagram', 'other'];
  const FORMATS = ['text/plain', 'text/markdown'];
  const COVERAGE = ['full_text', 'partial', 'link_only', 'unknown'];
  const RELATIONS = ['self', 'other', 'unknown'];
  const COLLECTIONS = ['sources', 'sourceVersions', 'records', 'links', 'resumeHints', 'tombstones'];
  const ENTITY_COLLECTION = { source: 'sources', sourceVersion: 'sourceVersions', record: 'records', link: 'links', resumeHint: 'resumeHints' };
  const now = () => new Date().toISOString();

  function fail(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
  function assert(condition, code, message) { if (!condition) fail(code, message); }
  function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  }
  function fields(value, allowed, label) {
    assert(object(value), 'invalid_structure', label + ' 형식을 확인해 주세요.');
    assert(Object.keys(value).every(key => allowed.includes(key)), 'unsupported_field', label + '에 지원하지 않는 항목이 있습니다.');
  }
  function string(value, max, label, empty) {
    assert(typeof value === 'string' && value.length <= max && (empty || value.length > 0), 'invalid_metadata', label + '을 확인해 주세요.');
  }
  function identifier(value) {
    assert(typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value), 'invalid_id', '자료 식별자가 올바르지 않습니다.');
  }
  function revision(value, min) {
    assert(Number.isSafeInteger(value) && value >= min, 'invalid_revision', '저장 버전이 올바르지 않습니다.');
  }
  function timestamp(value) {
    assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)), 'invalid_timestamp', '저장 시각이 올바르지 않습니다.');
  }
  function cryptoProvider() {
    if (root.crypto && root.crypto.subtle) return root.crypto;
    if (typeof require === 'function') return require('node:crypto').webcrypto;
    fail('crypto_unavailable', '안전한 연결 또는 localhost에서 다시 열어 주세요. 원문 해시를 계산할 수 없습니다.');
  }
  function id() {
    const crypto = cryptoProvider();
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }
  function utf8(text) { return new TextEncoder().encode(text); }
  function validateText(text) {
    assert(typeof text === 'string' && text.length > 0, 'missing_text', '가져올 본문이나 원문 URL을 넣어 주세요.');
    assert(!text.includes('\u0000'), 'invalid_encoding', '텍스트에 읽을 수 없는 문자가 있습니다. UTF-8 텍스트 파일을 사용해 주세요.');
    // TextEncoder replaces isolated surrogates. Reject them instead of changing the original silently.
    for (let i = 0; i < text.length; i++) {
      const unit = text.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = text.charCodeAt(++i);
        assert(next >= 0xdc00 && next <= 0xdfff, 'invalid_encoding', '텍스트의 문자 인코딩을 확인해 주세요.');
      } else assert(unit < 0xdc00 || unit > 0xdfff, 'invalid_encoding', '텍스트의 문자 인코딩을 확인해 주세요.');
    }
    assert(text.length <= MAX_IMPORT_BYTES && utf8(text).length <= MAX_IMPORT_BYTES, 'text_too_large', '본문은 UTF-8 기준 1 MiB까지 가져올 수 있습니다. 파일을 나눠 주세요.');
  }
  async function sha256(text) {
    const digest = await cryptoProvider().subtle.digest('SHA-256', utf8(text));
    return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  }
  function url(value) {
    assert(typeof value === 'string' && value.length <= 8192 && /^https?:\/\//i.test(value) && !/[\s\u0000-\u001f\u007f\\]/.test(value), 'unsafe_url', '원문 주소는 http 또는 https URL만 사용할 수 있습니다.');
    let parsed;
    try { parsed = new URL(value); } catch (_) { fail('unsafe_url', '원문 URL을 확인해 주세요.'); }
    assert(['http:', 'https:'].includes(parsed.protocol) && parsed.hostname && !parsed.username && !parsed.password, 'unsafe_url', '접속 정보가 없는 http 또는 https URL을 사용해 주세요.');
    return value;
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function importSnapshot(input) {
    const path = new Set();
    function check(value) {
      if (value !== null && typeof value === 'object') {
        assert(object(value) || Array.isArray(value), 'invalid_metadata', '가져오기 입력에는 텍스트와 단순 메타데이터만 사용할 수 있습니다.');
        assert(!path.has(value), 'invalid_structure', '가져오기 입력에 순환 참조가 있습니다.');
        path.add(value); Object.values(value).forEach(check); path.delete(value);
      } else assert(value === undefined || value === null || ['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value), 'invalid_metadata', '가져오기 입력의 값을 확인해 주세요.');
    }
    check(input);
    return clone(input);
  }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  function metadata(value, fallback, max, label) {
    if (value === undefined || value === null) return fallback;
    string(value, max, label, true);
    return value.trim();
  }
  function coverage(value, omissions, hasText) {
    let status = value;
    let missing = [];
    if (object(value)) {
      fields(value, ['status', 'omissions'], '확보 범위');
      status = value.status;
      if (value.omissions !== undefined) missing = value.omissions;
    }
    if (status === undefined || status === null || status === '') status = hasText ? 'unknown' : 'link_only';
    assert(COVERAGE.includes(status), 'invalid_coverage', '본문 확보 범위를 확인해 주세요.');
    assert(hasText ? status !== 'link_only' : status === 'link_only', 'invalid_coverage', 'URL만 있는 자료와 본문이 있는 자료의 확보 범위를 구분해 주세요.');
    assert(Array.isArray(missing) && (omissions === undefined || Array.isArray(omissions)), 'invalid_coverage', '누락 항목은 문자열 목록이어야 합니다.');
    const values = missing.concat(omissions || []);
    assert(values.length <= 100, 'invalid_coverage', '누락 항목이 너무 많습니다.');
    values.forEach(item => string(item, 500, '누락 항목', true));
    return { status, omissions: Array.from(new Set(values)) };
  }
  function createWorkspace(options = {}) {
    fields(options, ['workspaceId', 'title'], '작업공간 설정');
    const workspaceId = options.workspaceId || id();
    identifier(workspaceId);
    const title = metadata(options.title, '개인 자료', 500, '작업공간 제목') || '개인 자료';
    const time = now();
    return { schemaVersion: 1, workspaceId, title, revision: 0, createdAt: time, updatedAt: time,
      sources: [], sourceVersions: [], records: [], links: [], resumeHints: [], tombstones: [] };
  }
  function boundary(text, index) {
    if (index === 0 || index === text.length) return true;
    const before = text.charCodeAt(index - 1), after = text.charCodeAt(index);
    return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
  }
  function locator(value, text, quote) {
    fields(value, ['start', 'end'], '발췌 위치');
    assert(Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end) && value.start >= 0 && value.end > value.start && value.end <= text.length && boundary(text, value.start) && boundary(text, value.end), 'invalid_locator', '발췌 위치가 원문 범위와 맞지 않습니다. 원문에서 다시 선택해 주세요.');
    if (quote !== undefined) assert(text.slice(value.start, value.end) === quote, 'quote_mismatch', '발췌 내용이 해당 원문 구간과 일치하지 않습니다.');
  }
  function validateWorkspace(bundle) {
    fields(bundle, ['schemaVersion', 'workspaceId', 'title', 'revision', 'createdAt', 'updatedAt'].concat(COLLECTIONS), '작업공간');
    assert(bundle.schemaVersion === 1, 'unsupported_schema', '지원하지 않는 작업공간 버전입니다.');
    identifier(bundle.workspaceId); string(bundle.title, 500, '작업공간 제목', false); revision(bundle.revision, 0);
    timestamp(bundle.createdAt); timestamp(bundle.updatedAt);
    const maps = {}, ids = new Set([bundle.workspaceId]);
    for (const name of COLLECTIONS) {
      assert(Array.isArray(bundle[name]), 'invalid_collection', '작업공간 목록이 손상되었습니다.');
      maps[name] = new Map();
      for (const item of bundle[name]) {
        assert(object(item), 'invalid_structure', '자료 항목을 확인해 주세요.'); identifier(item.id);
        assert(!ids.has(item.id), 'duplicate_id', '작업공간 안에 중복된 식별자가 있습니다.');
        ids.add(item.id); maps[name].set(item.id, item);
      }
    }
    for (const source of bundle.sources) {
      fields(source, ['id', 'origin', 'title', 'url', 'sourceKey', 'revision', 'createdAt', 'updatedAt'], '원천');
      assert(ORIGINS.includes(source.origin), 'invalid_origin', '원천 종류를 확인해 주세요.');
      string(source.title, 500, '원천 제목', false); revision(source.revision, 1); timestamp(source.createdAt); timestamp(source.updatedAt);
      if (source.url !== undefined) url(source.url);
      if (source.sourceKey !== undefined) string(source.sourceKey, 2000, '원천 경로', false);
    }
    for (const version of bundle.sourceVersions) {
      fields(version, ['id', 'sourceId', 'format', 'contentText', 'contentHash', 'coverage', 'originalAuthor', 'originalCreatedAt', 'importedAt', 'revision'], '원문 버전');
      assert(maps.sources.has(version.sourceId), 'missing_reference', '원문 버전의 원천을 찾을 수 없습니다.');
      assert(FORMATS.includes(version.format), 'unsupported_format', '지원하지 않는 텍스트 형식입니다.');
      revision(version.revision, 1); timestamp(version.importedAt);
      fields(version.originalAuthor, ['label', 'relation'], '원 작성자');
      string(version.originalAuthor.label, 500, '원 작성자', true);
      assert(RELATIONS.includes(version.originalAuthor.relation), 'invalid_author', '작성자와의 관계를 확인해 주세요.');
      assert(version.originalCreatedAt === null || typeof version.originalCreatedAt === 'string', 'invalid_metadata', '원문 작성일을 확인해 주세요.');
      if (typeof version.originalCreatedAt === 'string') string(version.originalCreatedAt, 200, '원문 작성일', false);
      fields(version.coverage, ['status', 'omissions'], '확보 범위');
      assert(Array.isArray(version.coverage.omissions), 'invalid_coverage', '누락 항목을 확인해 주세요.');
      coverage(version.coverage, undefined, version.contentText !== null);
      if (version.contentText === null) {
        assert(version.contentHash === null && !!maps.sources.get(version.sourceId).url, 'invalid_link_only', '링크만인 자료에는 원문 URL과 본문 미확보 표시가 필요합니다.');
      } else {
        validateText(version.contentText);
        assert(typeof version.contentHash === 'string' && /^[a-f0-9]{64}$/.test(version.contentHash), 'invalid_hash', '원문 해시가 올바르지 않습니다.');
      }
    }
    function sourceRefs(refs, quote) {
      assert(Array.isArray(refs), 'invalid_reference', '원문 참조 목록을 확인해 주세요.');
      for (const ref of refs) {
        fields(ref, ['sourceId', 'sourceVersionId', 'locator'], '원문 참조');
        const version = maps.sourceVersions.get(ref.sourceVersionId);
        assert(version && version.sourceId === ref.sourceId, 'missing_reference', '참조한 원문 버전을 찾을 수 없습니다.');
        if (version.contentText === null) assert(ref.locator === null && quote === undefined, 'invalid_locator', '본문 없는 링크에서는 발췌를 만들 수 없습니다.');
        else if (ref.locator !== null || quote !== undefined) locator(ref.locator, version.contentText, quote);
      }
    }
    for (const record of bundle.records) {
      fields(record, ['id', 'kind', 'text', 'topic', 'note', 'sourceRefs', 'provenance', 'revision', 'createdAt', 'updatedAt'], '발췌');
      assert(record.kind === 'excerpt', 'unsupported_record', '현재는 원문 발췌만 지원합니다.');
      string(record.text, MAX_IMPORT_BYTES, '발췌 내용', false); string(record.topic, 500, '주제', true); string(record.note, MAX_IMPORT_BYTES, '보완 메모', true);
      fields(record.provenance, ['kind'], '발췌 기원');
      assert(record.provenance.kind === 'user', 'invalid_provenance', '사용자가 선택한 발췌의 기원을 확인해 주세요.');
      revision(record.revision, 1); timestamp(record.createdAt); timestamp(record.updatedAt);
      assert(Array.isArray(record.sourceRefs) && record.sourceRefs.length > 0, 'missing_reference', '발췌의 원문 참조가 필요합니다.');
      sourceRefs(record.sourceRefs, record.text);
    }
    function entityRefs(refs) {
      assert(Array.isArray(refs), 'invalid_reference', '연결 참조를 확인해 주세요.');
      for (const ref of refs) {
        fields(ref, ['entityType', 'entityId', 'revision'], '연결 참조');
        assert(Object.prototype.hasOwnProperty.call(ENTITY_COLLECTION, ref.entityType) && maps[ENTITY_COLLECTION[ref.entityType]].has(ref.entityId), 'missing_reference', '연결한 항목을 찾을 수 없습니다.');
        if (ref.revision !== undefined) revision(ref.revision, 1);
      }
    }
    for (const link of bundle.links) {
      fields(link, ['id', 'kind', 'note', 'sourceRefs', 'entityRefs', 'revision', 'createdAt', 'updatedAt'], '연결');
      assert(Array.isArray(link.entityRefs) && link.entityRefs.length > 0 || Array.isArray(link.sourceRefs) && link.sourceRefs.length > 0, 'missing_reference', '연결의 원문 또는 항목 참조가 필요합니다.');
      if (link.sourceRefs !== undefined) sourceRefs(link.sourceRefs);
      if (link.entityRefs !== undefined) entityRefs(link.entityRefs);
      if (link.revision !== undefined) revision(link.revision, 1);
      if (link.kind !== undefined) string(link.kind, 100, '연결 종류', false);
      if (link.note !== undefined) string(link.note, MAX_IMPORT_BYTES, '연결 메모', true);
      if (link.createdAt !== undefined) timestamp(link.createdAt);
      if (link.updatedAt !== undefined) timestamp(link.updatedAt);
    }
    for (const hint of bundle.resumeHints) {
      fields(hint, ['id', 'sourceId', 'sourceVersionId', 'recordId', 'locator', 'note', 'revision', 'createdAt', 'updatedAt'], '재개 정보');
      assert(hint.sourceId !== undefined || hint.sourceVersionId !== undefined || hint.recordId !== undefined, 'missing_reference', '재개할 자료 참조가 필요합니다.');
      if (hint.sourceId !== undefined) assert(maps.sources.has(hint.sourceId), 'missing_reference', '재개할 원천이 없습니다.');
      if (hint.sourceVersionId !== undefined) {
        const version = maps.sourceVersions.get(hint.sourceVersionId);
        assert(version && (hint.sourceId === undefined || version.sourceId === hint.sourceId), 'missing_reference', '재개할 원문 버전이 없습니다.');
        if (hint.locator !== undefined && hint.locator !== null) { assert(version.contentText !== null, 'invalid_locator', '링크에는 본문 위치가 없습니다.'); locator(hint.locator, version.contentText); }
      } else assert(hint.locator === undefined || hint.locator === null, 'invalid_locator', '재개 위치에 원문 버전이 필요합니다.');
      if (hint.recordId !== undefined) assert(maps.records.has(hint.recordId), 'missing_reference', '재개할 발췌가 없습니다.');
      if (hint.note !== undefined) string(hint.note, MAX_IMPORT_BYTES, '재개 메모', true);
      if (hint.revision !== undefined) revision(hint.revision, 1);
      if (hint.createdAt !== undefined) timestamp(hint.createdAt);
      if (hint.updatedAt !== undefined) timestamp(hint.updatedAt);
    }
    const deletedRecords = new Set();
    for (const tombstone of bundle.tombstones) {
      fields(tombstone, ['id', 'entityType', 'entityId', 'deletedAt', 'revision'], '삭제 표식');
      identifier(tombstone.entityId); timestamp(tombstone.deletedAt);
      assert(tombstone.entityType === 'record' && !ids.has(tombstone.entityId) && !deletedRecords.has(tombstone.entityId), 'invalid_tombstone', '발췌 삭제 표식을 확인해 주세요.');
      deletedRecords.add(tombstone.entityId);
      if (tombstone.revision !== undefined) revision(tombstone.revision, 1);
    }
    return true;
  }
  function versionIdentity(version) {
    return canonical({ format: version.format, contentText: version.contentText, contentHash: version.contentHash,
      coverage: version.coverage, originalAuthor: version.originalAuthor, originalCreatedAt: version.originalCreatedAt });
  }
  async function prepareImport(input, bundle) {
    validateWorkspace(bundle);
    fields(input, ['origin', 'title', 'text', 'url', 'fileName', 'format', 'author', 'authorRelation', 'originalCreatedAt', 'coverage', 'omissions', 'existingSourceId', 'forceSeparate'], '가져오기 입력');
    input = importSnapshot(input);
    const origin = input.origin || 'other';
    assert(ORIGINS.includes(origin), 'invalid_origin', '원천 종류를 선택해 주세요.');
    let format = input.format;
    if (input.fileName !== undefined && input.fileName !== '') {
      string(input.fileName, 2000, '파일명', false);
      assert(/\.(txt|md)$/i.test(input.fileName), 'unsupported_format', 'UTF-8 .txt 또는 .md 파일을 선택해 주세요.');
      if (!format) format = /\.md$/i.test(input.fileName) ? 'text/markdown' : 'text/plain';
    }
    const aliases = { text: 'text/plain', plain_text: 'text/plain', txt: 'text/plain', markdown: 'text/markdown', md: 'text/markdown', link: 'text/plain', url_only: 'text/plain' };
    format = aliases[format] || format || 'text/plain';
    assert(FORMATS.includes(format), 'unsupported_format', '일반 텍스트 또는 Markdown만 지원합니다.');
    assert(input.text === undefined || input.text === null || typeof input.text === 'string', 'invalid_text', '본문은 텍스트여야 합니다.');
    const contentText = input.text === undefined || input.text === null || input.text === '' ? null : input.text;
    if (contentText !== null) validateText(contentText);
    const inputUrl = metadata(input.url, '', 8192, '원문 URL') || undefined;
    if (inputUrl !== undefined) url(inputUrl);
    assert(contentText !== null || inputUrl !== undefined, 'missing_text', '가져올 본문이나 원문 URL을 넣어 주세요.');
    const title = metadata(input.title, '', 500, '원천 제목') || metadata(input.fileName, '', 2000, '파일명').slice(0, 500) || (inputUrl || '').slice(0, 500) || '제목 없는 자료';
    const originalAuthor = { label: metadata(input.author, '', 500, '원 작성자'), relation: input.authorRelation || 'unknown' };
    assert(RELATIONS.includes(originalAuthor.relation), 'invalid_author', '작성자와의 관계를 확인해 주세요.');
    const originalCreatedAt = metadata(input.originalCreatedAt, '', 200, '원문 작성일') || null;
    const time = now();
    const source = { id: id(), origin, title, revision: 1, createdAt: time, updatedAt: time };
    if (inputUrl !== undefined) source.url = inputUrl;
    if (input.fileName) source.sourceKey = input.fileName;
    const version = { id: id(), sourceId: source.id, format: contentText === null ? 'text/plain' : format, contentText, contentHash: contentText === null ? null : await sha256(contentText),
      coverage: coverage(input.coverage, input.omissions, contentText !== null), originalAuthor, originalCreatedAt, importedAt: time, revision: 1 };
    assert(input.forceSeparate === undefined || typeof input.forceSeparate === 'boolean', 'invalid_metadata', '별개 보관 선택을 확인해 주세요.');
    assert(!(input.forceSeparate && input.existingSourceId), 'source_identity_mismatch', '기존 원천 연결과 별개 보관을 함께 선택할 수 없습니다.');
    if (input.existingSourceId) {
      const existing = bundle.sources.find(item => item.id === input.existingSourceId);
      assert(existing, 'missing_reference', '선택한 기존 원천을 찾을 수 없습니다.');
      assert(existing.origin === origin && (inputUrl === undefined || existing.url === inputUrl) && (!source.sourceKey || !existing.sourceKey || source.sourceKey === existing.sourceKey), 'source_identity_mismatch', '원천 주소·종류가 달라졌습니다. 별개 자료로 보관해 주세요.');
      const old = bundle.sourceVersions.filter(item => item.sourceId === existing.id).find(item => versionIdentity(item) === versionIdentity(version));
      const sourceChanged = existing.title !== title || !!source.sourceKey && source.sourceKey !== existing.sourceKey;
      if (old && !sourceChanged) return { source: clone(existing), version: clone(old), match: { kind: 'exact_duplicate', sourceId: existing.id, sourceVersionId: old.id } };
      const adopted = clone(existing);
      adopted.title = title; adopted.revision += 1; adopted.updatedAt = time;
      if (!adopted.sourceKey && source.sourceKey) adopted.sourceKey = source.sourceKey;
      version.sourceId = existing.id;
      return { source: adopted, version, match: { kind: 'new_revision', sourceId: existing.id, sourceVersionId: old ? old.id : undefined } };
    }
    let candidate;
    if (!input.forceSeparate) candidate = bundle.sourceVersions.find(item => {
      const parent = bundle.sources.find(entry => entry.id === item.sourceId);
      return contentText !== null && item.contentHash === version.contentHash || inputUrl !== undefined && parent.url === inputUrl || source.sourceKey && parent.origin === origin && parent.sourceKey === source.sourceKey;
    });
    return { source, version, match: candidate ? { kind: 'overlap', sourceId: candidate.sourceId, sourceVersionId: candidate.id } : { kind: 'new' } };
  }
  function buildImportChanges(bundle, prepared, excerpts = []) {
    validateWorkspace(bundle);
    fields(prepared, ['source', 'version', 'match'], '검토한 가져오기');
    assert(Array.isArray(excerpts), 'invalid_excerpts', '발췌 목록을 확인해 주세요.');
    assert(prepared.version && prepared.source && prepared.version.sourceId === prepared.source.id, 'missing_reference', '검토한 원천과 버전이 맞지 않습니다.');
    const put = { sources: [], sourceVersions: [], records: [] };
    const oldSource = bundle.sources.find(item => item.id === prepared.source.id);
    const oldVersion = bundle.sourceVersions.find(item => item.id === prepared.version.id);
    if (!oldSource || canonical(oldSource) !== canonical(prepared.source)) put.sources.push(clone(prepared.source));
    if (!oldVersion) put.sourceVersions.push(clone(prepared.version));
    else assert(canonical(oldVersion) === canonical(prepared.version), 'immutable_source_version', '보관한 원문 버전은 덮어쓸 수 없습니다.');
    const seen = new Map();
    for (const record of bundle.records) for (const ref of record.sourceRefs) {
      seen.set(canonical([ref.sourceId, ref.sourceVersionId, ref.locator.start, ref.locator.end, record.topic]), record);
    }
    const time = now();
    for (const excerpt of excerpts) {
      fields(excerpt, ['start', 'end', 'topic', 'note'], '발췌 선택');
      assert(prepared.version.contentText !== null, 'invalid_locator', '링크만 있는 자료에서는 본문을 발췌할 수 없습니다.');
      const location = { start: excerpt.start, end: excerpt.end };
      locator(location, prepared.version.contentText);
      const topic = metadata(excerpt.topic, '', 500, '주제');
      const note = excerpt.note === undefined ? '' : excerpt.note;
      string(note, MAX_IMPORT_BYTES, '보완 메모', true);
      const key = canonical([prepared.source.id, prepared.version.id, location.start, location.end, topic]);
      if (seen.has(key)) {
        assert(seen.get(key).note === note, 'duplicate_excerpt', '같은 구절과 주제가 이미 있습니다. 기존 메모를 확인하거나 다른 주제를 선택해 주세요.');
        continue;
      }
      const record = { id: id(), kind: 'excerpt', text: prepared.version.contentText.slice(location.start, location.end), topic, note,
        sourceRefs: [{ sourceId: prepared.source.id, sourceVersionId: prepared.version.id, locator: location }], provenance: { kind: 'user' }, revision: 1, createdAt: time, updatedAt: time };
      seen.set(key, record); put.records.push(record);
    }
    const changes = { put };
    // Validate the full prospective graph before storage opens its transaction.
    applyChanges(bundle, changes);
    return changes;
  }
  function applyChanges(bundle, changes) {
    validateWorkspace(bundle);
    fields(changes, ['put', 'remove'], '저장 변경');
    const put = changes.put || {}, remove = changes.remove || {};
    fields(put, ['sources', 'sourceVersions', 'records', 'links', 'resumeHints'], '저장 항목');
    fields(remove, ['records'], '삭제 항목');
    const result = clone(bundle), time = now();
    for (const name of Object.keys(put)) {
      assert(Array.isArray(put[name]), 'invalid_collection', '저장 항목 목록을 확인해 주세요.');
      const submitted = new Set();
      for (const value of put[name]) {
        assert(object(value), 'invalid_structure', '저장할 자료 형식을 확인해 주세요.'); identifier(value.id);
        assert(!submitted.has(value.id), 'duplicate_id', '한 저장 요청에 같은 항목이 두 번 있습니다.'); submitted.add(value.id);
        const index = result[name].findIndex(item => item.id === value.id);
        if (index >= 0 && name === 'sourceVersions') assert(canonical(result[name][index]) === canonical(value), 'immutable_source_version', '보관한 원문 버전은 수정할 수 없습니다. 새 버전을 추가해 주세요.');
        if (index >= 0 && canonical(result[name][index]) !== canonical(value)) {
          if (result[name][index].revision !== undefined) assert(value.revision === result[name][index].revision + 1, 'invalid_revision', '수정 항목의 버전을 확인해 주세요.');
          if (name === 'sources') assert(value.origin === result[name][index].origin && value.url === result[name][index].url && (!result[name][index].sourceKey || value.sourceKey === result[name][index].sourceKey), 'source_identity_mismatch', '원천 주소나 종류는 별개 자료로 보관해 주세요.');
          if (value.createdAt !== undefined) assert(value.createdAt === result[name][index].createdAt, 'immutable_creation', '원래 저장 시각은 변경할 수 없습니다.');
        }
        if (index >= 0) result[name][index] = clone(value); else result[name].push(clone(value));
      }
    }
    const removed = remove.records || [];
    assert(Array.isArray(removed), 'invalid_collection', '삭제할 발췌 목록을 확인해 주세요.');
    for (const recordId of new Set(removed)) {
      identifier(recordId);
      assert(!(put.records || []).some(item => item.id === recordId), 'conflicting_changes', '같은 발췌를 동시에 저장하고 삭제할 수 없습니다.');
      if (result.records.some(item => item.id === recordId)) {
        result.records = result.records.filter(item => item.id !== recordId);
        result.links = result.links.filter(item => !(item.entityRefs || []).some(ref => ref.entityType === 'record' && ref.entityId === recordId));
        result.resumeHints = result.resumeHints.filter(item => item.recordId !== recordId);
        result.tombstones.push({ id: id(), entityType: 'record', entityId: recordId, deletedAt: time });
      }
    }
    const dead = new Set(result.tombstones.map(item => item.entityId));
    assert(result.records.every(item => !dead.has(item.id)), 'deleted_record', '삭제한 발췌를 같은 식별자로 되살릴 수 없습니다. 새 발췌로 보관해 주세요.');
    result.revision += 1; result.updatedAt = time;
    validateWorkspace(result);
    return result;
  }
  function manifest(bundle) {
    const counts = {};
    COLLECTIONS.forEach(name => { counts[name] = bundle[name].length; });
    return { counts, stagingIncluded: false, hashAlgorithm: 'SHA-256', sourceVersions: bundle.sourceVersions.map(version => ({ id: version.id, sourceId: version.sourceId, contentHash: version.contentHash, utf8Bytes: version.contentText === null ? 0 : utf8(version.contentText).length })) };
  }
  function makeBackup(bundle) {
    validateWorkspace(bundle);
    return { format: 'life-tools-backup-v1', schemaVersion: 1, exportedAt: now(), workspace: clone(bundle), manifest: manifest(bundle) };
  }
  async function restoreBackup(input) {
    let data = input;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (_) { fail('invalid_backup', '백업 JSON을 읽을 수 없습니다. 원본 파일은 그대로 보관해 주세요.'); }
    }
    fields(data, ['format', 'schemaVersion', 'exportedAt', 'workspace', 'manifest'], '백업');
    assert(data.format === 'life-tools-backup-v1' && data.schemaVersion === 1, 'unsupported_backup', '생활 도구 v1 JSON 백업을 선택해 주세요. 읽기용 Markdown은 복원할 수 없습니다.');
    timestamp(data.exportedAt); validateWorkspace(data.workspace);
    assert(canonical(data.manifest) === canonical(manifest(data.workspace)), 'manifest_mismatch', '백업의 목록·개수·해시 정보가 맞지 않습니다. 원본 파일을 확인해 주세요.');
    // Own the verified snapshot throughout async hashing, even if a caller edits its input later.
    const result = clone(data.workspace);
    for (const version of result.sourceVersions) if (version.contentText !== null) {
      assert(await sha256(version.contentText) === version.contentHash, 'hash_mismatch', '백업 원문과 해시가 일치하지 않습니다. 이 파일은 복원하지 않았습니다.');
    }
    const mapping = new Map([[result.workspaceId, id()]]);
    for (const name of COLLECTIONS) for (const item of result[name]) mapping.set(item.id, id());
    for (const item of result.tombstones) if (!mapping.has(item.entityId)) mapping.set(item.entityId, id());
    const remap = value => {
      assert(mapping.has(value), 'missing_reference', '백업의 내부 참조를 복원할 수 없습니다.');
      return mapping.get(value);
    };
    result.workspaceId = remap(result.workspaceId); result.revision = 0; result.createdAt = now(); result.updatedAt = result.createdAt;
    for (const name of COLLECTIONS) for (const item of result[name]) {
      item.id = remap(item.id);
      if (item.sourceId !== undefined) item.sourceId = remap(item.sourceId);
      if (item.sourceVersionId !== undefined) item.sourceVersionId = remap(item.sourceVersionId);
      if (item.recordId !== undefined) item.recordId = remap(item.recordId);
      if (item.entityId !== undefined) item.entityId = remap(item.entityId);
      if (item.revision !== undefined) item.revision = 1;
      if (item.sourceRefs) for (const ref of item.sourceRefs) { ref.sourceId = remap(ref.sourceId); ref.sourceVersionId = remap(ref.sourceVersionId); }
      if (item.entityRefs) for (const ref of item.entityRefs) { ref.entityId = remap(ref.entityId); if (ref.revision !== undefined) ref.revision = 1; }
    }
    validateWorkspace(result);
    return result;
  }
  function fenced(text) {
    const longest = (text.match(/`+/g) || []).reduce((max, value) => Math.max(max, value.length), 2);
    const fence = '`'.repeat(longest + 1);
    return fence + 'text\n' + text + (text.endsWith('\n') ? '' : '\n') + fence + '\n';
  }
  function toMarkdown(bundle) {
    validateWorkspace(bundle);
    const output = ['# 생활 도구 읽기 내보내기\n', '이 파일은 읽기용입니다. 복원은 JSON 백업을 사용하세요. 미적용 검토 초안은 포함하지 않습니다.\n', fenced(bundle.title)];
    const versions = new Map(bundle.sourceVersions.map(item => [item.id, item]));
    const sources = new Map(bundle.sources.map(item => [item.id, item]));
    output.push('## 원천과 원문\n');
    for (const source of bundle.sources) {
      output.push('### 원천\n', fenced('제목: ' + source.title + '\n원천: ' + source.origin + '\n원천 ID: ' + source.id + '\nURL: ' + (source.url || '미제공') + '\n경로: ' + (source.sourceKey || '미제공')));
      for (const version of bundle.sourceVersions.filter(item => item.sourceId === source.id)) {
        output.push('#### 보관한 원문 버전\n', fenced('버전 ID: ' + version.id + '\n형식: ' + version.format + '\n확보 범위: ' + version.coverage.status + '\n누락: ' + (version.coverage.omissions.join(', ') || '확인한 누락 없음') + '\n작성자: ' + (version.originalAuthor.label || '미확인') + ' (' + version.originalAuthor.relation + ')\n원문 작성일: ' + (version.originalCreatedAt || '미확인') + '\n가져온 시각: ' + version.importedAt + '\nSHA-256: ' + (version.contentHash || '본문 미확보')));
        output.push(version.contentText === null ? '본문 미확보: URL과 제공된 메타데이터만 보관했습니다.\n' : fenced(version.contentText));
      }
    }
    output.push('## 발췌와 주제 모음\n');
    for (const record of bundle.records) {
      output.push('### 발췌\n', fenced('주제: ' + (record.topic || '미분류') + '\n발췌 ID: ' + record.id + '\n기원: 사용자 선택'), fenced(record.text));
      for (const ref of record.sourceRefs) {
        const source = sources.get(ref.sourceId), version = versions.get(ref.sourceVersionId);
        output.push(fenced('출처: ' + source.title + '\n원천 ID: ' + source.id + '\n버전 ID: ' + version.id + '\nURL: ' + (source.url || '미제공') + '\n원문 위치: UTF-16 [' + ref.locator.start + ', ' + ref.locator.end + ')\n확보 범위: ' + version.coverage.status));
      }
      if (record.note) output.push('보완 메모:\n', fenced(record.note));
    }
    return output.join('\n');
  }

  return Object.freeze({ MAX_IMPORT_BYTES, createWorkspace, id, validateWorkspace, prepareImport, buildImportChanges, applyChanges, makeBackup, restoreBackup, toMarkdown });
});

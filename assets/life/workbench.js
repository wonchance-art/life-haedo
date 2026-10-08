/* Local composition only. Fixed source-version references; no network or publication. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  root.HaedoLife ||= {};
  root.HaedoLife.Workbench = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';

  const LIMITS = Object.freeze({ groups: 100, groupVersions: 1000, entries: 200, parts: 100,
    reflectionVersions: 1000, excludedPairs: 1000, books: 20, bookChapters: 100, chapterVersions: 1000,
    chapterInsights: 100, insightVersions: 100, bookEditions: 10, title: 500, text: 20000, bytes: 2 * 1024 * 1024 });
  const clone = value => JSON.parse(JSON.stringify(value));
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  function fail(code, message) { throw Object.assign(new Error(message), { code }); }
  function assert(value, code, message) { if (!value) fail(code, message); }
  function fields(value, names, optional = []) {
    assert(plain(value) && Reflect.ownKeys(value).every(key => names.includes(key) || optional.includes(key)) && names.every(key => Object.hasOwn(value, key)),
      'invalid_workbench', '구성 정보의 항목과 형식을 확인해 주세요. 원본은 변경하지 않았습니다.');
  }
  function identifier(value) {
    assert(typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value), 'invalid_id', '구성 또는 원문 식별자를 확인해 주세요.');
  }
  function text(value, max, empty = true) {
    assert(typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0),
      'invalid_workbench', '제목과 메모의 길이 또는 형식을 확인해 주세요.');
    assert(!value.includes('\u0000'), 'invalid_encoding', '구성 텍스트에 읽을 수 없는 문자가 있습니다.');
    for (let index = 0; index < value.length; index++) {
      const unit = value.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(++index);
        assert(next >= 0xdc00 && next <= 0xdfff, 'invalid_encoding', '구성 텍스트의 문자 인코딩을 확인해 주세요.');
      } else assert(unit < 0xdc00 || unit > 0xdfff, 'invalid_encoding', '구성 텍스트의 문자 인코딩을 확인해 주세요.');
    }
  }
  function list(value, max) {
    assert(Array.isArray(value) && value.length <= max && Reflect.ownKeys(value).every(key => key === 'length' ||
      typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length),
    'invalid_workbench', '구성 목록의 형식 또는 최대 개수를 확인해 주세요.');
  }
  function unique(value, seen) {
    identifier(value);
    assert(!seen.has(value), 'duplicate_id', '같은 구성 또는 원문이 목록에 두 번 있습니다.');
    seen.add(value);
  }
  function versionList(value, max) {
    list(value, max);
    const seen = new Set();
    for (const id of value) unique(id, seen);
  }
  function bool(value) { assert(typeof value === 'boolean', 'invalid_workbench', '구성의 표시 설정은 켜기 또는 끄기로 지정해 주세요.'); }
  function year(value) {
    assert(value === '' || typeof value === 'string' && /^[0-9]{4}$/.test(value) && Number(value) > 0,
      'invalid_workbench', '책의 기간은 빈 값 또는 네 자리 연도로 입력해 주세요.');
  }
  function bookMetadata(value) {
    text(value.title, LIMITS.title, false); text(value.question, LIMITS.text);
    year(value.fromYear); year(value.toYear);
    assert(!value.fromYear || !value.toYear || Number(value.fromYear) <= Number(value.toYear),
      'invalid_workbench', '책의 시작 연도는 끝 연도보다 늦을 수 없습니다.');
  }
  function chapters(value, ids) {
    list(value, LIMITS.bookChapters);
    for (const chapter of value) {
      fields(chapter, ['id', 'title', 'note', 'versionIds'], ['insights', 'archived']);
      unique(chapter.id, ids); text(chapter.title, LIMITS.title, false); text(chapter.note, LIMITS.text);
      versionList(chapter.versionIds, LIMITS.chapterVersions);
      if (Object.hasOwn(chapter, 'archived')) bool(chapter.archived);
      if (Object.hasOwn(chapter, 'insights')) {
        list(chapter.insights, LIMITS.chapterInsights);
        for (const insight of chapter.insights) {
          fields(insight, ['id', 'statement', 'uncertainty', 'supportVersionIds', 'counterVersionIds', 'excluded']);
          unique(insight.id, ids); text(insight.statement, LIMITS.text); text(insight.uncertainty, LIMITS.text);
          versionList(insight.supportVersionIds, LIMITS.insightVersions);
          versionList(insight.counterVersionIds, LIMITS.insightVersions); bool(insight.excluded);
        }
      }
    }
  }
  function allChapters(book) { return book.chapters.concat((book.editions || []).flatMap(edition => edition.chapters)); }
  function core() {
    const value = root.HaedoLife?.Core || (typeof require === 'function' ? require('./core.js') : null);
    assert(value?.validateWorkspace && value?.makeBackup && value?.restoreBackup && value?.id,
      'dependency_unavailable', '자료 모듈을 불러오지 못했습니다.');
    return value;
  }
  function empty(workspaceId) {
    identifier(workspaceId);
    return { format: 'life-workbench-v1', workspaceId, revision: 0, groups: [],
      page: { title: '내 페이지', intro: '', showIntro: true, showRecent: true, entries: [] },
      reflection: { versionIds: [], note: '' } };
  }
  function validate(state) {
    fields(state, ['format', 'workspaceId', 'revision', 'groups', 'page', 'reflection'], ['discovery', 'books']);
    assert(state.format === 'life-workbench-v1', 'unsupported_workbench', '지원하는 구성 파일 형식이 아닙니다.');
    identifier(state.workspaceId);
    assert(Number.isSafeInteger(state.revision) && state.revision >= 0, 'invalid_revision', '구성 저장 버전을 확인해 주세요.');
    list(state.groups, LIMITS.groups);
    const ids = new Set();
    for (const group of state.groups) {
      fields(group, ['id', 'title', 'versionIds']); unique(group.id, ids); text(group.title, LIMITS.title, false);
      versionList(group.versionIds, LIMITS.groupVersions);
    }
    fields(state.page, ['title', 'intro', 'showIntro', 'showRecent', 'entries']);
    text(state.page.title, LIMITS.title, false); text(state.page.intro, LIMITS.text);
    bool(state.page.showIntro); bool(state.page.showRecent); list(state.page.entries, LIMITS.entries);
    for (const entry of state.page.entries) {
      fields(entry, ['id', 'title', 'parts', 'note', 'pinned', 'enabled', 'showBody', 'showNote']);
      unique(entry.id, ids); text(entry.title, LIMITS.title, false); text(entry.note, LIMITS.text);
      for (const field of ['pinned', 'enabled', 'showBody', 'showNote']) bool(entry[field]);
      list(entry.parts, LIMITS.parts);
      const versions = new Set();
      for (const part of entry.parts) { fields(part, ['versionId', 'enabled']); unique(part.versionId, versions); bool(part.enabled); }
    }
    fields(state.reflection, ['versionIds', 'note']);
    versionList(state.reflection.versionIds, LIMITS.reflectionVersions); text(state.reflection.note, LIMITS.text);
    if (Object.hasOwn(state, 'books')) {
      list(state.books, LIMITS.books);
      for (const book of state.books) {
        fields(book, ['id', 'title', 'fromYear', 'toYear', 'question', 'chapters'], ['archived', 'editions']);
        unique(book.id, ids); bookMetadata(book); chapters(book.chapters, ids);
        if (Object.hasOwn(book, 'archived')) bool(book.archived);
        if (Object.hasOwn(book, 'editions')) {
          list(book.editions, LIMITS.bookEditions);
          for (const edition of book.editions) {
            fields(edition, ['id', 'label', 'createdAt', 'title', 'fromYear', 'toYear', 'question', 'chapters']);
            unique(edition.id, ids); text(edition.label, LIMITS.title, false); bookMetadata(edition);
            const time = typeof edition.createdAt === 'string' ? Date.parse(edition.createdAt) : NaN;
            assert(typeof edition.createdAt === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(edition.createdAt) &&
              Number(edition.createdAt.slice(0, 4)) > 0 && Number.isFinite(time) && new Date(time).toISOString() === edition.createdAt,
            'invalid_workbench', '개정본 저장 시각을 확인해 주세요.');
            chapters(edition.chapters, ids);
          }
        }
      }
    }
    if (Object.hasOwn(state, 'discovery')) {
      fields(state.discovery, ['excludedPairs']); list(state.discovery.excludedPairs, LIMITS.excludedPairs);
      const excluded = new Set();
      for (const pair of state.discovery.excludedPairs) {
        fields(pair, ['seedSourceId', 'candidateSourceId']);
        identifier(pair.seedSourceId); identifier(pair.candidateSourceId);
        assert(pair.seedSourceId !== pair.candidateSourceId, 'invalid_workbench', '같은 자료를 재발견 제외 대상으로 연결할 수 없습니다.');
        const key = JSON.stringify([pair.seedSourceId, pair.candidateSourceId]);
        assert(!excluded.has(key), 'duplicate_id', '같은 재발견 제외 조합이 두 번 있습니다.');
        excluded.add(key);
      }
    }
    assert(new TextEncoder().encode(JSON.stringify(state)).length <= LIMITS.bytes,
      'workbench_too_large', '묶음·페이지·회고·책 구성은 합계 2 MiB까지 보관할 수 있습니다.');
    // Missing versions remain explicit references. Reading never substitutes a newer version.
    return true;
  }
  function pair(bundle, state) {
    core().validateWorkspace(bundle); validate(state);
    assert(bundle.workspaceId === state.workspaceId, 'workspace_mismatch', '자료와 구성의 작업공간이 다릅니다.');
  }
  function makeBackup(bundle, state) {
    pair(bundle, state);
    return { format: 'life-workbench-backup-v1', exportedAt: new Date().toISOString(),
      sourceBackup: core().makeBackup(bundle), workbench: clone(state) };
  }
  async function restoreBackup(input) {
    let data = input;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (_) { fail('invalid_backup', '통합 구성 백업 JSON을 읽을 수 없습니다.'); }
    }
    fields(data, ['format', 'exportedAt', 'sourceBackup', 'workbench']);
    assert(data.format === 'life-workbench-backup-v1', 'unsupported_backup', '통합 구성 JSON 백업을 선택해 주세요.');
    assert(typeof data.exportedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(data.exportedAt) && Number.isFinite(Date.parse(data.exportedAt)),
      'invalid_backup', '통합 구성 백업의 저장 시각을 확인해 주세요.');
    pair(data.sourceBackup?.workspace, data.workbench);
    // Own both halves before asynchronous source hashing can yield to the caller.
    let snapshot;
    try { snapshot = structuredClone(data); } catch (_) { fail('invalid_backup', '통합 구성 백업에는 JSON 자료만 넣을 수 있습니다.'); }
    const original = snapshot.sourceBackup.workspace;
    const bundle = await core().restoreBackup(snapshot.sourceBackup), workbench = snapshot.workbench;
    const versions = new Map(original.sourceVersions.map((version, index) => [version.id, bundle.sourceVersions[index].id]));
    const sources = new Map(original.sources.map((source, index) => [source.id, bundle.sources[index].id]));
    const used = new Set([original.workspaceId, bundle.workspaceId]);
    for (const value of [original, bundle]) for (const key of ['sources', 'sourceVersions', 'records', 'links', 'resumeHints', 'tombstones'])
      for (const item of value[key]) { used.add(item.id); if (item.entityId) used.add(item.entityId); }
    const referenced = workbench.groups.flatMap(group => group.versionIds).concat(
      workbench.page.entries.flatMap(entry => entry.parts.map(part => part.versionId)), workbench.reflection.versionIds,
      (workbench.books || []).flatMap(book => allChapters(book).flatMap(chapter => chapter.versionIds.concat(
        (chapter.insights || []).flatMap(insight => insight.supportVersionIds.concat(insight.counterVersionIds))))));
    const excludedPairs = workbench.discovery?.excludedPairs || [];
    const sourceReferences = excludedPairs.flatMap(pair => [pair.seedSourceId, pair.candidateSourceId]);
    for (const value of referenced.concat(sourceReferences)) used.add(value);
    for (const item of workbench.groups.concat(workbench.page.entries)) used.add(item.id);
    for (const book of workbench.books || []) {
      used.add(book.id);
      for (const edition of book.editions || []) used.add(edition.id);
      for (const chapter of allChapters(book)) { used.add(chapter.id); for (const insight of chapter.insights || []) used.add(insight.id); }
    }
    const freshId = () => {
      for (let attempt = 0; attempt < 1024; attempt++) { const value = core().id(); if (!used.has(value)) { used.add(value); return value; } }
      fail('id_collision', '사본 식별자를 만들지 못했습니다. 다시 시도해 주세요.');
    };
    // A missing reference gets one fresh, deliberately absent ID everywhere it is used.
    // This preserves the gap without accidentally connecting it to an unrelated new original.
    for (const value of referenced) if (!versions.has(value)) versions.set(value, freshId());
    for (const value of sourceReferences) if (!sources.has(value)) sources.set(value, freshId());
    workbench.workspaceId = bundle.workspaceId; workbench.revision = 0;
    for (const group of workbench.groups) { group.id = freshId(); group.versionIds = group.versionIds.map(value => versions.get(value)); }
    for (const entry of workbench.page.entries) {
      entry.id = freshId();
      for (const part of entry.parts) part.versionId = versions.get(part.versionId);
    }
    workbench.reflection.versionIds = workbench.reflection.versionIds.map(value => versions.get(value));
    for (const book of workbench.books || []) {
      book.id = freshId();
      for (const edition of book.editions || []) edition.id = freshId();
      for (const chapter of allChapters(book)) {
        chapter.id = freshId(); chapter.versionIds = chapter.versionIds.map(value => versions.get(value));
        for (const insight of chapter.insights || []) {
          insight.id = freshId();
          insight.supportVersionIds = insight.supportVersionIds.map(value => versions.get(value));
          insight.counterVersionIds = insight.counterVersionIds.map(value => versions.get(value));
        }
      }
    }
    for (const pair of excludedPairs) {
      pair.seedSourceId = sources.get(pair.seedSourceId);
      pair.candidateSourceId = sources.get(pair.candidateSourceId);
    }
    pair(bundle, workbench);
    return { bundle, workbench };
  }
  return Object.freeze({ LIMITS, empty, validate, makeBackup, restoreBackup });
});

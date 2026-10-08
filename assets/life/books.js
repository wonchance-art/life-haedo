/* Private book manuscripts. Chapter order and exact references are explicit selections. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  root.HaedoLife ||= {}; root.HaedoLife.Books = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const fault = (code, message) => Object.assign(new Error(message), { code });
  function dependency(name, path, method) {
    const value = root.HaedoLife?.[name] || (typeof require === 'function' ? require(path) : null);
    if (typeof value?.[method] !== 'function') throw fault('dependency_unavailable', '책 원고에 필요한 자료 모듈을 불러오지 못했습니다.');
    return value;
  }
  function fenced(value) {
    let length = 3;
    for (const run of value.matchAll(/`+/g)) length = Math.max(length, run[0].length + 1);
    const fence = '`'.repeat(length);
    return fence + '\n' + value + '\n' + fence;
  }
  function outline(bundle, state, versionIds, { by = 'time', from = '', to = '' } = {}) {
    const workbench = dependency('Workbench', './workbench.js', 'validate');
    const core = dependency('Core', './core.js', 'validateWorkspace');
    const reflection = dependency('Reflection', './reflection.js', 'chronology');
    core.validateWorkspace(bundle); workbench.validate(state);
    if (bundle.workspaceId !== state.workspaceId) throw fault('workspace_mismatch', '자료와 책의 작업공간이 다릅니다.');
    if (!['time', 'theme'].includes(by) || !Array.isArray(versionIds) || Reflect.ownKeys(versionIds).length !== versionIds.length + 1 ||
        Reflect.ownKeys(versionIds).some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= versionIds.length)) ||
        versionIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)))
      throw fault('invalid_book_outline', '목차의 분류와 선택한 원문 버전을 확인해 주세요.');
    // The range is a deliberate view selection, never an inferred experience period.
    const years = reflection.chronology(bundle, versionIds, { from, to });
    const rows = by === 'time' ? years : reflection.themes(state, years.flatMap(row => row.versionIds));
    return rows.map(row => ({ key: row.key, title: row.label, versionIds: row.versionIds.slice() }));
  }
  function fromOutline(state, input, { id } = {}) {
    const workbench = dependency('Workbench', './workbench.js', 'validate');
    workbench.validate(state);
    const fields = (value, required, optional = []) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
      Reflect.ownKeys(value).every(key => required.includes(key) || optional.includes(key)) && required.every(key => Object.hasOwn(value, key));
    const list = value => Array.isArray(value) && Reflect.ownKeys(value).length === value.length + 1 && Reflect.ownKeys(value).every(key => key === 'length' ||
      typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length) &&
      value.every((_, index) => Object.hasOwn(value, index));
    if (!fields(input, ['title', 'chapters'], ['question']) || !list(input.chapters) || !input.chapters.length ||
        input.chapters.some(chapter => !fields(chapter, ['title', 'versionIds']) || !list(chapter.versionIds) || !chapter.versionIds.length))
      throw fault('invalid_book_outline', '원문을 선택한 장과 책 제목을 확인해 주세요.');
    if ((state.books || []).length >= workbench.LIMITS.books || input.chapters.length > workbench.LIMITS.bookChapters)
      throw fault('limit_reached', '책 또는 장의 최대 개수를 확인해 주세요. 기존 구성은 유지했습니다.');
    const createId = id === undefined ? dependency('Core', './core.js', 'id').id : id;
    if (typeof createId !== 'function') throw fault('invalid_book_outline', '책 식별자를 만드는 방법을 확인해 주세요.');
    const used = new Set([state.workspaceId]);
    const reserve = value => {
      if (Array.isArray(value)) { value.forEach(reserve); return; }
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        if (key === 'id' || key.endsWith('Id')) used.add(item);
        else if (key.endsWith('Ids') && Array.isArray(item)) item.forEach(value => used.add(value));
        reserve(item);
      }
    };
    reserve(state); reserve(input);
    const fresh = () => {
      for (let attempt = 0; attempt < 1024; attempt++) {
        const value = createId();
        if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
          throw fault('invalid_id', '책 식별자를 확인해 주세요. 기존 구성은 유지했습니다.');
        if (!used.has(value)) { used.add(value); return value; }
      }
      throw fault('id_collision', '책 식별자를 만들지 못했습니다. 기존 구성은 유지했습니다.');
    };
    const bookId = fresh();
    const book = { id: bookId, title: input.title, fromYear: '', toYear: '', question: input.question === undefined ? '' : input.question,
      chapters: input.chapters.map(chapter => ({ id: fresh(), title: chapter.title, note: '', versionIds: chapter.versionIds.slice() })) };
    const next = JSON.parse(JSON.stringify(state));
    next.books = (next.books || []).concat(book);
    workbench.validate(next);
    return { state: next, bookId };
  }
  function review(projection) {
    const reflection = dependency('Reflection', './reflection.js', 'year');
    if (!projection || !Array.isArray(projection.chapters))
      throw fault('invalid_book_review', '검토할 책 원고를 확인해 주세요.');
    const count = evidence => {
      const unique = new Map(evidence.map(item => [item.versionId, item]));
      const counts = { references: unique.size, missing: 0, otherAuthors: 0, unknownAuthors: 0, linkOnly: 0, undated: 0 };
      for (const item of unique.values()) {
        if (item.missing) { counts.missing++; continue; }
        if (item.originalAuthor.relation === 'other') counts.otherAuthors++;
        if (item.originalAuthor.relation === 'unknown') counts.unknownAuthors++;
        if (item.coverage.status === 'link_only') counts.linkOnly++;
        if (reflection.year(item.originalCreatedAt) === null) counts.undated++;
      }
      return counts;
    };
    const evidence = chapter => chapter.evidence.concat(chapter.insights.flatMap(insight => insight.supportEvidence.concat(insight.counterEvidence)));
    const chapters = projection.chapters.map(chapter => ({ id: chapter.id, title: chapter.title, blankNote: !chapter.note.trim(), ...count(evidence(chapter)) }));
    return { counts: { chapters: chapters.length, blankNotes: chapters.filter(chapter => chapter.blankNote).length,
      ...count(projection.chapters.flatMap(evidence)) }, chapters };
  }
  function project(bundle, state, bookId, { includeSources = false } = {}) {
    const workbench = dependency('Workbench', './workbench.js', 'validate');
    const core = dependency('Core', './core.js', 'validateWorkspace');
    core.validateWorkspace(bundle); workbench.validate(state);
    if (bundle.workspaceId !== state.workspaceId) throw fault('workspace_mismatch', '자료와 책의 작업공간이 다릅니다.');
    if (typeof includeSources !== 'boolean') throw fault('invalid_book', '원문 본문 포함 선택을 확인해 주세요.');
    const book = (state.books || []).find(value => value.id === bookId);
    if (!book) throw fault('book_missing', '선택한 책을 찾을 수 없습니다. 다른 책으로 대체하지 않았습니다.');
    if (book.archived) throw fault('book_archived', '보관한 책입니다. 책을 복구한 뒤 원고를 열어 주세요.');
    const sources = new Map(bundle.sources.map(source => [source.id, source]));
    const versions = new Map(bundle.sourceVersions.map(version => [version.id, version]));
    const totals = new Map(), numbers = new Map();
    for (const version of bundle.sourceVersions) {
      const number = (totals.get(version.sourceId) || 0) + 1;
      totals.set(version.sourceId, number); numbers.set(version.id, number);
    }
    const select = ids => ids.map(versionId => {
      const version = versions.get(versionId), source = version && sources.get(version.sourceId);
      if (!version || !source) return { versionId, missing: true };
      const item = { versionId, missing: false, sourceId: source.id, title: source.title, url: source.url ?? null,
        originalCreatedAt: version.originalCreatedAt,
        originalAuthor: { label: version.originalAuthor.label, relation: version.originalAuthor.relation },
        coverage: { status: version.coverage.status, omissions: version.coverage.omissions.slice() },
        versionNumber: numbers.get(versionId), versionTotal: totals.get(source.id), hasBody: version.contentText !== null };
      // Default previews contain no original body property, including link-only nulls.
      if (includeSources) item.body = version.contentText;
      return item;
    });
    return { id: book.id, title: book.title, fromYear: book.fromYear, toYear: book.toYear, question: book.question, includeSources,
      chapters: book.chapters.filter(chapter => !chapter.archived).map(chapter => ({ id: chapter.id, title: chapter.title, note: chapter.note,
        versionIds: chapter.versionIds.slice(), evidence: select(chapter.versionIds),
        insights: (chapter.insights || []).filter(insight => !insight.excluded).map(insight => ({
          id: insight.id, statement: insight.statement, uncertainty: insight.uncertainty,
          supportVersionIds: insight.supportVersionIds.slice(), counterVersionIds: insight.counterVersionIds.slice(),
          supportEvidence: select(insight.supportVersionIds), counterEvidence: select(insight.counterVersionIds)
        })) })) };
  }
  function evidence(items, includeSources, heading = '선택한 근거 원문', depth = 3) {
    // Keep the reflection exporter's provenance wording and spacing, but consume
    // only projected selections. Metadata and optional bodies stay fenced raw text.
    const relation = { self: '내 기록', other: '다른 사람의 기록', unknown: '작성자 관계 미확인' };
    const output = ['#'.repeat(depth) + ' ' + heading, '', '원문 작성일은 경험 시기를 뜻하지 않습니다.'];
    if (!items.length) output.push('', '선택한 근거 원문이 없습니다.');
    items.forEach((item, index) => {
      output.push('', '#'.repeat(depth + 1) + ' 근거 ' + (index + 1), '');
      if (item.missing) { output.push(fenced('연결된 원문 없음\n다른 버전으로 대체하지 않았습니다.')); return; }
      output.push(fenced(['제목: ' + item.title,
        '원문 작성일: ' + (item.originalCreatedAt || '미확인'),
        '원 작성자: ' + (item.originalAuthor.label || '미확인'),
        '작성자 관계: ' + (relation[item.originalAuthor.relation] || relation.unknown),
        '원문 URL: ' + (item.url || '미제공'),
        '선택 버전: ' + item.versionNumber + '/' + item.versionTotal,
        '본문 확보 범위: ' + item.coverage.status,
        '누락: ' + (item.coverage.omissions.join(' · ') || '확인한 누락 없음')].join('\n')));
      if (includeSources) output.push('', '#'.repeat(depth + 2) + ' 선택한 버전의 보관 본문', '',
        item.body === null ? '본문 미확보 · 링크만 보관했습니다.' : fenced(item.body));
    });
    return output.join('\n') + '\n';
  }
  function markdown(bundle, state, bookId, options = {}) {
    const book = project(bundle, state, bookId, options), includeSources = book.includeSources;
    const output = ['# 비공개 책 원고', '', fenced('책 제목: ' + book.title), '',
      fenced('설정한 기간: ' + (book.fromYear || '미지정') + ' ~ ' + (book.toYear || '미지정') + '\n질문: ' + book.question), '',
      '설정한 기간은 책의 설명이며 선택한 근거를 자동으로 제한하지 않습니다. 원문 작성일은 경험 시기를 뜻하지 않습니다.'];
    if (!book.chapters.length) output.push('', '아직 구성한 장이 없습니다.');
    book.chapters.forEach((chapter, index) => {
      output.push('', '## 장 ' + (index + 1), '', fenced('장 제목: ' + chapter.title), '',
        '### 현재 원고', '', chapter.note, '', evidence(chapter.evidence, includeSources));
      chapter.insights.forEach((insight, insightIndex) => {
        output.push('', '### 현재 해석 ' + (insightIndex + 1), '', '사용자가 직접 쓴 해석입니다. 연결한 글을 내 신념이나 해석의 증명으로 자동 판단하지 않습니다.', '',
          ...(insight.statement.trim() ? [] : ['아직 작성하지 않은 해석', '']),
          fenced('해석: ' + insight.statement), '', fenced('불확실성: ' + insight.uncertainty), '',
          evidence(insight.supportEvidence, includeSources, '근거로 연결한 원문', 4), '',
          evidence(insight.counterEvidence, includeSources, '반례로 연결한 원문', 4));
      });
    });
    return output.join('\n') + '\n';
  }
  return Object.freeze({ markdown, project, outline, fromOutline, review });
});

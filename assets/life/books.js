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
  return Object.freeze({ markdown, project });
});

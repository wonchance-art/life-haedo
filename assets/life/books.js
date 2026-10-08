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
  function evidence(reflection, bundle, state, versionIds, includeSources, heading = '선택한 근거 원문', depth = 3) {
    // Reuse the reflection exporter only for provenance. Notes stay outside this
    // transformation, and fenced metadata/originals retain every raw code unit.
    const raw = reflection.markdown(bundle, { workspaceId: state.workspaceId,
      reflection: { note: '', versionIds } }, { includeSources });
    const marker = '\n## 선택한 근거 원문\n';
    const start = raw.indexOf(marker);
    if (start < 0) throw fault('dependency_unavailable', '근거 원문 내보내기 형식을 확인해 주세요.');
    let fence = null;
    return raw.slice(start + 1).split('\n').map((line, index) => {
      if (index === 0) return '#'.repeat(depth) + ' ' + heading;
      const delimiter = /^(`{3,})$/.exec(line);
      if (delimiter) {
        if (fence === null) fence = delimiter[1];
        else if (delimiter[1] === fence) fence = null;
        return line;
      }
      return fence === null && /^#{2,4} /.test(line) ? '#'.repeat(depth - 2) + line : line;
    }).join('\n');
  }
  function markdown(bundle, state, bookId, { includeSources = false } = {}) {
    const workbench = dependency('Workbench', './workbench.js', 'validate');
    const core = dependency('Core', './core.js', 'validateWorkspace');
    const reflection = dependency('Reflection', './reflection.js', 'markdown');
    core.validateWorkspace(bundle); workbench.validate(state);
    if (bundle.workspaceId !== state.workspaceId) throw fault('workspace_mismatch', '자료와 책의 작업공간이 다릅니다.');
    if (typeof includeSources !== 'boolean') throw fault('invalid_book', '원문 본문 포함 선택을 확인해 주세요.');
    const book = (state.books || []).find(value => value.id === bookId);
    if (!book) throw fault('book_missing', '선택한 책을 찾을 수 없습니다. 다른 책으로 대체하지 않았습니다.');
    const output = ['# 비공개 책 원고', '', fenced('책 제목: ' + book.title), '',
      fenced('설정한 기간: ' + (book.fromYear || '미지정') + ' ~ ' + (book.toYear || '미지정') + '\n질문: ' + book.question), '',
      '설정한 기간은 책의 설명이며 선택한 근거를 자동으로 제한하지 않습니다. 원문 작성일은 경험 시기를 뜻하지 않습니다.'];
    if (!book.chapters.length) output.push('', '아직 구성한 장이 없습니다.');
    book.chapters.forEach((chapter, index) => {
      output.push('', '## 장 ' + (index + 1), '', fenced('장 제목: ' + chapter.title), '',
        '### 현재 원고', '', chapter.note, '', evidence(reflection, bundle, state, chapter.versionIds, includeSources));
      (chapter.insights || []).filter(insight => !insight.excluded).forEach((insight, insightIndex) => {
        output.push('', '### 현재 해석 ' + (insightIndex + 1), '', '사용자가 직접 쓴 해석입니다. 연결한 글을 내 신념이나 해석의 증명으로 자동 판단하지 않습니다.', '',
          ...(insight.statement.trim() ? [] : ['아직 작성하지 않은 해석', '']),
          fenced('해석: ' + insight.statement), '', fenced('불확실성: ' + insight.uncertainty), '',
          evidence(reflection, bundle, state, insight.supportVersionIds, includeSources, '근거로 연결한 원문', 4), '',
          evidence(reflection, bundle, state, insight.counterVersionIds, includeSources, '반례로 연결한 원문', 4));
      });
    });
    return output.join('\n') + '\n';
  }
  return Object.freeze({ markdown });
});

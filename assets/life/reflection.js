/* Private reflection helpers. Writing dates are evidence metadata, not dates of experience. */
(function (root, factory) {
  'use strict';
  const api = factory();
  root.HaedoLife ||= {}; root.HaedoLife.Reflection = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function () {
  'use strict';

  function fault(code, message) { return Object.assign(new Error(message), { code }); }
  function year(value) {
    if (typeof value !== 'string') return null;
    if (/^\d{4}$/.test(value)) return Number(value) > 0 ? Number(value) : null;
    const yearMonth = /^(\d{4})-(\d{2})$/.exec(value);
    if (yearMonth) {
      const y = Number(yearMonth[1]), month = Number(yearMonth[2]);
      return y > 0 && month >= 1 && month <= 12 ? y : null;
    }
    const date = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(value);
    if (!date) return null;
    const y = Number(date[1]), month = Number(date[2]), day = Number(date[3]);
    if (!y || month < 1 || month > 12 || day < 1) return null;
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day > days[month - 1]) return null;
    // Validate ISO time syntax, but retain the written year before timezone conversion.
    if (date[4] && (!/^T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(date[4]) ||
        !Number.isFinite(Date.parse(value)))) return null;
    return y;
  }
  function selected(ids) {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id))
      throw fault('invalid_reflection', '선택한 원문 버전을 확인해 주세요.');
    return [...new Set(ids)];
  }
  function indexes(bundle) {
    if (!bundle || !Array.isArray(bundle.sources) || !Array.isArray(bundle.sourceVersions))
      throw fault('invalid_reflection', '회고할 원문 자료를 확인해 주세요.');
    return { sources: new Map(bundle.sources.map(source => [source.id, source])),
      versions: new Map(bundle.sourceVersions.map(version => [version.id, version])) };
  }
  function bound(value) {
    if (value === '') return null;
    if (typeof value !== 'string' || !/^\d{4}$/.test(value) || year(value) === null)
      throw fault('invalid_reflection_range', '작성연도 범위는 네 자리 연도로 입력해 주세요.');
    return Number(value);
  }
  function chronology(bundle, ids, { from = '', to = '' } = {}) {
    const start = bound(from), end = bound(to);
    if (start !== null && end !== null && start > end)
      throw fault('invalid_reflection_range', '시작 작성연도는 끝 작성연도보다 늦을 수 없습니다.');
    const { sources, versions } = indexes(bundle), buckets = new Map();
    for (const id of selected(ids)) {
      const version = versions.get(id);
      const y = version && sources.has(version.sourceId) ? year(version.originalCreatedAt) : null;
      if (y !== null && (start !== null && y < start || end !== null && y > end)) continue;
      const key = y === null ? 'unknown' : String(y);
      if (!buckets.has(key)) buckets.set(key, { key, label: y === null ? '작성 시기 미확인' : y + '년', versionIds: [] });
      buckets.get(key).versionIds.push(id);
    }
    return [...buckets.values()].sort((a, b) => a.key === 'unknown' ? 1 : b.key === 'unknown' ? -1 : Number(a.key) - Number(b.key));
  }
  function themes(workbench, ids) {
    if (!workbench || !Array.isArray(workbench.groups))
      throw fault('invalid_reflection', '회고의 주제 묶음을 확인해 주세요.');
    const chosen = selected(ids), chosenSet = new Set(chosen), grouped = new Set(), rows = [];
    for (const group of workbench.groups) {
      const versionIds = selected(group.versionIds).filter(id => chosenSet.has(id));
      if (!versionIds.length) continue;
      versionIds.forEach(id => grouped.add(id));
      rows.push({ key: group.id, label: group.title, versionIds });
    }
    const ungrouped = chosen.filter(id => !grouped.has(id));
    if (ungrouped.length) rows.push({ key: 'ungrouped', label: '묶음에 넣지 않은 기록', versionIds: ungrouped });
    return rows;
  }
  // Fence arbitrary metadata and optional originals; URLs and HTML remain literal text.
  function fenced(value) {
    let length = 3;
    for (const run of value.matchAll(/`+/g)) length = Math.max(length, run[0].length + 1);
    const fence = '`'.repeat(length);
    return fence + '\n' + value + '\n' + fence;
  }
  function markdown(bundle, workbench, { includeSources = false } = {}) {
    if (!workbench?.reflection || typeof workbench.reflection.note !== 'string' || typeof includeSources !== 'boolean')
      throw fault('invalid_reflection', '회고 원고와 원문 포함 선택을 확인해 주세요.');
    if ((bundle?.workspaceId !== undefined || workbench.workspaceId !== undefined) && bundle?.workspaceId !== workbench.workspaceId)
      throw fault('invalid_reflection', '회고 원고와 근거 원문의 작업공간이 다릅니다.');
    const { sources, versions } = indexes(bundle), ids = selected(workbench.reflection.versionIds);
    const relation = { self: '내 기록', other: '다른 사람의 기록', unknown: '작성자 관계 미확인' };
    const output = ['# 비공개 회고 원고', '', workbench.reflection.note, '', '## 선택한 근거 원문', '',
      '원문 작성일은 경험 시기를 뜻하지 않습니다.'];
    if (!ids.length) output.push('', '선택한 근거 원문이 없습니다.');
    ids.forEach((id, index) => {
      output.push('', '### 근거 ' + (index + 1), '');
      const version = versions.get(id), source = version && sources.get(version.sourceId);
      if (!source || !version) { output.push(fenced('연결된 원문 없음\n다른 버전으로 대체하지 않았습니다.')); return; }
      const siblings = bundle.sourceVersions.filter(item => item.sourceId === source.id);
      output.push(fenced(['제목: ' + source.title,
        '원문 작성일: ' + (version.originalCreatedAt || '미확인'),
        '원 작성자: ' + (version.originalAuthor?.label || '미확인'),
        '작성자 관계: ' + (relation[version.originalAuthor?.relation] || relation.unknown),
        '원문 URL: ' + (source.url || '미제공'),
        '선택 버전: ' + (siblings.findIndex(item => item.id === id) + 1) + '/' + siblings.length,
        '본문 확보 범위: ' + (version.coverage?.status || 'unknown'),
        '누락: ' + (version.coverage?.omissions?.join(' · ') || '확인한 누락 없음')].join('\n')));
      if (includeSources) {
        output.push('', '#### 선택한 버전의 보관 본문', '',
          version.contentText === null || version.contentText === undefined ? '본문 미확보 · 링크만 보관했습니다.' : fenced(version.contentText));
      }
    });
    return output.join('\n') + '\n';
  }
  return Object.freeze({ year, chronology, themes, markdown });
});

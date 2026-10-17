/* Read-only views of explicitly selected, exact source versions. No inferred traits. */
(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports ? require('./reflection.js') : root.HaedoLife.Reflection);
  root.HaedoLife ||= {}; root.HaedoLife.ReflectionLenses = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (reflection) {
  'use strict';
  function scope(bundle, workbench, ids, period = {}) {
    if (!bundle || !workbench || bundle.workspaceId !== workbench.workspaceId)
      throw new Error('같은 작업공간의 선택 자료를 확인해 주세요.');
    const selected = [...new Set(ids)];
    if (selected.some(id => !workbench.reflection.versionIds.includes(id)))
      throw new Error('회고에서 선택한 원문만 살펴볼 수 있습니다.');
    const visible = new Set(reflection.chronology(bundle, selected, period).flatMap(group => group.versionIds));
    const sources = new Map(bundle.sources.map(source => [source.id, source]));
    const versions = new Map(bundle.sourceVersions.map(version => [version.id, version]));
    const counts = { selected: selected.length, outsidePeriod: 0, missing: 0, other: 0, unknownAuthor: 0, noBody: 0, unknownDate: 0 };
    const items = [];
    for (const id of selected) {
      if (!visible.has(id)) { counts.outsidePeriod++; continue; }
      const version = versions.get(id), source = version && sources.get(version.sourceId);
      if (!source || !version) { counts.missing++; continue; }
      const relation = version.originalAuthor?.relation;
      if (relation !== 'self') { counts[relation === 'other' ? 'other' : 'unknownAuthor']++; continue; }
      if (typeof version.contentText !== 'string' || !version.contentText.trim() || version.coverage?.status === 'link_only') { counts.noBody++; continue; }
      const year = reflection.year(version.originalCreatedAt);
      if (year === null) counts.unknownDate++;
      items.push({ versionId: id, sourceId: source.id, title: source.title, date: version.originalCreatedAt,
        year, text: version.contentText, coverage: version.coverage?.status || 'unknown' });
    }
    return { items, counts };
  }
  function interests(workbench, items) {
    const selected = new Set(items.map(item => item.versionId)), grouped = new Set();
    const groups = workbench.groups.flatMap(group => {
      const versionIds = [...new Set(group.versionIds)].filter(id => selected.has(id));
      versionIds.forEach(id => grouped.add(id));
      return versionIds.length ? [{ id: group.id, title: group.title, versionIds }] : [];
    });
    const rest = items.filter(item => !grouped.has(item.versionId)).map(item => item.versionId);
    if (rest.length) groups.push({ id: 'unassigned', title: '아직 묶지 않은 글', versionIds: rest });
    return groups;
  }
  function questions(items, limit = 40) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('구절 표시 범위를 확인해 주세요.');
    const rows = [];
    for (const item of items) {
      // Match the original UTF-16 string. Do not normalize whitespace or infer a question's meaning.
      for (const match of item.text.matchAll(/[^.!?。！？\r\n]*[?？]/gu)) {
        const raw = match[0], leading = raw.length - raw.trimStart().length;
        const text = raw.slice(leading), start = match.index + leading;
        if (!text || /^[?？]+$/.test(text)) continue;
        if (rows.length === limit) return { rows, hasMore: true };
        rows.push({ versionId: item.versionId, sourceId: item.sourceId, start, end: start + text.length, text });
      }
    }
    return { rows, hasMore: false };
  }
  function compare(items, firstId, secondId) {
    if (!firstId || !secondId) return { items: [], notice: '비교할 두 글을 직접 골라 주세요.' };
    if (firstId === secondId) return { items: [], notice: '서로 다른 원문 버전을 골라 주세요.' };
    const first = items.find(item => item.versionId === firstId), second = items.find(item => item.versionId === secondId);
    if (!first || !second || first.year === null || second.year === null)
      return { items: [], notice: '현재 범위에서 작성 연도를 확인할 수 있는 두 글을 골라 주세요.' };
    const pair = [first, second].sort((a, b) => a.year - b.year);
    return { items: pair, notice: first.year === second.year ? '같은 작성 연도입니다. 두 글의 전후 순서를 확정하지 않습니다.' : '작성 연도순으로 놓았습니다. 경험 시기나 생각이 바뀐 계기를 뜻하지 않습니다.' };
  }
  return Object.freeze({ scope, interests, questions, compare });
});

/* Read-only projection. No saved index, remote queries, draft or publication reads. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./core.js') : root.HaedoLife.Core);
  root.HaedoLife ||= {}; root.HaedoLife.UnifiedSearch = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (core) {
  'use strict';
  const labels = { source: '원문', page: '페이지', collection: '컬렉션', nine: '9칸 구성' };
  const itemText = item => [item.attachment.type, item.attachment.title, item.attachment.creator, item.attachment.url, item.reason];
  const staleNine = () => new Error('검색한 9칸 구성이 바뀌었습니다. 검색 결과를 다시 불러와 주세요.');
  function resolveNineTarget(state, target) {
    const board = state?.boards.find(b => b.id === target?.boardId);
    const area = board?.areas.find(a => a.id === target.areaId);
    const item = area?.items[target.itemIndex];
    const value = target?.itemIndex != null ? item && itemText(item) : target?.areaId ? area && [area.title, area.note] : board && [board.title, board.intro];
    if (!value || JSON.stringify(value) !== target.snapshot) throw staleNine();
    return { board, area, item };
  }
  function excerpt(text, match) {
    let start = Math.max(0, (match?.start || 0) - 55), end = Math.min(text.length, (match?.end || 0) + 140);
    if (start && /[\uDC00-\uDFFF]/.test(text[start])) start--;
    if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end])) end++;
    return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  }
  function search({ bundle, workbench, collection, nineBoard, photoPosts }, query, { ignoreKoreanSpacing = false, archived = false } = {}) {
    const options = { ignoreKoreanSpacing }, rows = [];
    // Validate even when all stores failed or the query is blank.
    core.matchesSearchText('', query, options);
    if (!query.trim()) return rows;
    const field = fields => {
      for (const [label, text] of fields) {
        if (typeof text !== 'string') continue;
        const match = core.findSearchText(text, query, options);
        if (match) return { field: label, snippet: excerpt(text, match) };
      }
      return null;
    };
    if (bundle) {
      const sources = new Map(bundle.sources.map(s => [s.id, s]));
      const hits = new Map(core.searchSources(bundle, query, options).map(h => [h.sourceVersionId, h]));
      const versionsBySource = new Map(), versionPositions = new Map();
      for (const version of bundle.sourceVersions) {
        const versions = versionsBySource.get(version.sourceId) || [];
        versionPositions.set(version.id, versions.length); versions.push(version);
        versionsBySource.set(version.sourceId, versions);
      }
      for (const record of bundle.records) {
        const found = field([['발췌', record.text], ['내 메모', record.note], ['주제', record.topic]]);
        if (!found) continue;
        for (const ref of record.sourceRefs) {
          if (hits.has(ref.sourceVersionId) || !sources.has(ref.sourceId)) continue;
          const versions = versionsBySource.get(ref.sourceId) || [];
          const index = versionPositions.get(ref.sourceVersionId);
          if (index === undefined || versions[index]?.id !== ref.sourceVersionId) continue;
          hits.set(ref.sourceVersionId, { sourceId: ref.sourceId, sourceVersionId: ref.sourceVersionId, versionIndex: index + 1, versionCount: versions.length, locator: ref.locator, found });
        }
      }
      for (const hit of hits.values()) {
        const title = sources.get(hit.sourceId).title || '제목 없는 원문';
        rows.push({ kind: 'source', key: 'find:source:' + hit.sourceVersionId, title, meta: `원문 · ${hit.versionIndex}/${hit.versionCount} 버전`,
          ...hit, ...(hit.found || { field: hit.matchedBy === 'body' ? '본문' : '제목', snippet: hit.quote ? hit.snippet.before + hit.quote + hit.snippet.after : title }) });
      }
    }
    if (workbench) {
      for (const post of workbench.page.posts || []) {
        if (post.status !== 'saved') continue;
        const found = field([['본문', post.body], ...post.attachments.flatMap(a => [['첨부 제목', a.title], ['첨부 창작자', a.creator], ['첨부 출처', a.url]])]);
        if (found) rows.push({ kind: 'page', key: 'find:post:' + post.id, postId: post.id, title: post.body.split('\n').find(s => s.trim())?.slice(0, 160) || post.attachments[0]?.title || '페이지 글', meta: '페이지 글 · ' + (post.visibility === 'private' ? '비공개' : '공개 후보'), ...found });
      }
      for (const entry of workbench.page.entries) {
        const found = field([['제목', entry.title], ['내 코멘트', entry.note]]);
        if (found) rows.push({ kind: 'page', key: 'find:entry:' + entry.id, entryId: entry.id, title: entry.title || '페이지 항목', meta: '페이지 구성 · ' + (entry.enabled ? '편집 사본' : '표시 꺼짐'), ...found });
      }
    }
    if (photoPosts) for (const post of photoPosts) {
      if (post.status !== 'saved') continue;
      const found = field([['제목', post.title], ['본문·사진 설명', post.body]]);
      if (found) rows.push({ kind: 'page', key: 'find:photo-post:' + post.id, photoPostId: post.id, title: post.title || '제목 없는 사진 글', meta: '사진 글 · 비공개 · 이 브라우저', ...found });
    }
    if (collection) for (const item of collection.items) {
      if (item.archived && !archived) continue;
      const found = field([['제목', item.title], ['만든 사람', item.creator], ['비공개 메모', item.note], ['주제', item.tags.join(' · ')], ['출처', item.url], ...Object.values(item.details).map(v => ['세부 정보', v])]);
      if (found) rows.push({ kind: 'collection', key: 'find:collection:' + item.id, itemId: item.id, type: item.type, title: item.title, meta: '컬렉션' + (item.archived ? ' · 보관 중' : ''), ...found });
    }
    if (nineBoard) for (const board of nineBoard.boards) {
      const title = board.title || '제목 없는 구성';
      const add = (fields, target, name, meta, key) => {
        const found = field(fields);
        if (found) rows.push({ kind: 'nine', key: 'find:nine:' + key, title: name, meta: '9칸 구성 · ' + meta, nineTarget: target, ...found });
      };
      add([['구성 제목', board.title], ['구성 소개', board.intro]], { boardId: board.id, snapshot: JSON.stringify([board.title, board.intro]) }, title, '비공개', board.id);
      for (const [areaIndex, area] of board.areas.entries()) {
        const name = area.title || '영역 ' + (areaIndex + 1), key = board.id + ':' + area.id;
        add([['영역 이름', area.title], ['영역 설명', area.note]], { boardId: board.id, areaId: area.id, snapshot: JSON.stringify([area.title, area.note]) }, title + ' · ' + name, '비공개 영역', key);
        area.items.forEach((item, itemIndex) => add([['항목 제목', item.attachment.title], ['만든 사람', item.attachment.creator], ['출처', item.attachment.url], ['선택 이유', item.reason]],
          { boardId: board.id, areaId: area.id, itemIndex, snapshot: JSON.stringify(itemText(item)) }, item.attachment.title, title + ' · ' + name + ' · ' + (itemIndex + 1) + '번째 칸', key + ':' + itemIndex));
      }
    }
    return rows;
  }
  return Object.freeze({ search, labels, resolveNineTarget });
});

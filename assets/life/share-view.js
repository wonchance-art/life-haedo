/* The same allowlisted public snapshot is rendered in review and anonymous reading. */
(function (root) {
  'use strict';
  const life = root.HaedoLife ||= {};
  const origins = { apple_notes: 'Apple 메모', obsidian: 'Obsidian', naver_blog: '네이버 블로그', instagram: 'Instagram', other: '기타' };
  let rendering = 0;
  // A stable prefix across viewport changes keeps a reader's selection intact.
  // This is presentation of already public text, never a redaction boundary.
  function opening(text) {
    const limit = 150;
    if (text.length <= limit + 40) return text;
    let end = limit;
    const paragraph = Math.max(text.lastIndexOf('\n\n', end), text.lastIndexOf('\r\n\r\n', end));
    const space = Math.max(text.lastIndexOf(' ', end), text.lastIndexOf('\n', end));
    if (paragraph > limit / 2) end = paragraph;
    else if (space > limit / 2) end = space;
    if (/^[\uDC00-\uDFFF]$/.test(text[end])) end -= 1;
    if (text[end - 1] === '\r' && text[end] === '\n') end -= 1;
    return text.slice(0, end);
  }
  function render(snapshot, { headingLevel = 1, document = root.document, review = false } = {}) {
    life.Share.validate(snapshot);
    const level = Math.min(4, Math.max(1, Number(headingLevel) || 1));
    const node = (tag, text, name) => {
      const value = document.createElement(tag);
      if (text !== undefined && text !== null) value.textContent = text;
      if (name) value.className = name;
      return value;
    };
    const section = node('section', null, 'share-document');
    const renderId = ++rendering;
    let hasFold = false;
    section.setAttribute('aria-label', '공개할 페이지');
    section.append(node('h' + level, snapshot.title, 'share-title'));
    if (snapshot.intro) section.append(node('p', snapshot.intro, 'share-intro'));
    for (const [entryIndex, entry] of snapshot.entries.entries()) {
      const article = node('article', null, 'share-entry');
      article.append(node('h' + (level + 1), entry.title, 'share-entry-title'));
      for (const [index, part] of entry.parts.entries()) {
        const source = node('section', null, 'share-source');
        source.dataset.entryIndex = String(entryIndex); source.dataset.partIndex = String(index);
        const title = node('h' + (level + 2), part.title, 'share-source-title');
        if (part.title !== entry.title || index > 0) source.append(title);
        const meta = node('div', null, 'share-source-meta');
        const relation = { self: '페이지 작성자의 글', other: '다른 사람의 글', unknown: '작성자 관계 미확인' }[part.author.relation];
        meta.append(node('p', [origins[part.origin], part.author.label, relation].filter(Boolean).join(' · ')));
        if (part.originalCreatedAt) meta.append(node('p', '원문 작성일 ' + part.originalCreatedAt, 'share-source-date'));
        source.append(meta);
        const coverage = { full_text: '보관한 원문 전체', partial: '일부만 보관한 원문', link_only: '링크만 보관', unknown: '원문 확보 범위 미확인' };
        const scope = [];
        if (part.textKind === 'none') scope.push('본문 미공개');
        if (part.coverage.status !== 'full_text') scope.push(coverage[part.coverage.status]);
        if (scope.length) source.append(node('p', scope.join(' · '), 'share-source-scope'));
        if (part.coverage.omissions.length) source.append(node('p', '포함되지 않은 내용 · ' + part.coverage.omissions.join(' · '), 'share-source-omissions'));
        const actions = node('div', null, 'share-source-actions');
        if (part.text !== null) {
          const prefix = part.textKind === 'body' ? opening(part.text) : part.text;
          const text = node(part.textKind === 'excerpt' ? 'blockquote' : 'pre', prefix, 'share-body');
          if (part.textKind === 'excerpt') {
            const caption = node('p', null, 'share-caption');
            if (life.Icons) caption.append(life.Icons.create('quote'));
            caption.append(node('span', '원문에서 고른 문장'));
            source.append(caption);
          }
          source.append(text);
          if (prefix !== part.text) {
            hasFold = true;
            text.id = 'shareBody-' + renderId + '-' + entryIndex + '-' + index;
            text.tabIndex = -1; text.dataset.collapsed = 'true';
            const expand = node('button', '본문 펼치기', 'life-button share-expand'); expand.type = 'button';
            expand.setAttribute('aria-expanded', 'false'); expand.setAttribute('aria-controls', text.id);
            let expanded = false;
            expand.addEventListener('click', () => {
              expanded = !expanded; text.textContent = expanded ? part.text : prefix;
              text.dataset.collapsed = String(!expanded); expand.setAttribute('aria-expanded', String(expanded));
              expand.textContent = expanded ? '본문 접기' : '본문 펼치기';
              const target = expanded ? text : expand;
              target.focus({ preventScroll: true }); target.scrollIntoView({ block: expanded ? 'start' : 'nearest' });
            });
            actions.append(expand);
          }
        }
        if (part.url) {
          const link = node('a', '원문 보기', 'share-source-link');
          link.href = part.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
          if (life.Icons) link.append(life.Icons.create('arrow'));
          actions.append(link);
        }
        const detail = node('details', null, 'share-details');
        detail.append(node('summary', '출처 정보'));
        detail.append(node('p', coverage[part.coverage.status] || '원문 확보 범위 확인 필요'));
        if (part.url) detail.append(node('p', part.url));
        if (part.textKind === 'none') detail.append(node('p', '본문은 이 페이지에 공개하지 않았습니다.'));
        actions.append(detail); source.append(actions); article.append(source);
      }
      if (entry.note) {
        const note = node('section', null, 'share-comment');
        note.setAttribute('aria-label', '페이지 작성자의 생각');
        note.append(node('p', '덧붙인 생각', 'share-caption'), node('p', entry.note, 'share-comment-body'));
        article.append(note);
      }
      section.append(article);
    }
    if (review && hasFold) {
      const notice = node('p', '접힌 본문도 전체가 공개됩니다.', 'share-fold-note');
      section.insertBefore(notice, section.firstChild);
    }
    if (!snapshot.entries.length) section.append(node('p', '아직 표시할 기록이 없습니다.', 'share-empty'));
    return section;
  }
  life.ShareView = Object.freeze({ render });
})(globalThis);

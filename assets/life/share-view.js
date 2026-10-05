/* The same allowlisted public snapshot is rendered in review and anonymous reading. */
(function (root) {
  'use strict';
  const life = root.HaedoLife ||= {};
  const origins = { apple_notes: 'Apple 메모', obsidian: 'Obsidian', naver_blog: '네이버 블로그', instagram: 'Instagram', other: '기타' };
  function render(snapshot, { headingLevel = 1, document = root.document } = {}) {
    life.Share.validate(snapshot);
    const level = Math.min(4, Math.max(1, Number(headingLevel) || 1));
    const node = (tag, text, name) => {
      const value = document.createElement(tag);
      if (text !== undefined && text !== null) value.textContent = text;
      if (name) value.className = name;
      return value;
    };
    const section = node('section', null, 'share-document');
    section.setAttribute('aria-label', '공개할 페이지');
    section.append(node('h' + level, snapshot.title, 'share-title'));
    if (snapshot.intro) section.append(node('p', snapshot.intro, 'share-intro'));
    for (const entry of snapshot.entries) {
      const article = node('article', null, 'share-entry');
      article.append(node('h' + (level + 1), entry.title, 'share-entry-title'));
      for (const [index, part] of entry.parts.entries()) {
        const source = node('section', null, 'share-source');
        const title = node('h' + (level + 2), part.title, 'share-source-title');
        if (part.title !== entry.title || index > 0) source.append(title);
        if (part.text !== null) {
          const text = node(part.textKind === 'excerpt' ? 'blockquote' : 'p', part.text, 'share-body');
          if (part.textKind === 'excerpt') {
            const caption = node('p', null, 'share-caption');
            if (life.Icons) caption.append(life.Icons.create('quote'));
            caption.append(node('span', '원문에서 고른 문장'));
            source.append(caption);
          }
          source.append(text);
        }
        const meta = node('div', null, 'share-source-meta');
        const author = part.author.label || (part.author.relation === 'self' ? '페이지 작성자의 글' : '작성자 미확인');
        const origin = origins[part.origin] || part.origin;
        meta.append(node('p', [origin, author, part.originalCreatedAt].filter(Boolean).join(' · ')));
        if (part.url) {
          const link = node('a', '원문 보기', 'share-source-link');
          link.href = part.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
          if (life.Icons) link.append(life.Icons.create('arrow'));
          meta.append(link);
        }
        const detail = node('details', null, 'share-details');
        detail.append(node('summary', '출처 정보'));
        const coverage = { full_text: '보관한 원문 전체', partial: '일부만 보관한 원문', link_only: '링크만 보관', unknown: '원문 확보 범위 미확인' };
        detail.append(node('p', coverage[part.coverage.status] || '원문 확보 범위 확인 필요'));
        if (part.coverage.omissions.length) detail.append(node('p', part.coverage.omissions.join(' · ')));
        if (part.url) detail.append(node('p', part.url));
        if (part.textKind === 'none') detail.append(node('p', '본문은 이 페이지에 공개하지 않았습니다.'));
        meta.append(detail); source.append(meta); article.append(source);
      }
      if (entry.note) {
        const note = node('section', null, 'share-comment');
        note.setAttribute('aria-label', '페이지 작성자의 생각');
        note.append(node('p', '덧붙인 생각', 'share-caption'), node('p', entry.note, 'share-comment-body'));
        article.append(note);
      }
      section.append(article);
    }
    if (!snapshot.entries.length) section.append(node('p', '아직 표시할 기록이 없습니다.', 'share-empty'));
    return section;
  }
  life.ShareView = Object.freeze({ render });
})(globalThis);

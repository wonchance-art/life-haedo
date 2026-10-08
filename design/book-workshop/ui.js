/* Isolated interaction prototype. Memory only: no Auth, IDB, fetch or app mutations. */
(() => {
  'use strict';
  const sample = window.BookSample;
  const book = structuredClone(sample.book);
  const params = new URLSearchParams(location.search);
  const state = { direction: params.get('direction') === 'B' ? 'B' : 'A', view: ['edit', 'read'].includes(params.get('view')) ? params.get('view') : 'list', chapter: Math.min(3, Math.max(0, Number(params.get('chapter')) || 0)), demo: 'normal', toc: false, sources: false, dirty: false, query: '', returnTo: null, notice: '', draft: null, selection: null };
  document.body.dataset.presentation = String(params.get('presentation') === '1');
  const app = document.querySelector('#app');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const icon = name => window.HaedoLife.Icons.create(name);
  const button = (label, action, cls = '', glyph) => { const n = el('button', cls); n.type = 'button'; if (glyph) n.append(icon(glyph)); if (!cls.includes('icon-button')) n.append(document.createTextNode(label)); n.setAttribute('aria-label', label); n.title = label; n.addEventListener('click', action); return n; };
  const announce = text => { document.querySelector('#announcement').textContent = text; };
  const paragraphs = (target, text, chapter) => text.split('\n\n').forEach((p, i) => { const n = el('p', '', p); n.id = `paragraph-${chapter}-${i}`; target.append(n); });
  function dirtyGuard() { if (!state.dirty) return true; state.notice = '바꾼 예시 원고를 먼저 반영해 주세요.'; document.querySelector('.status').textContent = state.notice; document.querySelector('#saveDraft')?.focus(); return false; }
  function go(view, chapter = state.chapter) {
    if (!dirtyGuard()) return;
    state.view = view; state.chapter = chapter; state.toc = false; state.sources = false; state.notice = ''; state.draft = null; state.selection = null;
    render(); window.scrollTo(0, 0); document.querySelector('#main').focus({ preventScroll: true });
    if (view === 'read' && chapter) document.querySelector(`#chapter-${chapter}`)?.scrollIntoView();
  }
  function edit(chapter) {
    if (state.view === 'read') {
      const nodes = [...document.querySelectorAll(`#chapter-${chapter} .text p`)];
      const visible = nodes.find(n => n.getBoundingClientRect().bottom > 120) || nodes[0];
      state.returnTo = visible ? { id: visible.id, text: visible.textContent, chapter, top: visible.getBoundingClientRect().top } : null;
    }
    go('edit', chapter);
  }
  function returnToRead() {
    if (!dirtyGuard()) return;
    const restore = state.returnTo;
    go('read');
    if (restore) {
      const paragraphs = [...document.querySelectorAll(`#chapter-${restore.chapter} .text p`)];
      const p = paragraphs.find(n => n.textContent === restore.text) || paragraphs.find(n => n.textContent.includes(restore.text)) || document.getElementById(restore.id);
      if (p) { p.tabIndex = -1; p.focus({ preventScroll: true }); window.scrollBy(0, p.getBoundingClientRect().top - restore.top); }
    }
  }
  function autosize(n) { n.style.height = 'auto'; n.style.height = `${n.scrollHeight + 2}px`; }
  function saveDraft() {
    if (state.demo === 'error') { state.notice = '예시 저장 실패 · 입력은 그대로 남아 있습니다.'; render(); document.querySelector('#saveDraft')?.focus({ preventScroll: true }); return; }
    if (state.draft) Object.assign(book.chapters[state.chapter], state.draft);
    state.dirty = false; state.notice = '이 시안에 반영됨'; render(); announce('이 시안에 반영했습니다. 새로고침하면 사라집니다.'); document.querySelector('#saveDraft')?.focus({ preventScroll: true });
  }
  function download() {
    const text = '# ' + book.title + '\n\n' + book.chapters.map(c => '## ' + c.title + '\n\n' + c.note).join('\n\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const a = el('a'); a.href = url; a.download = '해도-디자인-예시-원고.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); announce('예시 원고 다운로드를 요청했습니다.');
  }
  function chapterButton(chapter, i, mode = state.view === 'read' ? 'read' : 'edit') {
    const n = button(chapter.title, () => go(mode, i)); n.prepend(el('span', 'chapter-number', String(i + 1).padStart(2, '0')));
    n.dataset.chapter = String(i);
    n.setAttribute('aria-current', String(i === state.chapter && state.view !== 'list')); return n;
  }
  function mobileChapterPicker() {
    const label = el('label', 'chapter-picker'); label.append(el('span', 'sr-only', '현재 장 선택'));
    const select = el('select'); select.setAttribute('aria-label', '현재 장 선택');
    book.chapters.forEach((c, i) => { const option = el('option', '', `${i + 1}. ${c.title}`); option.value = String(i); select.append(option); });
    select.value = String(state.chapter); select.addEventListener('change', () => { const next = Number(select.value); go(state.view, next); select.value = String(state.chapter); }); label.append(select); return label;
  }
  function sidebar() {
    const aside = el('nav', 'sidebar'); aside.setAttribute('aria-label', '책과 목차');
    aside.append(button('내 책', () => go('list'), '', 'book'));
    aside.append(el('div', 'side-label', '지금 보는 책'), el('h2', '', book.title));
    aside.append(el('div', 'side-label', '목차'));
    book.chapters.forEach((c, i) => aside.append(chapterButton(c, i)));
    aside.append(button('전체 읽기', () => go('read', 0), '', 'book')); return aside;
  }
  function header() {
    const bar = el('header', 'app-bar'); const left = el('div', 'bar-left');
    if (state.view === 'list') left.append(el('span', 'brand', '해도'));
    else left.append(button('책 목록으로', () => go('list'), 'icon-button', 'back'));
    left.append(el('span', 'crumb', state.view === 'list' ? '책 작업실' : book.title));
    const right = el('div', 'bar-right');
    if (state.view !== 'list') {
      if (state.direction === 'A') {
        const contents = button('목차', () => { state.toc = !state.toc; render(); document.querySelector('#tocToggle')?.focus({ preventScroll: true }); }, 'icon-button', 'book');
        contents.id = 'tocToggle'; contents.setAttribute('aria-expanded', String(state.toc)); contents.setAttribute('aria-controls', 'contents'); right.append(contents);
      }
      const modes = el('div', 'bar-switch'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '원고 보기');
      const writing = button('집필', () => edit(state.chapter)); writing.setAttribute('aria-pressed', String(state.view === 'edit'));
      const reading = button('읽기', returnToRead); reading.setAttribute('aria-pressed', String(state.view === 'read')); modes.append(writing, reading); right.append(modes);
      if (state.view === 'edit') { const save = button('반영', saveDraft, 'primary'); save.id = 'saveDraft'; save.title = '예시 원고에 반영 · 새로고침하면 초기화'; right.append(save); }
      else right.append(button('예시 원고 받기', download, 'icon-button download', 'download'));
    }
    bar.append(left, right); return bar;
  }
  function drawer() {
    const n = el('nav', 'drawer'); n.id = 'contents'; n.setAttribute('aria-label', '펼친 목차'); n.append(el('h2', '', '목차'));
    book.chapters.forEach((c, i) => n.append(chapterButton(c, i))); return n;
  }
  function library(main) {
    const library = el('section', 'library'); const heading = el('div', 'library-head'); heading.append(el('h1', '', '내 책'), el('span', 'note', state.demo === 'many' ? '40권 · 가상 목록' : state.demo === 'empty' ? '0권' : '1권')); library.append(heading);
    const search = el('label', 'search-field'); search.append(icon('search')); const input = el('input'); input.type = 'search'; input.placeholder = '책 찾기'; input.setAttribute('aria-label', '책 제목 검색'); input.value = state.query; search.append(input); heading.insertBefore(search, heading.lastElementChild);
    const entries = el('div'); library.append(entries);
    const drawEntries = () => {
      entries.replaceChildren();
      if (state.demo === 'loading') { const n = el('div', 'loading-bars'); n.setAttribute('role', 'status'); n.append(el('p', 'note', '책을 불러오는 중')); for (let i = 0; i < 3; i++) n.append(el('span')); entries.append(n, button('불러오기 완료 체험', () => { state.demo = 'normal'; render(); })); return; }
      if (state.demo === 'empty' || (state.query && !book.title.includes(state.query))) {
        const n = el('div', 'empty'); n.append(el('h2', '', state.query ? '찾는 책이 없어요' : '아직 엮은 책이 없어요'), el('p', '', state.query ? '다른 제목으로 찾아보세요.' : '지나온 글을 모아 하나의 원고로 읽어보세요. 먼저 예시 책을 열어볼 수 있어요.'), button(state.query ? '검색 지우기' : '예시 책 열기', () => { const opening = !state.query; state.demo = 'normal'; state.query = ''; if (opening) go('read', 0); else render(); }, 'soft', 'book')); entries.append(n); return;
      }
      const count = state.demo === 'many' ? 40 : 1;
      for (let i = 0; i < count; i++) {
        const entry = el('article', 'book-entry'); const primary = el('div', 'entry-main');
        const title = i ? book.title + ' · 목록 예시 ' + (i + 1) : book.title;
        const bookHeading = el('h2'); bookHeading.append(button(title, () => go('read', 0), 'book-title'));
        primary.append(bookHeading, el('div', 'book-meta', `${book.fromYear}–${book.toYear} · ${book.chapters.length}개 장 · 비공개`));
        const excerpt = el('p', 'book-preview', book.chapters[0].note.split('\n\n')[0]);
        primary.append(excerpt);
        const actions = el('div', 'book-actions'); actions.append(button('전체 읽기', () => go('read', 0), 'soft', 'book'), button('집필', () => go('edit', 0), '', 'edit')); primary.append(actions); entry.append(primary);
        if (!i) { const chapters = el('nav', 'inline-chapters'); chapters.setAttribute('aria-label', '장 바로 열기'); book.chapters.forEach((c, j) => chapters.append(chapterButton(c, j, 'edit'))); if (state.direction === 'B') primary.insertBefore(chapters, excerpt); else entry.append(chapters); }
        entries.append(entry);
      }
    };
    input.addEventListener('input', () => { state.query = input.value; drawEntries(); }); drawEntries(); main.append(library);
  }
  function sourcePanel(chapter) {
    const area = el('aside', 'source-area'); area.id = 'sourcePanel'; area.setAttribute('aria-label', '원문과 내 해석'); area.append(el('h3', '', '연결한 원문'));
    for (const id of chapter.versionIds || []) {
      const version = sample.versions.find(v => v.id === id); if (!version) continue;
      const source = sample.sources.find(s => s.id === version.sourceId); const n = el('section', 'source-item');
      n.append(el('h3', '', source.title));
      const relation = version.originalAuthor.relation === 'self' ? '내 글' : version.originalAuthor.relation === 'other' ? '타인의 글' : '작성자 미확인';
      const coverage = { full_text: '본문 보관', partial: '일부 보관', link_only: '링크만 보관' }[version.coverage.status];
      const older = sample.versions.some(v => v.sourceId === source.id && v.importedAt > version.importedAt) ? ' · 이전 버전' : '';
      n.append(el('div', 'source-meta', `${relation} · ${version.originalCreatedAt || '작성일 미확인'}\n${source.origin} · ${coverage}${older}`));
      n.append(el('p', '', version.contentText || '원문 본문을 확보하지 않았습니다.'));
      if (version.coverage.omissions.length) n.append(el('div', 'source-meta', version.coverage.omissions.join(' · ')));
      if (source.url) n.append(el('div', 'source-url', source.url)); area.append(n);
    }
    for (const insight of chapter.insights || []) {
      if (insight.excluded) continue;
      const n = el('section', 'insight'); n.append(el('h3', '', '내 해석'), el('p', '', insight.statement), el('p', 'note', insight.uncertainty));
      const ids = [...(insight.supportVersionIds || []), ...(insight.counterVersionIds || [])];
      if (ids.length) n.append(el('p', 'note', `근거 ${insight.supportVersionIds.length} · 반례 ${insight.counterVersionIds.length} · 자동 분석 아님`)); area.append(n);
    }
    return area;
  }
  function sourceToggle(chapter) {
    const n = button(`원문 ${chapter.versionIds.length}${state.sources ? ' 접기' : ' 보기'}`, () => { state.sources = !state.sources; const y = scrollY; render(); window.scrollTo(0, y); document.querySelector('#sourcesToggle')?.focus({ preventScroll: true }); }, 'source-button', 'quote'); n.id = 'sourcesToggle'; n.setAttribute('aria-expanded', String(state.sources)); n.setAttribute('aria-controls', 'sourcePanel'); return n;
  }
  function editor(main) {
    const c = book.chapters[state.chapter]; const draft = state.draft || { title: c.title, note: c.note }; state.draft = draft;
    if (state.sources) main.classList.add('sources-open'); const col = el('div', 'column');
    const top = el('div', 'chapter-top'); top.append(el('span', 'chapter-count', `${state.chapter + 1} / ${book.chapters.length}장`), sourceToggle(c)); if (state.direction === 'B') top.prepend(mobileChapterPicker()); col.append(top);
    if (state.sources && state.direction === 'A') col.append(sourcePanel(c));
    if (state.demo === 'error') { const n = el('div', 'notice'); n.setAttribute('role', 'alert'); n.append(el('span', '', '저장하지 못했어요. 입력은 남아 있어요.'), button('다시 시도', () => { state.demo = 'normal'; saveDraft(); })); col.append(n); }
    const heading = el('div', 'chapter-title'); heading.append(el('h1', 'sr-only', '장 집필'));
    const title = el('textarea', 'title-input'); title.rows = 1; title.value = draft.title; title.setAttribute('aria-label', '장 제목'); title.maxLength = 500; heading.append(title); col.append(heading);
    const text = el('textarea', 'draft'); text.value = draft.note; text.setAttribute('aria-label', '이 장의 원고'); text.spellcheck = false; col.append(text);
    const input = () => { draft.title = title.value; draft.note = text.value; state.dirty = true; state.notice = ''; autosize(title); autosize(text); document.querySelector('.status').textContent = '예시 변경됨'; };
    title.addEventListener('input', input); text.addEventListener('input', input);
    [title, text].forEach(n => ['select', 'blur', 'keyup'].forEach(event => n.addEventListener(event, () => { state.selection = { field: n === text ? 'draft' : 'title-input', start: n.selectionStart, end: n.selectionEnd }; })));
    if (state.sources && state.direction === 'B') col.append(sourcePanel(c));
    const footer = el('footer', 'draft-footer'); const status = el('span', 'status', state.notice || (state.dirty ? '예시 변경됨' : '예시 원고 · 새로고침하면 초기화')); status.setAttribute('role', 'status'); footer.append(status, button('읽던 곳으로', returnToRead, 'soft', 'arrow')); col.append(footer); main.append(col);
    requestAnimationFrame(() => { autosize(title); autosize(text); if (state.selection) { const n = state.selection.field === 'draft' ? text : title; n.setSelectionRange(state.selection.start, state.selection.end); } });
  }
  function reading(main) {
    const col = el('div', 'column'); if (state.direction === 'B') col.append(mobileChapterPicker()); col.append(el('h1', 'read-title', book.title));
    book.chapters.forEach((c, i) => {
      const section = el('section', 'reading-chapter'); section.id = `chapter-${i}`;
      const heading = el('div', 'chapter-heading'); const names = el('div'); names.append(el('span', 'chapter-count', `${i + 1} / ${book.chapters.length}장`), el('h2', '', c.title)); heading.append(names, button(`${i + 1}장 편집`, () => edit(i), 'icon-button soft', 'edit')); section.append(heading);
      const text = el('div', 'text'); paragraphs(text, c.note, i); section.append(text);
      const sources = button(`원문 ${c.versionIds.length} 보기`, () => { const existing = section.querySelector('.source-area'); if (existing) existing.remove(); else section.append(sourcePanel(c)); sources.setAttribute('aria-expanded', String(!existing)); }, 'source-button', 'quote'); sources.setAttribute('aria-expanded', 'false'); section.append(sources); col.append(section);
    });
    const end = el('footer', 'read-end'); end.append(el('p', '', '여기까지, 네 번의 선택을 담은 원고'), button('예시 원고 받기', download, '', 'download')); col.append(end); main.append(col);
  }
  function render() {
    document.body.dataset.direction = state.direction;
    document.body.dataset.view = state.view;
    document.querySelectorAll('[data-direction]').forEach(n => n.setAttribute('aria-pressed', String(n.dataset.direction === state.direction)));
    document.querySelector('#demoState').value = state.demo;
    app.replaceChildren(header()); if (state.toc && state.view !== 'list') app.append(drawer());
    const layout = el('div', 'layout'); if (state.direction === 'B' && state.view !== 'list') layout.append(sidebar()); const main = el('main', 'main'); main.id = 'main'; main.tabIndex = -1;
    if (state.view === 'list') library(main); else if (state.view === 'edit') editor(main); else reading(main);
    layout.append(main); app.append(layout);
  }
  document.querySelectorAll('[data-direction]').forEach(n => n.addEventListener('click', () => { state.direction = n.dataset.direction; const y = scrollY; render(); window.scrollTo(0, y); n.focus({ preventScroll: true }); }));
  document.querySelector('#demoState').addEventListener('change', e => { const next = e.target.value; if (state.dirty && next !== 'error' && next !== 'normal' && !dirtyGuard()) { e.target.value = state.demo; return; } state.demo = next; state.query = ''; if (state.demo === 'error' && state.view !== 'edit') { state.view = 'edit'; state.chapter = 1; state.draft = null; state.selection = null; } else if (state.demo !== 'normal' && state.demo !== 'error') state.view = 'list'; state.notice = ''; render(); window.scrollTo(0, 0); });
  let scrollPending = false;
  window.addEventListener('scroll', () => { if (state.view !== 'read' || scrollPending) return; scrollPending = true; requestAnimationFrame(() => { scrollPending = false; const chapters = [...document.querySelectorAll('.reading-chapter')]; const current = chapters.find(n => n.getBoundingClientRect().bottom > 170); if (!current) return; state.chapter = Number(current.id.split('-')[1]); document.querySelectorAll('.sidebar [data-chapter]').forEach(n => n.setAttribute('aria-current', String(Number(n.dataset.chapter) === state.chapter))); const select = document.querySelector('.chapter-picker select'); if (select) select.value = String(state.chapter); }); }, { passive: true });
  window.addEventListener('resize', () => { document.querySelectorAll('textarea').forEach(autosize); });
  render();
})();

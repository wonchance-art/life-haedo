/* Read-only private home. Uses saved records and page selections; never publishes. */
(function (global) {
  'use strict';
  const life = global.HaedoLife = global.HaedoLife || {};
  const ORIGINS = { apple_notes: 'Apple 메모', obsidian: 'Obsidian', naver_blog: '네이버 블로그', instagram: 'Instagram', other: '기타' };
  const RELATIONS = { self: '내 기록', other: '다른 사람의 기록', unknown: '작성자 관계 미확인' };
  function el(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }
  function create({ storage, core, host, getBundle, navigate, openSource, renderReadingResume, isDisposed = () => false, announce = () => {} }) {
    let disposed = false, generation = 0, visible = false;
    let libraryOpen = false, libraryWorkspace = null;
    const alive = () => !disposed && !isDisposed();
    const showing = context => alive() && visible && context.token === generation && getBundle()?.workspaceId === context.workspaceId && context.surface.parentNode === host;
    function action(context, label, task, className = '', { keepFocus = true } = {}) {
      const button = el('button', label, 'life-button' + (className ? ' ' + className : ''));
      button.type = 'button';
      let running = false;
      button.addEventListener('click', async () => {
        if (running || !showing(context) || !button.isConnected) return;
        running = true;
        // Navigation captures the focused entry before removing this view.
        // Native disabled would blur that button before its focus key is read.
        if (keepFocus) {
          button.focus({ preventScroll: true });
          button.setAttribute('aria-busy', 'true');
        }
        else button.disabled = true;
        try { await task(); }
        catch (_) {
          if (showing(context)) {
            context.error.hidden = false;
            context.error.textContent = '화면을 열지 못했습니다. 저장 상태를 확인한 뒤 다시 시도해 주세요.';
          }
        } finally { running = false; if (button.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); } }
      });
      return button;
    }
    function iconAction(context, label, glyph, task) {
      const button = action(context, '', task, 'life-icon-button');
      button.setAttribute('aria-label', label); button.title = label;
      button.append(life.Icons.create(glyph), el('span', label, 'life-tooltip'));
      return button;
    }
    function section(context, title, id, more) {
      const container = el('section', null, 'home-section'); container.id = id;
      const heading = el('div', null, 'home-section-heading');
      const name = el('h2', title); name.id = id + 'Title';
      name.tabIndex = -1;
      container.setAttribute('aria-labelledby', name.id);
      heading.append(name);
      if (more) heading.append(iconAction(context, title + ' 모두 보기', 'arrow', more));
      container.append(heading);
      return container;
    }
    function sourceInfo(versionId, bundle = getBundle()) {
      const version = bundle?.sourceVersions.find(item => item.id === versionId);
      const source = version && bundle.sources.find(item => item.id === version.sourceId);
      return source && version ? { source, version } : null;
    }
    function metadata(info) {
      const { source, version } = info;
      const parts = [life.Writing?.isOwnSource(source, getBundle()) ? '내 글' : ORIGINS[source.origin] || '기타', RELATIONS[version.originalAuthor.relation] || RELATIONS.unknown];
      if (version.contentText == null) parts.push('링크만 보관 · 본문 미확보');
      else if (version.coverage.status === 'partial') parts.push('일부 본문');
      else if (version.coverage.status === 'unknown') parts.push('확보 범위 미확인');
      return parts.join(' · ');
    }
    function snippet(text) {
      const normalized = String(text || '').replace(/\s+/g, ' ').trim();
      const characters = Array.from(normalized);
      return characters.length > 200 ? characters.slice(0, 200).join('') + '…' : normalized;
    }
    function dateLabel(value) {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return '담은 날짜 미확인';
      return '담음 ' + new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(date);
    }
    async function openVersion(context, versionId) {
      if (!showing(context)) return;
      const info = sourceInfo(versionId);
      if (!info) {
        announce('연결된 원문이 없습니다. 다른 버전으로 바꾸지 않았습니다.');
        return;
      }
      await openSource(info.source.id, info.version.id);
    }
    function record(context, info, { body = true, date = false, compact = false, focusScope = 'recent' } = {}) {
      const article = el('article', null, 'home-record' + (compact ? ' home-record-compact' : ''));
      article.dataset.sourceId = info.source.id; article.dataset.versionId = info.version.id;
      const heading = el('h3');
      const open = action(context, info.source.title, () => openVersion(context, info.version.id), 'life-source-open home-record-open', { keepFocus: true });
      open.dataset.focusKey = 'home:' + focusScope + ':' + info.version.id;
      heading.append(open); article.append(heading);
      if (body && info.version.contentText != null) article.append(el('p', snippet(info.version.contentText), 'home-text home-clamp'));
      article.append(el('p', metadata(info), 'life-meta home-record-meta'));
      if (date) {
        const imported = el('time', dateLabel(info.version.importedAt), 'life-meta home-date');
        imported.dateTime = info.version.importedAt; article.append(imported);
      }
      return article;
    }
    function quickLinks(context) {
      const nav = el('nav', null, 'home-blog-actions'); nav.setAttribute('aria-label', '내 블로그');
      [['글쓰기', 'edit', 'write', { pageCompose: true }], ['글 관리', null, 'blog', {}]].forEach(([label, glyph, destination, options], index) => {
        const button = action(context, '', () => navigate(index === 0 ? 'page' : destination, options), index === 0 ? 'life-primary home-blog-write' : 'home-blog-action');
        button.dataset.homeDestination = destination;
        button.dataset.focusKey = 'home:action:' + destination;
        if (glyph) button.append(life.Icons.create(glyph));
        button.append(el('span', label)); nav.append(button);
      });
      return nav;
    }
    function library(context, bundle) {
      const area = el('details', null, 'home-library');
      if (libraryWorkspace !== context.workspaceId) { libraryOpen = false; libraryWorkspace = context.workspaceId; }
      area.open = libraryOpen;
      area.addEventListener('toggle', () => { if (showing(context)) libraryOpen = area.open; });
      const summary = el('summary');
      summary.append(el('span', '자료실과 도구'), el('span', '가져온 기록 · 묶음 · 책', 'life-meta'));
      area.append(summary);
      const nav = el('nav', null, 'home-library-actions'); nav.setAttribute('aria-label', '자료실');
      [['자료 가져오기', 'import'], ['가져온 기록', 'sources'], ['컬렉션', 'collection'], ['연표', 'time']].forEach(([label, mode]) => {
        const button = action(context, label, () => navigate(mode));
        button.dataset.homeDestination = mode;
        button.dataset.focusKey = 'home:library:' + mode;
        nav.append(button);
      });
      const preview = action(context, '선택한 내용 미리보기', () => navigate('page', { pagePreview: true }));
      preview.dataset.homeDestination = 'preview';
      preview.dataset.focusKey = 'home:library:preview';
      nav.append(preview);
      area.append(nav, el('p', '미리보기에는 기록에서 고른 내용과 기존 첨부 글이 표시됩니다.', 'life-meta home-library-preview-note'));
      renderReadingResume?.(area);
      if (bundle.sources.length) area.append(recent(context, bundle));
      return area;
    }
    function latestOwnPosts(bundle) {
      const rows = [];
      bundle.sources.filter(source => life.Writing?.isOwnSource(source, bundle)).forEach(source => {
        const version = life.Writing.latestVersion(bundle, source.id);
        if (version) rows.push({ id: source.id, kind: 'source', title: source.title, body: version.contentText, updatedAt: version.importedAt, versionId: version.id });
      });
      return rows;
    }
    function blogPost(context, row) {
      const article = el('article', null, 'home-post');
      const target = row.kind === 'photo' ? { photoPostId: row.id } : { postId: row.id };
      if (row.kind === 'photo') article.dataset.photoPostId = row.id;
      else if (row.kind === 'source') { article.dataset.sourceId = row.id; article.dataset.versionId = row.versionId; }
      else article.dataset.postId = row.id;
      const open = () => row.kind === 'source' ? openVersion(context, row.versionId) : navigate('page', { pagePreview: false, searchTarget: target });
      const heading = el('h3');
      const label = String(row.title || '').trim() || (row.kind === 'photo' ? '제목 없는 글' : snippet(row.body) || row.attachments?.[0]?.title || '첨부한 글');
      const button = action(context, label, open, 'home-post-open' + (row.kind === 'plain' ? ' home-post-prose' : ''));
      button.dataset.focusKey = 'home:post:' + row.kind + ':' + row.id;
      heading.append(button); article.append(heading);
      if (row.kind !== 'plain' && row.body?.trim()) article.append(el('p', snippet(row.body), 'home-text home-post-excerpt'));
      const meta = el('p', null, 'life-meta home-post-meta');
      const date = new Date(row.updatedAt);
      if (Number.isFinite(date.getTime())) {
        const time = el('time', new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(date));
        time.dateTime = row.updatedAt; meta.append(time, document.createTextNode(' · '));
      }
      meta.append(document.createTextNode(row.kind === 'photo' ? '비공개 · 이 브라우저에 보관' : row.kind === 'source' ? '기록 글 · 비공개' : '첨부 글 · 비공개'));
      if (row.photos) meta.append(document.createTextNode(' · 사진 ' + row.photos + '장'));
      if (row.kind === 'plain' && row.attachments?.length) meta.append(document.createTextNode(' · 첨부 ' + row.attachments.length + '개'));
      article.append(meta);
      return article;
    }
    function renderPosts(context, area, bundle, workbenchResult, photoResult) {
      const rows = latestOwnPosts(bundle);
      let state = null;
      if (workbenchResult.status === 'fulfilled') {
        state = workbenchResult.value;
        if (state.workspaceId !== context.workspaceId) throw new Error('workspace_mismatch');
        life.Workbench.validate(state);
        rows.push(...(state.page.posts || []).filter(post => post.status === 'saved').map(post => ({ ...post, kind: 'plain' })));
      }
      if (photoResult.status === 'fulfilled') rows.push(...photoResult.value.filter(post => post.status === 'saved' && !post.archived).map(post => ({ ...post, kind: 'photo' })));
      const timestamp = row => Number.isFinite(Date.parse(row.updatedAt)) ? Date.parse(row.updatedAt) : 0;
      rows.sort((a, b) => timestamp(b) - timestamp(a) || (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id));
      rows.slice(0, 5).forEach(row => area.append(blogPost(context, row)));
      const failed = workbenchResult.status === 'rejected' || photoResult.status === 'rejected';
      if (failed) {
        const error = el('div', null, 'home-posts-error home-load-error'); error.setAttribute('role', 'status');
        error.append(el('p', rows.length ? '일부 글을 불러오지 못했습니다. 보이지 않는 글은 다시 불러와 확인해 주세요.' : '글 목록을 불러오지 못했습니다. 다시 불러와 확인해 주세요.', 'life-meta'));
        error.append(action(context, '다시 불러오기', async () => { context.surface.remove(); await render(); }));
        area.append(error);
      } else if (!rows.length) {
        const empty = el('div', null, 'home-first-post');
        empty.append(el('h3', '첫 글을 써보세요.'), el('p', '일상이나 생각을 자유롭게 남겨보세요. 글은 먼저 비공개로 저장됩니다.', 'home-text'));
        const start = action(context, '첫 글 쓰기', () => navigate('page', { pageCompose: true }), 'life-primary');
        start.id = 'homeFirstWrite'; empty.append(start); area.append(empty);
      }
      area.setAttribute('aria-busy', 'false');
      return state;
    }
    function recent(context, bundle) {
      const area = section(context, '최근 담은 기록', 'homeRecent', () => navigate('sources'));
      const sourceIds = new Set(bundle.sources.map(source => source.id)), latest = new Map();
      bundle.sourceVersions.forEach((version, order) => {
        if (!sourceIds.has(version.sourceId)) return;
        const prior = latest.get(version.sourceId);
        const time = Date.parse(version.importedAt) || 0;
        if (!prior || time >= prior.time) latest.set(version.sourceId, { version, time, order });
      });
      const list = [...latest.values()].sort((a, b) => b.time - a.time || b.order - a.order).slice(0, 3);
      if (!list.length) {
        const empty = el('div', null, 'home-empty');
        empty.append(el('p', '글이나 메모를 가져와 기록을 모아보세요.', 'life-meta'));
        const add = action(context, '자료 가져오기', () => navigate('import'), 'life-primary');
        add.id = 'homeFirstImport'; empty.append(add); area.append(empty);
      }
      list.forEach(({ version }) => area.append(record(context, sourceInfo(version.id, bundle), { date: true })));
      return area;
    }
    function books(context, state) {
      const area = section(context, '내 책', 'homeBooks', () => navigate('books', { bookList: true }));
      const activeBooks = (state.books || []).filter(book => !book.archived);
      if (!activeBooks.length) {
        const empty = el('div', null, 'home-empty');
        empty.append(el('p', '모아 둔 글로 책을 시작할 수 있습니다.', 'life-meta'), action(context, '책 만들기', () => navigate('books', { bookList: true })));
        area.append(empty);
      }
      activeBooks.slice(0, 3).forEach(book => {
        const chapters = book.chapters.filter(chapter => !chapter.archived);
        const open = chapterId => navigate('books', { book: { workspaceId: context.workspaceId, bookId: book.id, chapterId } });
        const row = el('article', null, 'home-book'); row.dataset.bookId = book.id;
        const button = action(context, '', () => open(), 'home-group');
        const copy = el('span', null, 'home-group-copy');
        copy.append(el('strong', book.title, 'home-clamp'), el('span', chapters.length + '개 장', 'life-meta'));
        button.append(life.Icons.create('book'), copy, life.Icons.create('chevron'));
        row.append(button);
        if (chapters.length) {
          const outline = el('details', null, 'home-book-outline');
          outline.append(el('summary', '목차'));
          chapters.forEach((chapter, index) => {
            const entry = action(context, (index + 1) + '. ' + chapter.title, () => open(chapter.id), 'home-chapter');
            entry.dataset.chapterId = chapter.id; outline.append(entry);
          });
          row.append(outline);
        }
        area.append(row);
      });
      return area;
    }
    function groups(context, state) {
      const area = section(context, '기록 묶음', 'homeGroups', () => navigate('activities'));
      if (!state.groups.length) area.append(el('p', '관련된 기록을 묶어 정리할 수 있습니다.', 'life-meta home-empty-note'));
      state.groups.slice(0, 2).forEach(group => {
        const button = action(context, '', () => navigate('activities', { groupId: group.id }), 'home-group');
        button.dataset.groupId = group.id;
        button.dataset.focusKey = 'home:group:' + group.id;
        const copy = el('span', null, 'home-group-copy');
        const missing = group.versionIds.filter(id => !sourceInfo(id)).length;
        copy.append(el('strong', group.title, 'home-clamp'), el('span', '연결한 기록 ' + group.versionIds.length + '개' + (missing ? ' · 원문 없음 ' + missing + '개' : ''), 'life-meta'));
        button.append(life.Icons.create('link'), copy, life.Icons.create('chevron'));
        area.append(button);
      });
      return area;
    }
    function pageSummary(context, page) {
      const area = section(context, '내 페이지', 'homePage');
      const actions = el('div', null, 'life-actions');
      actions.append(action(context, '편집', () => navigate('page', { pagePreview: false })), action(context, '미리보기', () => navigate('page', { pagePreview: true })));
      area.querySelector('.home-section-heading').append(actions);
      area.append(el('p', '비공개 미리보기', 'life-meta home-page-scope'));
      if (page.title !== '내 페이지') area.append(el('h3', page.title, 'home-page-title home-clamp'));
      if (page.showIntro && page.intro) area.append(el('p', snippet(page.intro), 'home-text home-clamp home-intro'));
      const entries = page.entries.filter(entry => entry.enabled && (entry.pinned || page.showRecent))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned));
      if (!entries.length) {
        area.append(el('p', page.entries.length ? '현재 표시할 항목이 없습니다.' : '보여줄 기록을 골라 내 페이지를 구성해 보세요.', 'life-meta home-empty-note'));
        return area;
      }
      const entry = entries[0], article = el('article', null, 'home-page-entry'); article.dataset.entryId = entry.id;
      const heading = el('div', null, 'home-entry-heading'); heading.append(el('h3', entry.title, 'home-clamp'));
      if (entry.pinned) { heading.append(life.Icons.create('bookmark'), el('span', '고정한 항목', 'life-sr-only')); }
      article.append(heading);
      const parts = entry.parts.filter(part => part.enabled);
      parts.slice(0, 2).forEach(part => {
        const info = sourceInfo(part.versionId);
        if (info) article.append(record(context, info, { body: entry.showBody, compact: true, focusScope: 'page:' + entry.id }));
        else { const missing = el('p', '연결된 원문 없음', 'life-meta home-missing'); missing.dataset.versionId = part.versionId; article.append(missing); }
      });
      if (parts.length > 2) article.append(el('p', '선택한 기록 ' + (parts.length - 2) + '개 더 있음', 'life-meta'));
      if (entry.showNote && entry.note) {
        const note = el('div', null, 'home-comment');
        note.append(el('p', '내 코멘트', 'life-meta'), el('p', snippet(entry.note), 'home-text home-clamp'));
        article.append(note);
      }
      area.append(article);
      if (entries.length > 1) area.append(el('p', '표시할 항목 ' + (entries.length - 1) + '개 더 있음', 'life-meta home-more-note'));
      return area;
    }
    async function render() {
      if (!alive()) return;
      const bundle = getBundle();
      if (!bundle) return;
      const surface = el('div', null, 'life-home'); surface.id = 'lifeHome';
      const context = { token: ++generation, workspaceId: bundle.workspaceId, surface, error: el('p', null, 'life-error home-error') };
      visible = true;
      context.error.hidden = true; context.error.setAttribute('role', 'alert');
      const lead = el('div', null, 'home-blog-lead');
      lead.append(el('p', '생각과 일상을 글로 남기는 내 공간입니다.', 'home-blog-description'), quickLinks(context));
      surface.append(lead, context.error);
      const composition = el('div', null, 'home-composition'); composition.id = 'homeComposition';
      const posts = section(context, '최근 글', 'homePosts');
      posts.setAttribute('aria-busy', 'true');
      const status = el('p', '저장한 글을 불러오는 중…', 'life-meta home-loading'); status.setAttribute('role', 'status');
      posts.append(status); composition.append(posts); composition.setAttribute('aria-busy', 'true');
      const materials = library(context, bundle);
      surface.append(composition, materials); host.append(surface);
      const results = await Promise.allSettled([
        storage.readWorkbench(context.workspaceId),
        storage.listPhotoPosts(context.workspaceId)
      ]);
      if (!showing(context)) return;
      // A late title or post list may grow above an already-open library.
      // Keep its active control at the same reading position without fixing heights.
      const focused = document.activeElement;
      const anchor = materials.contains(focused) ? { element: focused, top: focused.getBoundingClientRect().top } : null;
      status.remove();
      try {
        const state = renderPosts(context, posts, bundle, results[0], results[1]);
        if (state) {
          const page = state.page;
          if (page.title && page.title !== '내 페이지' && page.title !== '내 블로그') {
            const title = el('h2', page.title, 'home-blog-title');
            lead.prepend(title);
          }
          if (page.showIntro && page.intro) {
            lead.querySelector('.home-blog-description').textContent = snippet(page.intro);
          }
          if (state.groups.length) materials.append(groups(context, state));
          if (page.entries.length) materials.append(pageSummary(context, page));
          if ((state.books || []).some(book => !book.archived)) materials.append(books(context, state));
        }
      } catch (_) {
        posts.setAttribute('aria-busy', 'false');
        const error = el('div', null, 'home-posts-error home-load-error'); error.setAttribute('role', 'status');
        error.append(el('p', '글 목록을 불러오지 못했습니다. 가져온 기록은 자료실에서 열 수 있습니다.', 'life-meta'));
        error.append(action(context, '다시 불러오기', async () => { surface.remove(); await render(); }));
        posts.append(error);
      }
      composition.setAttribute('aria-busy', 'false');
      if (anchor && anchor.element.isConnected && document.activeElement === anchor.element) {
        const displacement = anchor.element.getBoundingClientRect().top - anchor.top;
        if (Math.abs(displacement) > 0.5) global.scrollBy({ top: displacement, left: 0, behavior: 'instant' });
      }
    }
    function leave() { generation += 1; visible = false; }
    function dispose() { leave(); disposed = true; }
    return Object.freeze({ render, leave, dispose });
  }
  life.HomeUI = Object.freeze({ create });
})(globalThis);

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
    const mediaUrls = new Set();
    let mediaObserver = null, mediaGeneration = 0;
    let listState = { workspaceId: null, tab: 'posts', query: '', searchExpanded: false, limit: 20 };
    const ROW_LIMIT = 20;
    const TAB_LABELS = { posts: '글', drafts: '초안', archive: '보관함' };
    function captureState() { return { ...listState, libraryOpen }; }
    function adoptState(workspaceId, incoming) {
      if (listState.workspaceId !== workspaceId) { listState = { workspaceId, tab: 'posts', query: '', searchExpanded: false, limit: ROW_LIMIT }; libraryOpen = false; }
      if (incoming?.workspaceId !== workspaceId) return;
      listState = { workspaceId, tab: Object.hasOwn(TAB_LABELS, incoming.tab) ? incoming.tab : 'posts',
        query: typeof incoming.query === 'string' ? incoming.query.slice(0, 1000) : '',
        searchExpanded: incoming.searchExpanded === true || (typeof incoming.query === 'string' && !!incoming.query.trim()),
        limit: Number.isSafeInteger(incoming.limit) ? Math.max(ROW_LIMIT, Math.min(incoming.limit, 10000)) : ROW_LIMIT };
      libraryOpen = incoming.libraryOpen === true;
    }
    function clearMedia() {
      mediaGeneration += 1; mediaObserver?.disconnect(); mediaObserver = null;
      mediaUrls.forEach(url => URL.revokeObjectURL(url)); mediaUrls.clear();
    }
    function initials(name) { return !name || name === '내 블로그' ? '나' : Array.from(String(name).replace(/\s+/g, '')).slice(0, 2).join(''); }
    function avatar(context) {
      const mark = el('span', initials(context.profile.name), 'home-avatar');
      mark.setAttribute('aria-hidden', 'true'); return mark;
    }
    function libraryAnchor(context) {
      const focused = document.activeElement;
      return context.materials?.contains(focused) ? { element: focused, top: focused.getBoundingClientRect().top } : null;
    }
    function restoreAnchor(anchor) {
      if (anchor && anchor.element.isConnected && document.activeElement === anchor.element) {
        const displacement = anchor.element.getBoundingClientRect().top - anchor.top;
        if (Math.abs(displacement) > 0.5) global.scrollBy({ top: displacement, left: 0, behavior: 'instant' });
      }
    }
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
      const prompt = action(context, '어떤 이야기를 남길까요?', () => navigate('page', { blogContext: true, pageCompose: true }), 'home-compose-prompt');
      prompt.dataset.focusKey = 'home:action:prompt';
      const write = action(context, '새 글 쓰기', () => navigate('page', { blogContext: true, pageCompose: true }), 'life-primary home-blog-write');
      write.dataset.homeDestination = 'write'; write.dataset.focusKey = 'home:action:write';
      nav.append(prompt, write); context.composeActions = nav;
      return nav;
    }
    function profileHeader(context) {
      const header = el('div', null, 'home-profile-bar');
      const profile = el('div', null, 'home-profile-open');
      profile.append(avatar(context), el('span', context.profile.name, 'home-author-name'));
      const copy = el('div', null, 'home-profile-copy');
      const intro = el('p', '', 'home-blog-description'); intro.hidden = true;
      copy.append(profile, intro);
      const manage = action(context, '프로필 편집', () => navigate('page', { blogContext: true, pageProfileEdit: true }), 'home-blog-action');
      manage.dataset.homeDestination = 'page'; manage.dataset.focusKey = 'home:action:page';
      header.append(copy, manage); return header;
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
      const preview = action(context, '선택 자료 페이지', () => navigate('page', { pagePreview: true }));
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
    function postCover(context, row, article, open) {
      if (row.kind !== 'photo' || !row.photos) return;
      const epoch = mediaGeneration;
      const frame = action(context, '', open, 'home-post-media');
      frame.setAttribute('aria-label', '사진이 있는 글 열기'); frame.dataset.focusKey = 'home:photo:' + row.id;
      frame.setAttribute('aria-busy', 'true');
      const image = el('img', null, 'home-post-cover'); image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
      const status = el('span', '사진 불러오는 중…', 'life-meta home-photo-loading');
      frame.append(status); article.append(frame);
      const current = () => showing(context) && epoch === mediaGeneration && frame.isConnected;
      const removeCover = () => {
        if (!current()) return;
        frame.setAttribute('aria-busy', 'false');
        frame.replaceChildren(el('span', '사진을 표시하지 못했어요. 글을 열어 확인해 주세요.', 'life-meta home-photo-error'));
      };
      const readCover = async () => {
        if (!current()) return;
        try {
          const doc = await storage.readPhotoPost(context.workspaceId, row.id);
          if (!current()) return;
          if (doc.status !== 'saved' || doc.archived !== !!row.archived) throw new Error('post_changed');
          const embedded = doc.ops.find(op => op.insert?.photo)?.insert.photo;
          const photo = doc.photos.find(item => item.id === embedded?.id);
          if (!photo?.blob) throw new Error('photo_missing');
          const url = URL.createObjectURL(photo.blob); mediaUrls.add(url);
          image.alt = embedded.alt || embedded.caption || '';
          image.addEventListener('load', () => { if (current()) frame.setAttribute('aria-busy', 'false'); }, { once: true });
          image.addEventListener('error', () => {
            removeCover(); URL.revokeObjectURL(url); mediaUrls.delete(url);
          }, { once: true });
          image.src = url; frame.replaceChildren(image);
        } catch (_) { removeCover(); }
      };
      if (typeof global.IntersectionObserver === 'function') {
        if (!mediaObserver) mediaObserver = new global.IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            mediaObserver?.unobserve(entry.target);
            const loadCover = entry.target._homeLoadCover;
            delete entry.target._homeLoadCover; loadCover?.();
          });
        }, { rootMargin: '320px 0px' });
        frame._homeLoadCover = readCover; mediaObserver.observe(frame);
      } else Promise.resolve().then(readCover);
    }
    function modifiedDate(value, prefix = '수정 ') {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return null;
      const options = { month: 'long', day: 'numeric' };
      if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
      const time = el('time', prefix + new Intl.DateTimeFormat('ko-KR', options).format(date));
      time.dateTime = value;
      time.title = prefix + new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
      return time;
    }
    function blogPost(context, row) {
      const article = el('article', null, 'home-post'); article.dataset.homeKind = row.kind;
      const target = row.kind === 'photo' ? { photoPostId: row.id } : { postId: row.id };
      if (row.kind === 'photo') article.dataset.photoPostId = row.id;
      else if (row.kind === 'source') { article.dataset.sourceId = row.id; article.dataset.versionId = row.versionId; }
      else article.dataset.postId = row.id;
      const open = () => row.kind === 'source' ? openVersion(context, row.versionId) : navigate('page', { blogContext: true, pagePreview: false, searchTarget: target });
      const meta = el('p', null, 'life-meta home-post-meta');
      const time = modifiedDate(row.updatedAt, row.kind === 'source' ? '저장 ' : '수정 ');
      if (time) meta.append(time, document.createTextNode(' · '));
      meta.append(document.createTextNode(row.kind === 'photo' ? '비공개 · 이 브라우저에 보관' : row.kind === 'source' ? '기록 글 · 비공개' : '첨부 글 · 비공개'));
      article.append(meta);
      const content = el('div', null, 'home-post-content'), heading = el('h3');
      const label = String(row.title || '').trim() || (snippet(row.body) || row.attachments?.[0]?.title || '사진이 있는 글');
      const button = action(context, label, open, 'home-post-open' + (row.kind === 'plain' || !String(row.title || '').trim() ? ' home-post-prose' : ''));
      button.dataset.focusKey = 'home:post:' + row.kind + ':' + row.id;
      heading.append(button); content.append(heading);
      if (row.kind !== 'plain' && String(row.title || '').trim() && row.body?.trim()) content.append(el('p', snippet(row.body), 'home-text home-post-excerpt'));
      if (row.kind === 'plain' && row.attachments?.length) {
        const attached = el('p', row.attachments.map(item => item.title).join(' · '), 'home-post-attachments');
        content.append(attached);
      }
      article.append(content); postCover(context, row, article, open);
      const footer = el('div', null, 'home-post-footer');
      const read = action(context, '글 읽기', open, 'home-post-read'); read.dataset.focusKey = 'home:read:' + row.kind + ':' + row.id;
      read.append(life.Icons.create('arrow'));
      footer.append(read); article.append(footer);
      return article;
    }
    function openRow(context, row) {
      if (row.kind === 'source-draft') return navigate('write', { writing: { stageId: row.id } });
      if (row.kind === 'plain-draft') return navigate('page', { blogContext: true, pageDraftId: row.id });
      return navigate('page', { blogContext: true, pagePreview: false, searchTarget: { photoPostId: row.id } });
    }
    function draftRow(context, row) {
      const article = el('article', null, 'home-draft');
      article.dataset.draftId = row.id; article.dataset.draftKind = row.kind;
      const open = action(context, '', () => openRow(context, row), 'home-draft-open');
      open.dataset.focusKey = 'home:draft:' + row.kind + ':' + row.id;
      const copy = el('span', null, 'home-draft-copy');
      copy.append(el('span', row.editing === true ? '기존 글 수정 중' : row.editing === false ? '새 글 초안' : '작성 중인 글', 'life-meta'),
        el('strong', String(row.title || '').trim() || snippet(row.body) || '내용을 기다리는 초안'));
      if (row.title?.trim() && row.body?.trim()) copy.append(el('span', snippet(row.body), 'home-draft-excerpt'));
      const time = modifiedDate(row.updatedAt);
      if (time) { time.className = 'life-meta'; copy.append(time); }
      open.append(copy, el('span', '이어쓰기', 'home-draft-resume')); article.append(open); return article;
    }
    function resultRows(context) {
      const rows = latestOwnPosts(getBundle()), errors = [];
      context.workbenchState = null;
      const { results } = context;
      const read = (key, label, use) => {
        const result = results[key];
        if (result?.status === 'fulfilled') { try { use(result.value); } catch (_) { errors.push({ key, label }); } }
        else errors.push({ key, label });
      };
      read('workbench', '기존 글', state => {
        if (state.workspaceId !== context.workspaceId) throw new Error('workspace_mismatch');
        life.Workbench.validate(state); context.workbenchState = state;
        rows.push(...(state.page.posts || []).filter(post => post.status === 'saved').map(post => ({ ...post, kind: 'plain', tab: 'posts' })));
        const title = String(state.page.title || '').trim();
        context.profile.name = title && title !== '내 페이지' ? title : '내 블로그';
        context.surface.querySelectorAll('.home-author-name').forEach(node => { node.textContent = context.profile.name; });
        context.surface.querySelectorAll('.home-avatar').forEach(node => { node.textContent = initials(context.profile.name); });
        const intro = context.surface.querySelector('.home-blog-description');
        intro.textContent = state.page.showIntro ? snippet(state.page.intro) : '';
        intro.hidden = !intro.textContent;
      });
      read('photo', '이 브라우저의 글·초안·보관함', posts => {
        if (!Array.isArray(posts)) throw new Error('invalid_posts');
        rows.push(...posts.map(post => ({ ...post, kind: post.status === 'draft' ? 'photo-draft' : 'photo',
          tab: post.archived ? 'archive' : post.status === 'draft' ? 'drafts' : 'posts', editing: context.photoDrafts.get(post.id) })));
      });
      read('plainDrafts', '첨부 글 초안', drafts => {
        life.PagePosts.validate(drafts.posts);
        rows.push(...drafts.posts.map(post => ({ ...post, kind: 'plain-draft', tab: 'drafts', editing: !!post.replaces })));
      });
      read('sourceDrafts', '기록 글 초안', stages => {
        rows.push(...stages.filter(stage => life.Writing?.isDraft(stage) && stage.state === 'draft').map(stage => ({ ...stage,
          id: stage.stageId, body: stage.text, kind: 'source-draft', tab: 'drafts', editing: !!stage.sourceId })));
      });
      context.profileStatus.hidden = !!context.workbenchState;
      rows.forEach(row => { if (!row.tab) row.tab = 'posts'; });
      const timestamp = row => Number.isFinite(Date.parse(row.updatedAt)) ? Date.parse(row.updatedAt) : 0;
      rows.sort((a, b) => timestamp(b) - timestamp(a) || (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id));
      return { rows, errors };
    }
    function listControls(context, area) {
      const controls = el('div', null, 'home-list-controls');
      const tabs = el('div', null, 'home-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '내 글 상태');
      for (const [key, label] of Object.entries(TAB_LABELS)) {
        const button = action(context, label, () => {
          listState.tab = key; listState.limit = ROW_LIMIT; updateList(context, true);
        }, 'home-tab');
        button.id = 'homeTab-' + key; button.dataset.homeTab = key; button.dataset.focusKey = 'home:tab:' + key;
        button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'homePostList');
        button.addEventListener('keydown', event => {
          const keys = Object.keys(TAB_LABELS), at = keys.indexOf(listState.tab);
          const next = event.key === 'ArrowRight' ? keys[(at + 1) % keys.length] : event.key === 'ArrowLeft' ? keys[(at + keys.length - 1) % keys.length] : event.key === 'Home' ? keys[0] : event.key === 'End' ? keys[keys.length - 1] : null;
          if (!next) return; event.preventDefault(); listState.tab = next; listState.limit = ROW_LIMIT; updateList(context, true); tabs.querySelector('[data-home-tab="' + next + '"]').focus({ preventScroll: true });
        });
        tabs.append(button);
      }
      const toolbar = el('div', null, 'home-list-toolbar');
      const toggle = iconAction(context, '내 글 검색 열기', 'search', () => {
        if (listState.query.trim()) {
          context.searchInput.focus({ preventScroll: true }); return;
        }
        listState.searchExpanded = !listState.searchExpanded;
        syncSearch(context);
        (listState.searchExpanded ? context.searchInput : toggle).focus({ preventScroll: true });
      });
      toggle.classList.add('home-search-toggle'); toggle.dataset.focusKey = 'home:search-toggle';
      toggle.setAttribute('aria-controls', 'homeSearchPanel');
      toolbar.append(tabs, toggle);
      const panel = el('div', null, 'home-search-panel'); panel.id = 'homeSearchPanel';
      const search = el('div', null, 'home-search');
      const label = el('label', '내 글 검색', 'life-sr-only'); label.htmlFor = 'homePostSearch';
      const input = el('input'); input.type = 'search'; input.id = 'homePostSearch'; input.placeholder = '내 글 검색'; input.maxLength = 1000;
      input.value = listState.query; input.dataset.focusKey = 'home:search'; input.autocomplete = 'off';
      let composing = false;
      const apply = () => {
        if (composing || !showing(context)) return;
        listState.query = input.value; listState.searchExpanded = true; listState.limit = ROW_LIMIT; updateList(context, true);
      };
      input.addEventListener('compositionstart', () => { composing = true; });
      input.addEventListener('compositionend', () => { composing = false; apply(); });
      input.addEventListener('input', apply);
      input.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || listState.query.trim() || composing) return;
        event.preventDefault(); listState.searchExpanded = false; syncSearch(context); toggle.focus({ preventScroll: true });
      });
      const clear = action(context, '검색어 지우기', () => {
        listState.query = ''; listState.limit = ROW_LIMIT; input.value = ''; updateList(context, true);
        (context.controls.hidden ? context.list.querySelector('#homeFirstWrite') : input)?.focus({ preventScroll: true });
      }, 'home-search-clear'); clear.dataset.focusKey = 'home:search-clear';
      search.append(label, life.Icons.create('search'), input, clear);
      const scope = el('p', '', 'life-meta home-search-scope');
      panel.append(search, scope); controls.append(toolbar, panel); area.append(controls);
      context.tabs = tabs; context.controls = controls; context.searchPanel = panel; context.searchToggle = toggle;
      context.searchInput = input; context.searchScope = scope; context.searchClear = clear; syncSearch(context);
      context.list = el('div', null, 'home-post-list'); context.list.id = 'homePostList'; context.list.setAttribute('role', 'tabpanel'); context.list.tabIndex = -1;
      context.feedback = el('p', null, 'life-sr-only'); context.feedback.setAttribute('role', 'status'); context.feedback.setAttribute('aria-live', 'polite');
      area.append(context.list, context.feedback);
    }
    function syncSearch(context) {
      const expanded = listState.searchExpanded || !!listState.query.trim();
      context.searchPanel.hidden = !expanded;
      context.searchToggle.setAttribute('aria-expanded', String(expanded));
      const label = listState.query.trim() ? '검색어 수정' : expanded ? '내 글 검색 닫기' : '내 글 검색 열기';
      context.searchToggle.setAttribute('aria-label', label); context.searchToggle.title = label;
      context.searchToggle.querySelector('.life-tooltip').textContent = label;
      context.searchScope.textContent = TAB_LABELS[listState.tab] + ' 탭의 제목과 본문에서 찾습니다. 최근 수정·저장 순입니다.';
      context.searchInput.placeholder = TAB_LABELS[listState.tab] + '에서 검색';
      context.searchClear.hidden = !listState.query;
    }
    function matchesQuery(row) {
      const query = listState.query.trim().toLocaleLowerCase('ko-KR');
      return !query || [row.title, row.body, ...(Array.isArray(row.attachments) ? row.attachments.map(item => item.title) : [])]
        .filter(Boolean).join('\n').toLocaleLowerCase('ko-KR').includes(query);
    }
    function anchorRow(context, requested) {
      return [...context.list.querySelectorAll('.home-post')].find(node => node.dataset.homeKind === requested.kind &&
        (requested.kind === 'photo' ? node.dataset.photoPostId : requested.kind === 'plain' ? node.dataset.postId : node.dataset.sourceId) === requested.id);
    }
    function focusAnchor(context, requested) {
      const rows = resultRows(context).rows.filter(row => row.tab === listState.tab && matchesQuery(row));
      const index = rows.findIndex(row => row.kind === requested.kind && row.id === requested.id);
      if (index >= listState.limit) { listState.limit = Math.ceil((index + 1) / ROW_LIMIT) * ROW_LIMIT; updateList(context); }
      const row = anchorRow(context, requested);
      if (!row) return false;
      row.querySelector('.home-post-open')?.focus({ preventScroll: true }); row.scrollIntoView({ block: 'start', behavior: 'instant' }); return true;
    }
    function updateList(context, userAction = false) {
      if (!showing(context)) return;
      if (userAction) context.area.style.minHeight = '';
      clearMedia();
      const { rows, errors } = resultRows(context), query = listState.query.trim().toLocaleLowerCase('ko-KR');
      if (!rows.length && !errors.length && !query) listState.tab = 'posts';
      context.controls.hidden = !rows.length && !errors.length && !query;
      syncSearch(context);
      context.resumeRow = rows.find(row => row.tab === 'drafts') || null;
      context.resume.hidden = !context.resumeRow || listState.tab !== 'posts' || !!query;
      if (context.resumeRow) context.resumeLabel.textContent = String(context.resumeRow.title || '').trim() || snippet(context.resumeRow.body) || '작성 중인 초안';
      const counts = Object.fromEntries(Object.keys(TAB_LABELS).map(tab => [tab, rows.filter(row => row.tab === tab).length]));
      for (const button of context.tabs.children) {
        const tab = button.dataset.homeTab, selected = tab === listState.tab;
        button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
        button.textContent = TAB_LABELS[tab] + (counts[tab] && tab !== 'posts' ? ' ' + counts[tab] : '');
      }
      context.composeActions.hidden = !errors.length && counts.posts === 0 && listState.tab === 'posts' && !query;
      context.composeActions.querySelector('.home-blog-write').dataset.focusKey = context.composeActions.hidden ? 'home:action:hidden-write' : 'home:action:write';
      context.composeActions.querySelector('.home-compose-prompt').dataset.focusKey = context.composeActions.hidden ? 'home:action:hidden-prompt' : 'home:action:prompt';
      context.list.setAttribute('aria-labelledby', 'homeTab-' + listState.tab);
      const matched = rows.filter(row => row.tab === listState.tab && matchesQuery(row));
      const fragment = document.createDocumentFragment();
      if (listState.tab === 'archive') fragment.append(el('p', '이 브라우저에서 보관한 글입니다. 글을 열어 목록으로 복원할 수 있어요.', 'life-meta home-archive-note'));
      const applicable = errors.filter(error => error.key === 'photo' || (listState.tab === 'posts' ? error.key === 'workbench' : listState.tab === 'drafts' ? ['plainDrafts', 'sourceDrafts'].includes(error.key) : false));
      if (applicable.length) {
        const error = el('div', null, 'home-posts-error home-load-error'); error.setAttribute('role', 'status');
        error.append(el('p', applicable.map(item => item.label).join(', ') + '을 불러오지 못했어요. 확인된 글만 표시합니다.', 'life-meta'),
          action(context, '다시 불러오기', async () => { await load(context, applicable.map(item => item.key)); })); fragment.append(error);
      }
      matched.slice(0, listState.limit).forEach(row => fragment.append(row.tab === 'drafts' || row.kind === 'photo-draft' ? draftRow(context, row) : blogPost(context, row)));
      if (!matched.length && !applicable.length) {
        const empty = el('div', null, 'home-first-post');
        const title = query ? '일치하는 내 글이 없어요.' : listState.tab === 'drafts' ? '작성 중인 초안이 없어요.' : listState.tab === 'archive' ? '보관한 글이 없어요.' : '첫 글을 써보세요.';
        empty.append(el('h3', title), el('p', query ? '현재 탭의 제목과 본문에서 찾았어요. 검색어나 탭을 바꿔보세요.' : listState.tab === 'drafts' ? '작성 중 닫은 글은 여기에 남습니다.' : listState.tab === 'archive' ? '보관을 지원하는 글만 여기에 표시됩니다.' : '한 문장부터 시작해도 좋아요. 먼저 비공개로 저장됩니다.', 'home-text'));
        if (query) empty.append(action(context, '검색어 지우기', () => { listState.query = ''; listState.limit = ROW_LIMIT; const input = context.surface.querySelector('#homePostSearch'); input.value = ''; updateList(context, true); (context.controls.hidden ? context.list.querySelector('#homeFirstWrite') : input)?.focus({ preventScroll: true }); }));
        else if (listState.tab === 'posts') { const start = action(context, '첫 글 쓰기', () => navigate('page', { blogContext: true, pageCompose: true }), 'life-primary'); start.id = 'homeFirstWrite'; start.dataset.homeDestination = 'write'; start.dataset.focusKey = 'home:action:write'; empty.append(start); }
        fragment.append(empty);
      }
      if (matched.length > listState.limit) {
        const more = action(context, '글 20개 더 보기', () => {
          const limit = listState.limit; listState.limit += ROW_LIMIT; updateList(context, true);
          const next = context.list.querySelectorAll('.home-post,.home-draft')[limit];
          next?.querySelector('.home-post-open,.home-draft-open')?.focus({ preventScroll: true });
        }, 'home-more'); more.dataset.focusKey = 'home:more'; fragment.append(more);
      }
      const focused = document.activeElement, focusKey = context.list.contains(focused) ? focused?.dataset.focusKey : null;
      context.list.replaceChildren(fragment);
      if (focusKey) [...context.list.querySelectorAll('[data-focus-key]')].find(item => item.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
      context.feedback.textContent = applicable.length ? '일부 목록을 확인하지 못했어요.' : TAB_LABELS[listState.tab] + ' ' + matched.length + '개' + (query ? ' 검색됨' : '');
      context.area.setAttribute('aria-busy', 'false');
      void enrichDrafts(context);
    }
    async function load(context, keys = ['workbench', 'photo', 'plainDrafts', 'sourceDrafts']) {
      const read = { workbench: () => storage.readWorkbench(context.workspaceId), photo: () => storage.listPhotoPosts(context.workspaceId),
        plainDrafts: () => storage.readPageDrafts(context.workspaceId), sourceDrafts: () => storage.listStages(context.workspaceId) };
      context.area.setAttribute('aria-busy', 'true');
      const results = await Promise.allSettled(keys.map(key => Promise.resolve().then(read[key])));
      if (!showing(context)) return;
      keys.forEach((key, index) => { context.results[key] = results[index]; });
      const anchor = libraryAnchor(context);
      const libraryTop = anchor ? context.materials.getBoundingClientRect().top + global.scrollY : null;
      updateList(context); reconcileLibrary(context);
      // At the top of the document a shrinking composer cannot be corrected by
      // scrolling upward. Keep its former space while a library entry has focus.
      if (anchor && document.activeElement === anchor.element && anchor.element.isConnected) {
        const shrink = libraryTop - (context.materials.getBoundingClientRect().top + global.scrollY);
        if (shrink > 0.5) context.area.style.minHeight = Math.ceil(context.area.getBoundingClientRect().height + shrink) + 'px';
      }
      restoreAnchor(anchor);
    }
    function reconcileLibrary(context) {
      const state = context.workbenchState;
      if (!state || context.libraryState === state) return;
      context.libraryState = state;
      context.materials.querySelectorAll('#homeGroups, #homeBooks').forEach(node => node.remove());
      if (state.groups.length) context.materials.append(groups(context, state));
      if ((state.books || []).some(book => !book.archived)) context.materials.append(books(context, state));
    }
    async function enrichDrafts(context) {
      if (!showing(context) || listState.tab !== 'drafts' || context.draftLoading || context.results.photo?.status !== 'fulfilled' || !Array.isArray(context.results.photo.value)) return;
      const drafts = context.results.photo.value.filter(item => item.status === 'draft' && !item.archived && !context.photoDrafts.has(item.id)).slice(0, listState.limit);
      if (!drafts.length) return;
      context.draftLoading = true;
      try {
        for (let offset = 0; offset < drafts.length; offset += 4) {
          if (!showing(context) || listState.tab !== 'drafts') return;
          const batch = drafts.slice(offset, offset + 4);
          const details = await Promise.allSettled(batch.map(row => storage.readPhotoPost(context.workspaceId, row.id)));
          if (!showing(context)) return;
          batch.forEach((row, index) => { context.photoDrafts.set(row.id, details[index].status === 'fulfilled' ? !!details[index].value.replaces : null); });
        }
        if (showing(context) && listState.tab === 'drafts') updateList(context);
      } finally { context.draftLoading = false; }
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
    async function render(options = {}) {
      if (!alive()) return;
      const bundle = getBundle();
      if (!bundle) return;
      adoptState(bundle.workspaceId, options.homeState);
      clearMedia();
      const surface = el('div', null, 'life-home'); surface.id = 'lifeHome';
      const context = { token: ++generation, workspaceId: bundle.workspaceId, surface, profile: { name: '내 블로그' },
        results: {}, photoDrafts: new Map(), draftRead: 0, error: el('p', null, 'life-error home-error') };
      visible = true;
      context.error.hidden = true; context.error.setAttribute('role', 'alert');
      const lead = el('div', null, 'home-blog-lead');
      context.profileStatus = el('div', null, 'home-profile-status home-load-error'); context.profileStatus.hidden = true;
      context.profileStatus.setAttribute('role', 'status');
      context.profileStatus.append(el('p', '프로필과 기존 글 정보를 불러오지 못했어요.', 'life-meta'),
        action(context, '프로필 다시 불러오기', () => load(context, ['workbench'])));
      lead.append(profileHeader(context), context.profileStatus, quickLinks(context));
      context.resume = action(context, '', () => context.resumeRow && openRow(context, context.resumeRow), 'home-resume');
      context.resume.dataset.focusKey = 'home:resume'; context.resume.hidden = true;
      context.resumeLabel = el('span', null, 'home-resume-title');
      context.resume.append(el('span', '작성하던 글', 'life-meta'), context.resumeLabel, el('span', '이어쓰기', 'home-draft-resume'));
      lead.append(context.resume); surface.append(lead, context.error);
      const composition = el('div', null, 'home-composition'); composition.id = 'homeComposition'; composition.setAttribute('aria-busy', 'true');
      const posts = section(context, '내 글', 'homePosts'); posts.querySelector('.home-section-heading').classList.add('life-sr-only');
      context.area = posts; listControls(context, posts);
      const loading = el('p', '글과 초안을 불러오는 중…', 'life-meta home-loading'); loading.setAttribute('role', 'status'); context.list.append(loading);
      posts.setAttribute('aria-busy', 'true'); composition.append(posts);
      const materials = library(context, bundle); context.materials = materials;
      surface.append(composition, materials); host.append(surface);
      await load(context);
      if (!showing(context)) return;
      composition.setAttribute('aria-busy', 'false');
      const requested = options.homeAnchor;
      if (requested && ['photo', 'plain', 'source'].includes(requested.kind) && typeof requested.id === 'string') {
        if (!focusAnchor(context, requested) && requested.committed) {
          const saved = resultRows(context).rows.find(row => row.kind === requested.kind && row.id === requested.id);
          if (saved && (listState.query.trim() || listState.tab !== saved.tab)) {
            const notice = el('div', null, 'home-saved-filter-notice'); notice.setAttribute('role', 'status');
            notice.append(el('p', '저장한 글이 현재 검색 조건이나 탭에 포함되지 않아 보이지 않아요.', 'life-meta'),
              action(context, listState.query.trim() ? '검색어 지우고 저장한 글 보기' : '저장한 글에서 보기', () => {
                listState.tab = saved.tab; listState.query = ''; listState.limit = ROW_LIMIT;
                context.surface.querySelector('#homePostSearch').value = ''; updateList(context, true); notice.remove(); focusAnchor(context, requested);
              }));
            context.list.before(notice);
          }
        }
      }
    }
    function leave() { generation += 1; visible = false; clearMedia(); }
    function dispose() { leave(); disposed = true; }
    return Object.freeze({ render, leave, dispose, captureState });
  }
  life.HomeUI = Object.freeze({ create });
})(globalThis);

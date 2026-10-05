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
  function create({ storage, core, host, getBundle, navigate, openSource, isDisposed = () => false, announce = () => {} }) {
    let disposed = false, generation = 0, visible = false;
    const alive = () => !disposed && !isDisposed();
    const showing = context => alive() && visible && context.token === generation && getBundle()?.workspaceId === context.workspaceId && context.surface.parentNode === host;
    function action(context, label, task, className = '', { keepFocus = false } = {}) {
      const button = el('button', label, 'life-button' + (className ? ' ' + className : ''));
      button.type = 'button';
      let running = false;
      button.addEventListener('click', async () => {
        if (running || !showing(context) || !button.isConnected) return;
        running = true;
        // Source navigation captures the focused result before removing this view.
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
      const normalized = text.replace(/\s+/g, ' ').trim();
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
      const nav = el('nav', null, 'home-shortcuts'); nav.setAttribute('aria-label', '빠른 진입');
      [['기록', 'quote', 'sources'], ['내 페이지', 'user', 'page'], ['도구', 'workspace', 'tools']].forEach(([label, glyph, mode]) => {
        const button = action(context, '', () => navigate(mode, mode === 'page' ? { pagePreview: false } : undefined), 'home-shortcut');
        button.dataset.homeDestination = mode;
        button.append(life.Icons.create(glyph), el('span', label)); nav.append(button);
      });
      return nav;
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
    function groups(context, state) {
      const area = section(context, '기록 묶음', 'homeGroups', () => navigate('activities'));
      if (!state.groups.length) area.append(el('p', '관련된 기록을 묶어 정리할 수 있습니다.', 'life-meta home-empty-note'));
      state.groups.slice(0, 2).forEach(group => {
        const button = action(context, '', () => navigate('activities', { groupId: group.id }), 'home-group');
        button.dataset.groupId = group.id;
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
      surface.append(quickLinks(context), context.error, recent(context, bundle));
      const composition = el('div', null, 'home-composition'); composition.id = 'homeComposition';
      const status = el('p', '내 페이지와 기록 묶음 불러오는 중…', 'life-meta home-loading'); status.setAttribute('role', 'status');
      composition.append(status); composition.setAttribute('aria-busy', 'true'); surface.append(composition); host.append(surface);
      try {
        const state = await storage.readWorkbench(context.workspaceId);
        if (!showing(context)) return;
        if (state.workspaceId !== context.workspaceId) throw new Error('workspace_mismatch');
        life.Workbench.validate(state);
        composition.replaceChildren(groups(context, state), pageSummary(context, state.page));
        composition.setAttribute('aria-busy', 'false');
      } catch (_) {
        if (!showing(context)) return;
        composition.setAttribute('aria-busy', 'false');
        const error = el('div', null, 'home-load-error'); error.setAttribute('role', 'status');
        error.append(el('p', '내 페이지와 기록 묶음을 불러오지 못했습니다. 기록은 계속 열 수 있습니다.', 'life-meta'));
        error.append(action(context, '다시 불러오기', async () => { surface.remove(); await render(); }));
        composition.replaceChildren(error);
      }
    }
    function leave() { generation += 1; visible = false; }
    function dispose() { leave(); disposed = true; }
    return Object.freeze({ render, leave, dispose });
  }
  life.HomeUI = Object.freeze({ create });
})(globalThis);

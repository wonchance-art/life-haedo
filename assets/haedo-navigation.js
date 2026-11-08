/* Shared destinations and navigation. Existing local icons; no account storage. */
(function (root) {
  'use strict';
  if (root.HaedoNavigation) return;
  // 2026-11-02 soft redesign: 뉴스·일정·자료·설정. The former home/tools IDs stay
  // as aliases of schedule so old links and saved addresses keep opening.
  const sections = [
    { id: 'news', label: '뉴스', glyph: 'news', href: 'index.html?section=news' },
    { id: 'schedule', label: '일정', glyph: 'calendar', href: 'index.html' },
    { id: 'records', label: '자료', glyph: 'book', href: 'index.html?section=records' },
    { id: 'manage', label: '설정', glyph: 'settings', href: 'index.html?section=manage' }
  ];
  const aliases = Object.freeze({ home: 'schedule', tools: 'schedule' });
  const compose = Object.freeze({ id: 'compose', label: '글쓰기', href: 'index.html?compose=1' });
  function normalizeSection(id) {
    const value = Object.hasOwn(aliases, id) ? aliases[id] : id;
    return sections.some(section => section.id === value) ? value : null;
  }
  const viewSections = Object.freeze({
    home: 'schedule', blog: 'schedule', 'account-blog': 'schedule', tools: 'schedule', 'annual-plan': 'schedule', time: 'schedule',
    // 일정's calendar units (tools is Y): 분기·월·주·일.
    quarter: 'schedule', month: 'schedule', week: 'schedule', day: 'schedule',
    'public-cover': 'manage', 'public-pages': 'manage',
    'external-discovery': 'news', interests: 'news',
    sources: 'records', topics: 'records', source: 'records', 'source-edit': 'records',
    collection: 'records', import: 'records', batch: 'records', write: 'records',
    activities: 'records', page: 'records', related: 'records', find: 'records',
    'naver-blog': 'records', 'naver-capture': 'records', 'obsidian-update': 'records',
    'source-trash': 'records', discover: 'records', reflection: 'records', books: 'records',
    manage: 'manage', backup: 'manage', sync: 'manage', transfer: 'manage', 'workbench-backup': 'manage', preservation: 'manage'
  });
  function getSectionForView(view) {
    return Object.hasOwn(viewSections, view) ? viewSections[view] : null;
  }
  const planningDestinations = [
    { id: 'annual-plan', label: '연간 계획', href: 'index.html?section=schedule&view=annual-plan' },
    { id: 'goals', label: '목표', href: 'goals.html' },
    { id: 'habits', label: '습관', href: 'habits.html' },
    // 일정 통합 정리(2026-11-08): 연표 목록도 같은 탭 줄에 둔다. 연표 편집기는 목록에서 연다.
    { id: 'workspace', label: '연표', href: 'workspace.html' }
  ];
  function createPlanningNavigation({ current, beforeNavigate, onError } = {}) {
    if (beforeNavigate && typeof onError !== 'function') throw new TypeError('A navigation error handler is required.');
    const nav = root.document.createElement('nav');
    nav.className = 'haedo-planning-nav'; nav.setAttribute('aria-label', '계획');
    let pending = false;
    for (const item of planningDestinations) {
      const link = root.document.createElement('a');
      link.href = item.href; link.textContent = item.label; link.dataset.planningDestination = item.id;
      if (current === item.id) link.setAttribute('aria-current', 'page');
      link.addEventListener('click', async event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (current === item.id) { event.preventDefault(); return; }
        if (!beforeNavigate) return;
        event.preventDefault();
        if (pending) return;
        pending = true; nav.setAttribute('aria-busy', 'true');
        try {
          if (await beforeNavigate({ id: item.id, href: item.href }) !== false && nav.isConnected) root.location.assign(item.href);
        } catch (error) { onError(error); }
        finally { pending = false; nav.removeAttribute('aria-busy'); }
      });
      nav.append(link);
    }
    return nav;
  }
  const handlers = new Set();
  const indicators = [];
  const preference = root.matchMedia?.('(prefers-reduced-motion: reduce)');
  function cancelIndicator(state) {
    state.animation?.cancel();
    state.animation = null;
  }
  function placeIndicator(state, animate) {
    const { nav, indicator } = state;
    const selected = nav.querySelector('.haedo-nav-link[aria-current=page]');
    const navRect = nav.getBoundingClientRect();
    const nextRect = selected?.getBoundingClientRect();
    if (root.document.hidden || !nextRect?.width || !nextRect.height || !navRect.width || !navRect.height) {
      cancelIndicator(state);
      delete nav.dataset.haedoIndicatorReady;
      return;
    }
    // Sample the currently painted pill before cancelling a rapid, unfinished move.
    const previousRect = nav.hasAttribute('data-haedo-indicator-ready') ? indicator.getBoundingClientRect() : null;
    cancelIndicator(state);
    indicator.style.left = `${nextRect.left - navRect.left - nav.clientLeft + nav.scrollLeft}px`;
    indicator.style.top = `${nextRect.top - navRect.top - nav.clientTop + nav.scrollTop}px`;
    indicator.style.width = `${nextRect.width}px`;
    indicator.style.height = `${nextRect.height}px`;
    indicator.style.borderRadius = root.getComputedStyle(selected).borderRadius;
    nav.dataset.haedoIndicatorReady = 'true';
    if (!animate || preference?.matches || typeof indicator.animate !== 'function' || !previousRect?.width ||
        (Math.abs(previousRect.left - nextRect.left) < .5 && Math.abs(previousRect.top - nextRect.top) < .5 &&
         Math.abs(previousRect.width - nextRect.width) < .5 && Math.abs(previousRect.height - nextRect.height) < .5)) return;
    try {
      const animation = indicator.animate([
        { transform: `translate(${previousRect.left - nextRect.left}px, ${previousRect.top - nextRect.top}px) scale(${previousRect.width / nextRect.width}, ${previousRect.height / nextRect.height})` },
        { transform: 'none' }
      ], { duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
      state.animation = animation;
      const release = () => { if (state.animation === animation) state.animation = null; };
      animation.finished?.then(release, release);
    } catch (_) { /* A selected link remains visible when WAAPI is unavailable. */ }
  }
  let layoutFrame = null;
  function refreshIndicators() {
    if (layoutFrame !== null) return;
    layoutFrame = root.requestAnimationFrame(() => {
      layoutFrame = null;
      indicators.forEach(state => placeIndicator(state, false));
    });
  }
  // `composing` marks 글쓰기 as the current screen (decision 15); the section stays for the frame.
  function activate(section, { composing = false } = {}) {
    const current = normalizeSection(section) || 'schedule';
    root.document.body.dataset.haedoSection = current;
    root.document.querySelectorAll('[data-haedo-section]').forEach(node => {
      if (!node.matches('a')) return;
      if (node.dataset.haedoSection === current && !composing) node.setAttribute('aria-current', 'page');
      else node.removeAttribute('aria-current');
    });
    root.document.querySelectorAll('a[data-haedo-compose]').forEach(node => {
      if (composing) node.setAttribute('aria-current', 'page');
      else node.removeAttribute('aria-current');
    });
    // Activation is committed by the router, never optimistically by a click.
    indicators.forEach(state => placeIndicator(state, true));
  }
  function bind(handler) {
    if (typeof handler !== 'function') return () => {};
    handlers.add(handler);
    return () => handlers.delete(handler);
  }
  function tooltip(control, label) {
    const text = root.document.createElement('span');
    text.className = 'haedo-tooltip'; text.setAttribute('aria-hidden', 'true'); text.textContent = label;
    control.append(text);
  }
  root.document.querySelectorAll('[data-haedo-navigation]').forEach(nav => {
    const indicator = root.document.createElement('span');
    indicator.className = 'haedo-nav-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    nav.append(indicator);
    indicators.push({ nav, indicator, animation: null });
    const brand = root.document.createElement('a');
    brand.className = 'haedo-brand'; brand.href = 'index.html'; brand.setAttribute('aria-label', '해도 홈');
    const mark = root.document.createElement('img'); mark.className = 'haedo-brand-mark'; mark.src = 'icon.svg'; mark.alt = ''; mark.width = 28; mark.height = 28;
    const wordmark = root.document.createElement('span'); wordmark.textContent = '해도';
    brand.append(mark, wordmark);
    brand.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !handlers.size) return;
      event.preventDefault();
      for (const handler of handlers) handler('schedule');
    });
    nav.append(brand);
    // 글쓰기 keeps one place on every screen: top of the label menu, or the top
    // right corner (pencil) at phone width. Pages without the app router open it by address.
    const write = root.document.createElement('a');
    write.className = 'haedo-nav-compose'; write.href = compose.href; write.dataset.haedoCompose = 'true';
    write.setAttribute('aria-label', compose.label);
    const plus = root.HaedoLife.Icons.create('plus'); plus.classList.add('haedo-compose-wide');
    const pencil = root.HaedoLife.Icons.create('write'); pencil.classList.add('haedo-compose-narrow');
    const writeText = root.document.createElement('span');
    writeText.className = 'haedo-nav-text'; writeText.setAttribute('aria-hidden', 'true'); writeText.textContent = compose.label;
    write.append(plus, pencil, writeText);
    tooltip(write, compose.label);
    write.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !handlers.size) return;
      event.preventDefault();
      if (write.getAttribute('aria-current') === 'page') return;
      for (const handler of handlers) handler(compose.id);
    });
    nav.append(write);
    // Pages whose heading scrolls with the page (goals, habits, workspace, timeline, login,
    // privacy) carry the phone pencil inside that heading, so it never floats over content.
    // The app pages keep the fixed pencil beside their sticky heading row.
    const pageHeading = root.document.getElementById('lifeApp') ? null : root.document.querySelector('.p-main > .haedo-page-heading, header .haedo-page-heading');
    if (pageHeading) {
      const inline = root.document.createElement('a');
      inline.className = 'haedo-icon-button haedo-heading-compose'; inline.href = compose.href; inline.dataset.haedoCompose = 'heading';
      inline.setAttribute('aria-label', compose.label);
      inline.append(root.HaedoLife.Icons.create('write'));
      const actions = pageHeading.querySelector(':scope > .haedo-heading-actions') || (() => {
        const group = root.document.createElement('div'); group.className = 'haedo-heading-actions'; pageHeading.append(group); return group;
      })();
      actions.append(inline);
      root.document.body.dataset.haedoComposeInline = 'true';
    }
    for (const item of sections) {
      const link = root.document.createElement('a');
      link.className = 'haedo-icon-button haedo-nav-link';
      link.href = item.href; link.dataset.haedoSection = item.id;
      link.setAttribute('aria-label', item.label);
      link.append(root.HaedoLife.Icons.create(item.glyph));
      const label = root.document.createElement('span');
      label.className = 'haedo-nav-text'; label.setAttribute('aria-hidden', 'true'); label.textContent = item.label;
      link.append(label);
      tooltip(link, item.label);
      link.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !handlers.size) return;
        event.preventDefault();
        for (const handler of handlers) handler(item.id);
      });
      nav.append(link);
    }
  });
  root.addEventListener('resize', refreshIndicators, { passive: true });
  root.addEventListener('pageshow', refreshIndicators);
  root.addEventListener('pagehide', () => indicators.forEach(cancelIndicator));
  root.document.addEventListener('visibilitychange', () => {
    indicators.forEach(cancelIndicator);
    refreshIndicators();
  });
  const preferenceChanged = () => { indicators.forEach(cancelIndicator); refreshIndicators(); };
  if (preference?.addEventListener) preference.addEventListener('change', preferenceChanged);
  else preference?.addListener?.(preferenceChanged);
  if (root.ResizeObserver) {
    const observer = new root.ResizeObserver(refreshIndicators);
    indicators.forEach(({ nav }) => {
      observer.observe(nav);
      nav.querySelectorAll('.haedo-nav-link').forEach(link => observer.observe(link));
    });
  }
  if (root.MutationObserver) {
    const observer = new root.MutationObserver(refreshIndicators);
    observer.observe(root.document.body, { attributes: true, attributeFilter: ['data-writing-focus', 'class', 'hidden', 'style'] });
    indicators.forEach(({ nav }) => observer.observe(nav, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] }));
  }
  root.document.fonts?.ready?.then(refreshIndicators, () => {});
  root.document.querySelectorAll('[data-haedo-icon]').forEach(node => {
    node.replaceChildren(root.HaedoLife.Icons.create(node.dataset.haedoIcon));
  });
  root.document.querySelectorAll('[data-haedo-planning-navigation]').forEach(host => {
    host.replaceChildren(createPlanningNavigation({ current: host.dataset.haedoPlanningNavigation }));
  });
  root.document.querySelectorAll('.haedo-icon-button').forEach(control => {
    if (!control.querySelector('.haedo-tooltip') && control.getAttribute('aria-label')) tooltip(control, control.getAttribute('aria-label'));
    const reset = () => { delete control.dataset.tooltipDismissed; };
    control.addEventListener('blur', reset);
    control.addEventListener('pointerleave', reset);
  });
  root.document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    root.document.querySelectorAll('.haedo-icon-button').forEach(control => { control.dataset.tooltipDismissed = 'true'; });
    const panel = root.document.activeElement?.closest('.haedo-account');
    if (panel?.open) { panel.open = false; panel.querySelector('summary')?.focus({ preventScroll: true }); }
  });
  // Retry/login links preserve only the same allow-listed destination as Auth.
  const loginNext = root.HaedoAuth?.safeNext?.(root.location.pathname.split('/').pop() + root.location.search);
  if (loginNext) root.document.querySelectorAll('[data-login-link], #accessState a, #timelineAccess a').forEach(link => {
    link.href = 'login.html?next=' + encodeURIComponent(loginNext);
  });
  const query = new URLSearchParams(root.location.search);
  const fromQuery = query.get('section');
  const page = root.document.body.dataset.page;
  let initialSection = root.document.body.dataset.haedoSection;
  let composing = false;
  if (page === 'home' || page === 'life') {
    // The blog editor/reader lives in schedule, also when reloaded with `blog`.
    if (page === 'home' && (query.get('compose') === '1' || query.get('view') === 'page' && query.has('blog'))) {
      initialSection = 'schedule'; composing = query.get('compose') === '1' || query.get('blog') === 'new';
    }
    // 통합 검색 opens over the area it was opened from (`?section=schedule&view=find`), so the menu keeps
    // that area marked on reload. A find address without a section (older links) stays under 자료.
    else if (query.get('view') === 'find' && normalizeSection(fromQuery)) initialSection = normalizeSection(fromQuery);
    else if (getSectionForView(query.get('view'))) initialSection = getSectionForView(query.get('view'));
    else if (normalizeSection(fromQuery)) initialSection = normalizeSection(fromQuery);
  }
  activate(initialSection, { composing });
  root.HaedoNavigation = Object.freeze({ activate, bind, getSectionForView, normalizeSection, createPlanningNavigation,
    sections: Object.freeze(sections.map(item => item.id)) });
})(globalThis);

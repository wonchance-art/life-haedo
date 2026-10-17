/* Shared navigation. Existing local Haedo icons; no routing or account storage. */
(function (root) {
  'use strict';
  if (root.HaedoNavigation) return;
  const sections = [
    { id: 'home', label: '홈', glyph: 'home', href: 'index.html' },
    { id: 'records', label: '자료실', glyph: 'quote', href: 'index.html?section=records' },
    { id: 'tools', label: '도구', glyph: 'workspace', href: 'index.html?section=tools' },
    { id: 'manage', label: '설정', glyph: 'settings', href: 'index.html?section=manage' }
  ];
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
  function activate(section) {
    const current = sections.some(item => item.id === section) ? section : 'home';
    root.document.body.dataset.haedoSection = current;
    root.document.querySelectorAll('[data-haedo-section]').forEach(node => {
      if (!node.matches('a')) return;
      if (node.dataset.haedoSection === current) node.setAttribute('aria-current', 'page');
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
      for (const handler of handlers) handler('home');
    });
    nav.append(brand);
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
  if (page === 'home' || page === 'life') {
    if (sections.some(section => section.id === fromQuery)) initialSection = fromQuery;
    else if (['discover', 'reflection', 'books'].includes(query.get('view'))) initialSection = 'tools';
    else if (['transfer', 'sync', 'workbench-backup', 'public-pages'].includes(query.get('view'))) initialSection = 'manage';
    else if (['collection', 'topics', 'sources', 'time', 'import', 'write', 'activities', 'page'].includes(query.get('view'))) initialSection = 'records';
  }
  activate(initialSection);
  root.HaedoNavigation = Object.freeze({ activate, bind });
})(globalThis);

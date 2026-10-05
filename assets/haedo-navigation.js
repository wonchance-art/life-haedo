/* Shared navigation. Existing local Haedo icons; no routing or account storage. */
(function (root) {
  'use strict';
  const sections = [
    { id: 'home', label: '홈', glyph: 'home', href: 'index.html' },
    { id: 'records', label: '기록', glyph: 'quote', href: 'index.html?section=records' },
    { id: 'tools', label: '도구', glyph: 'workspace', href: 'index.html?section=tools' },
    { id: 'manage', label: '관리', glyph: 'settings', href: 'index.html?section=manage' }
  ];
  const handlers = new Set();
  function activate(section) {
    const current = sections.some(item => item.id === section) ? section : 'home';
    root.document.body.dataset.haedoSection = current;
    root.document.querySelectorAll('[data-haedo-section]').forEach(node => {
      if (!node.matches('a')) return;
      if (node.dataset.haedoSection === current) node.setAttribute('aria-current', 'page');
      else node.removeAttribute('aria-current');
    });
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
    for (const item of sections) {
      const link = root.document.createElement('a');
      link.className = 'haedo-icon-button haedo-nav-link';
      link.href = item.href; link.dataset.haedoSection = item.id;
      link.setAttribute('aria-label', item.label);
      link.append(root.HaedoLife.Icons.create(item.glyph));
      tooltip(link, item.label);
      link.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !handlers.size) return;
        event.preventDefault();
        for (const handler of handlers) handler(item.id);
      });
      nav.append(link);
    }
  });
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
    else if (['discover', 'reflection'].includes(query.get('view'))) initialSection = 'tools';
    else if (['transfer', 'sync', 'workbench-backup', 'public-pages'].includes(query.get('view'))) initialSection = 'manage';
    else if (['topics', 'sources', 'time', 'import', 'write', 'activities', 'page'].includes(query.get('view'))) initialSection = 'records';
  }
  activate(initialSection);
  root.HaedoNavigation = Object.freeze({ activate, bind });
})(globalThis);

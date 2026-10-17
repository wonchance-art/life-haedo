/* Bounded UI motion only. Never reads account data, changes focus, or delays an action. */
(function (root) {
  'use strict';
  if (root.HaedoMotion) return;
  const document = root.document;
  const preference = root.matchMedia?.('(prefers-reduced-motion: reduce)');
  const active = new Map();
  let disposed = false;

  function cancel(element) {
    const animation = active.get(element);
    if (!animation) return;
    active.delete(element);
    animation.cancel();
  }
  function cancelAll() {
    for (const element of active.keys()) cancel(element);
  }
  function play(element, keyframes, duration) {
    cancel(element);
    if (disposed || !element || element.isConnected === false || element.closest?.('[hidden]') ||
        document.hidden || preference?.matches || typeof element.animate !== 'function') return null;
    let animation;
    try {
      // No fill or inline styles: cancellation and unsupported WAAPI both reveal the normal UI.
      animation = element.animate(keyframes, { duration, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    } catch (_) { return null; }
    active.set(element, animation);
    const release = () => {
      if (active.get(element) === animation) active.delete(element);
    };
    animation.finished?.then(release, release);
    return animation;
  }
  function enter(element, options = {}) {
    const kind = options.kind || 'push';
    const direction = options.direction === -1 ? -1 : 1;
    const duration = { push: 220, back: 200, tab: 160, compose: 260, reveal: 180 }[kind] || 220;
    if (kind === 'reveal') return play(element, [{ opacity: .72 }, { opacity: 1 }], duration);
    const distance = kind === 'back' ? -12 : kind === 'tab' ? 8 : kind === 'compose' ? 20 : 16;
    const translate = kind === 'compose' ? `translateY(${distance}px)` : `translateX(${distance * direction}px)`;
    return play(element, [{ opacity: .8, transform: translate }, { opacity: 1, transform: 'none' }], duration);
  }
  function feedback(element, options = {}) {
    // The caller supplies real saved/error text. Motion only acknowledges its arrival.
    return play(element, [{ opacity: options.state === 'error' ? .55 : .7 }, { opacity: 1 }], 140);
  }
  function visibilityChanged() { if (document.hidden) cancelAll(); }
  document.addEventListener('visibilitychange', visibilityChanged);
  root.addEventListener('pagehide', cancelAll);
  if (preference?.addEventListener) preference.addEventListener('change', cancelAll);
  else preference?.addListener?.(cancelAll);
  function dispose() {
    disposed = true;
    cancelAll();
    document.removeEventListener('visibilitychange', visibilityChanged);
    root.removeEventListener('pagehide', cancelAll);
    if (preference?.removeEventListener) preference.removeEventListener('change', cancelAll);
    else preference?.removeListener?.(cancelAll);
  }
  root.HaedoMotion = Object.freeze({ enter, feedback, cancel, dispose });
})(globalThis);

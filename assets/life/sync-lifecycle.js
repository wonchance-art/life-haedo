/* Page-lifecycle wiring shared by the sync engines (structure review S2).
 * An engine keeps its own handlers (what online, focus, visibilitychange, pagehide/pageshow and
 * haedo:page-suspend/-ready do, and its back/forward-cache parking); this module only binds them
 * in the order given, starts the poll and removes everything again. No network or storage. */
(function (root, factory) {
  'use strict'; const api = factory(); (root.HaedoLife ||= {}).SyncLifecycle = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function () {
  'use strict';
  const TARGETS = new Set(['window', 'document']);
  // host: the engine's root (window in a page). listen: [['window' | 'document', type, handler], ...],
  // bound in this order to host or host.document. poll: [every, handler] or null; the interval is
  // started after the listeners (unref'd under Node). Returns { detach() }, which removes exactly
  // what was bound and clears the poll; detaching twice does nothing.
  function attach(host, { listen = [], poll = null } = {}) {
    if (!host || !Array.isArray(listen)) throw new TypeError('SyncLifecycle.attach: host and listen are required');
    const bound = [];
    for (const [where, type, handler] of listen) {
      if (!TARGETS.has(where) || typeof type !== 'string' || typeof handler !== 'function') throw new TypeError('SyncLifecycle.attach: bad listener ' + type);
      const target = where === 'window' ? host : host.document;
      target?.addEventListener?.(type, handler);
      bound.push([target, type, handler]);
    }
    let interval = null, attached = true;
    if (poll) {
      const [every, handler] = poll;
      interval = host.setInterval(handler, every); interval?.unref?.();
    }
    return Object.freeze({
      detach() {
        if (!attached) return; attached = false;
        if (interval !== null) host.clearInterval(interval); interval = null;
        for (const [target, type, handler] of bound) target?.removeEventListener?.(type, handler);
        bound.length = 0;
      },
    });
  }
  return Object.freeze({ attach });
});

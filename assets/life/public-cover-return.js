/* A public reading breadcrumb, restricted to the current cover's exact member. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).PublicCoverReturn = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.document && root.location?.href && new URL(root.location.href).searchParams.has('fromCover')) api.start();
})(globalThis, function (root) {
  'use strict';
  const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value) ? value.toLowerCase() : null;
  const routes = { post: ['blog.html', 'post'], series: ['series.html', 'series'], nine: ['taste.html', 'nine'] };
  function context(address) {
    let url; try { url = new URL(address); } catch (_) { return null; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const covers = url.searchParams.getAll('fromCover'), items = url.searchParams.getAll('coverItem');
    if (covers.length !== 1 || items.length !== 1) return null;
    const coverId = uuid(covers[0]), match = /^(post|series|nine)-(.+)$/.exec(items[0]);
    if (!coverId || !match || !uuid(match[2])) return null;
    const kind = match[1], publicId = uuid(match[2]), [file, parameter] = routes[kind], expected = new URL(file, url);
    const targets = url.searchParams.getAll(parameter);
    if (url.origin !== expected.origin || url.pathname !== expected.pathname || targets.length !== 1 || uuid(targets[0]) !== publicId) return null;
    const allowed = new Set([parameter, 'fromCover', 'coverItem', ...(kind === 'series' ? ['post'] : [])]);
    if ([...url.searchParams.keys()].some(key => !allowed.has(key))) return null;
    if (kind === 'series' && (url.searchParams.getAll('post').length > 1 || (url.searchParams.has('post') && !uuid(url.searchParams.get('post'))))) return null;
    return Object.freeze({ coverId, kind, publicId, key: 'cover-entry-' + kind + '-' + publicId });
  }
  function destination(address, snapshot) {
    const value = context(address); if (!value) return null;
    const model = root.HaedoLife?.PublicCover || (typeof require === 'function' && require('./public-cover.js'));
    let cover; try { cover = model.parse(snapshot, address); } catch (_) { return null; }
    if (!cover.items.some(item => item.kind === value.kind && item.publicId === value.publicId)) return null;
    const url = new URL('cover.html', address); url.searchParams.set('cover', value.coverId); url.hash = value.key;
    return Object.freeze({ ...value, url: url.href });
  }
  function seriesAddress(address, value) {
    if (!value || value.kind !== 'series') return null;
    let url; try { url = new URL(address); } catch (_) { return null; }
    const parent = new URL(value.url), expected = new URL('series.html', parent);
    if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password || url.hash) return null;
    const allowed = new Set(['series', 'post', 'fromCover', 'coverItem']);
    if ([...url.searchParams.keys()].some(key => !allowed.has(key)) || url.searchParams.getAll('series').length !== 1 || uuid(url.searchParams.get('series')) !== value.publicId) return null;
    if (url.searchParams.getAll('post').length > 1 || (url.searchParams.has('post') && !uuid(url.searchParams.get('post')))) return null;
    url.searchParams.set('fromCover', value.coverId); url.searchParams.set('coverItem', 'series-' + value.publicId); return url.href;
  }
  function start(options = {}) {
    const document = options.document || root.document, address = options.address || root.location?.href;
    const scope = context(address), main = document?.querySelector('main');
    if (!scope || !main) return { dispose() {} };
    const readerFactory = options.readerFactory || (() => root.HaedoLife.ShareRemote.createReader({ config: root.HAEDO_CONFIG }));
    let disposed = false, epoch = 0, reader = null, nav = null, active = null, timer = null;
    function clear() { nav?.remove(); nav = null; active = null; }
    function cancel() { epoch++; root.clearTimeout(timer); reader?.dispose(); reader = null; }
    function decorate() {
      if (!active) return;
      for (const link of main.querySelectorAll('.bs-public-series,.bs-public-toc a,.bs-public-navigation a')) {
        const href = seriesAddress(link.href, active); if (href && href !== link.href) link.href = href;
      }
    }
    async function load() {
      if (disposed) return; cancel(); const captured = epoch;
      if (document.hidden) { clear(); return; }
      try {
        reader = readerFactory(); const result = await reader.read(scope.coverId);
        if (disposed || captured !== epoch || document.hidden) return;
        const value = result.status === 'published' && result.publicId === scope.coverId ? destination(address, result.snapshot) : null;
        if (!value) { clear(); return; }
        active = value;
        if (!nav) {
          nav = document.createElement('nav'); nav.id = 'coverReturn'; nav.className = 'pc-return'; nav.setAttribute('aria-label', '공개 표지 복귀');
          const link = document.createElement('a'); link.className = 'pc-return-link'; link.textContent = '표지로 돌아가기'; link.href = value.url; nav.append(link);
          const header = main.querySelector('header'); if (header) header.after(nav); else main.prepend(nav);
        }
        decorate(); timer = root.setTimeout(load, 30000);
      } catch (_) { if (!disposed && captured === epoch) clear(); }
    }
    const observer = typeof root.MutationObserver === 'function' ? new root.MutationObserver(decorate) : null;
    observer?.observe(main, { childList: true, subtree: true });
    const hide = () => { cancel(); clear(); }, visibility = () => document.hidden ? hide() : load(), show = () => load();
    document.addEventListener('visibilitychange', visibility); root.addEventListener('pagehide', hide); root.addEventListener('pageshow', show);
    root.addEventListener('offline', hide); root.addEventListener('online', show); load();
    return { load, dispose() { disposed = true; hide(); observer?.disconnect(); document.removeEventListener('visibilitychange', visibility); root.removeEventListener('pagehide', hide); root.removeEventListener('pageshow', show); root.removeEventListener('offline', hide); root.removeEventListener('online', show); } };
  }
  return Object.freeze({ context, destination, seriesAddress, start });
});

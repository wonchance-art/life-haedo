/* Source-derived, opt-in covers. No image data or preferences enter storage/backups. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.HaedoLife ||= {}).CollectionMedia = api;
})(globalThis, function () {
  'use strict';
  function isbn(value) {
    if (typeof value !== 'string' || !/^[0-9Xx -]{10,24}$/.test(value)) return null;
    const digits = value.replace(/[ -]/g, '').toUpperCase();
    if (/^\d{9}[\dX]$/.test(digits) && [...digits].reduce((sum, n, i) => sum + (n === 'X' ? 10 : +n) * (10 - i), 0) % 11 === 0) return digits;
    if (/^97[89]\d{10}$/.test(digits) && [...digits].reduce((sum, n, i) => sum + +n * (i % 2 ? 3 : 1), 0) % 10 === 0) return digits;
    return null;
  }
  function bookSource(value) { const id = isbn(value); return id ? 'https://openlibrary.org/isbn/' + id : null; }
  function describe(item) {
    if (!item || !['book', 'video'].includes(item.type) || typeof item.url !== 'string' || item.url.length > 2048 || /[\s\\]/u.test(item.url)) return null;
    let u; try { u = new URL(item.url); } catch (_) { return null; }
    if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
    if (item.type === 'book' && u.hostname === 'openlibrary.org') {
      const raw = /^\/isbn\/([\dXx-]+)\/?$/.exec(u.pathname)?.[1], code = isbn(raw);
      const edition = /^\/books\/(OL\d{1,12}M)(?:\/[^/]+)?\/?$/.exec(u.pathname)?.[1];
      if (!code && !edition) return null;
      const key = code ? 'isbn/' + code : 'olid/' + edition;
      return Object.freeze({ provider: 'Open Library', label: '표지', source: code ? bookSource(code) : 'https://openlibrary.org/books/' + edition,
        image: 'https://covers.openlibrary.org/b/' + key + '-M.jpg?default=false' });
    }
    if (item.type !== 'video') return null;
    let id;
    if (u.hostname === 'youtu.be') id = /^\/([\w-]{11})\/?$/.exec(u.pathname)?.[1];
    if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(u.hostname)) id = u.pathname === '/watch' ? u.searchParams.get('v') : /^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/.exec(u.pathname)?.[1];
    if (!/^[\w-]{11}$/.test(id || '')) return null;
    return Object.freeze({ provider: 'YouTube', label: '영상 썸네일', source: 'https://www.youtube.com/watch?v=' + id, videoId: id });
  }
  function thumbnail(value, videoId) {
    if (typeof value !== 'string') return null;
    const m = /^https:\/\/i\.ytimg\.com\/vi\/([\w-]{11})\/(default|mqdefault|hqdefault|sddefault|maxresdefault)\.jpg$/.exec(value);
    return m && m[1] === videoId ? value : null;
  }
  // Call only after explicit opt-in. Offscreen items do not start provider requests.
  function mount({ host, descriptor, lookup, onState, timeout = 18000 }) {
    let alive = true, started = false, observer, timer, image;
    const controller = new AbortController();
    const notify = state => { if (alive && host.isConnected) onState(state); };
    function stop() { clearTimeout(timer); observer?.disconnect(); controller.abort(); if (image) { image.onload = image.onerror = null; image.removeAttribute('src'); image.remove(); } }
    function fail() { if (!alive) return; stop(); notify('error'); alive = false; }
    async function start() {
      if (!alive || started || !host.isConnected) return;
      started = true; observer?.disconnect(); notify('loading'); timer = setTimeout(fail, timeout);
      try {
        let src = descriptor.image;
        if (descriptor.provider === 'YouTube') {
          const candidate = await lookup(descriptor.source, { signal: controller.signal });
          src = thumbnail(candidate.thumbnail, descriptor.videoId);
        }
        if (!alive || !host.isConnected) return;
        if (!src) { fail(); return; }
        image = new Image(); image.alt = ''; image.referrerPolicy = 'no-referrer'; image.decoding = 'async';
        // Coverstore officially supports credential-free CORS. YouTube thumbnails use native image embedding.
        if (descriptor.provider === 'Open Library') image.crossOrigin = 'anonymous';
        image.onload = () => { if (!alive || !host.isConnected) return; if (image.naturalWidth < 16 || image.naturalHeight < 16) { fail(); return; } clearTimeout(timer); host.append(image); notify('ready'); };
        image.onerror = fail; image.src = src;
      } catch (_) { fail(); }
    }
    if (typeof IntersectionObserver === 'function') { observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) start(); }, { rootMargin: '120px' }); observer.observe(host); }
    else queueMicrotask(start);
    return () => { alive = false; stop(); };
  }
  return Object.freeze({ isbn, bookSource, describe, thumbnail, mount });
});

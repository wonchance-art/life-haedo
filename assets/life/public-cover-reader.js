/* Public pointers only: no Auth, SDK, personal storage or target body copies. */
(function (root, factory) {
  const api = factory(root); (root.HaedoLife ||= {}).PublicCoverReader = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const dependency = (name, file) => root.HaedoLife?.[name] || require('./' + file);
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const token = value => dependency('BlogPublic', 'blog-public.js').token(value);
  const route = Object.freeze({ post: ['blog.html', 'post'], series: ['series.html', 'series'], nine: ['taste.html', 'nine'] });
  function targetURL(kind, publicId, baseURL) {
    if (!Object.hasOwn(route, kind)) fail('invalid_cover');
    const source = new URL(baseURL || root.location?.href);
    if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) fail('invalid_cover');
    const [file, parameter] = route[kind], url = new URL(file, source);
    url.searchParams.set(parameter, token(publicId)); return url.href;
  }
  function key(kind, publicId) { if (!Object.hasOwn(route, kind)) fail('invalid_cover'); return 'cover-entry-' + kind + '-' + token(publicId); }
  function postExcerpt(snapshot) {
    return Array.from(snapshot.ops.filter(op => typeof op.insert === 'string').map(op => op.insert).join('').replace(/\s+/gu, ' ').trim()).slice(0, 240).join('');
  }
  function create(options = {}) {
    const share = options.shareReader || dependency('ShareRemote', 'share-remote.js').createReader(options);
    const blog = options.blogReader || dependency('BlogPublic', 'blog-public.js').createReader(options);
    let disposed = false, generation = 0;
    async function read(publicId) {
      publicId = token(publicId); if (disposed) fail('request_cancelled'); const captured = ++generation;
      const alive = () => { if (disposed || captured !== generation) fail('request_cancelled'); };
      const page = await share.read(publicId); alive();
      if (page.status !== 'published') return { status: 'missing' };
      const model = dependency('PublicCover', 'public-cover.js'), parsed = model.parse(page.snapshot, options.baseURL);
      const items = new Array(parsed.items.length); let position = 0;
      async function worker() {
        while (position < parsed.items.length) {
          alive(); const index = position++, pointer = parsed.items[index];
          const row = { ...pointer, key: key(pointer.kind, pointer.publicId), status: 'missing', title: null, intro: null, excerpt: null, url: null };
          try {
            if (pointer.kind === 'post') {
              const value = await blog.read(pointer.publicId); alive();
              if (value) Object.assign(row, { status: 'published', title: value.snapshot.title || '제목 없는 글', intro: '', excerpt: postExcerpt(value.snapshot), url: targetURL(pointer.kind, pointer.publicId, options.baseURL) });
            } else {
              const value = await share.read(pointer.publicId); alive();
              if (value.status === 'published') {
                // A one-item cover is also nine-shaped. Classify it first so a
                // changed target cannot introduce a nested cover as a nine.
                let nestedCover = false;
                try { model.parse(value.snapshot, options.baseURL); nestedCover = true; } catch (_) { /* Other strict public shapes follow. */ }
                if (nestedCover) fail('nested_cover');
                // The wrapper parser is reused without fetching a series' child posts.
                const series = dependency('BlogSeriesPublic', 'blog-series-public.js');
                if (pointer.kind === 'series') series.parseWrapper(value.snapshot, options.baseURL);
                else {
                  let seriesShape = false;
                  try { series.parseWrapper(value.snapshot, options.baseURL); seriesShape = true; } catch (_) { /* Generic nine-compatible metadata follows. */ }
                  if (seriesShape) fail('target_kind_changed');
                  dependency('NinePublic', 'nine-public.js').parse(value.snapshot);
                }
                Object.assign(row, { status: 'published', title: value.snapshot.title, intro: value.snapshot.intro || '', excerpt: '', url: targetURL(pointer.kind, pointer.publicId, options.baseURL) });
              }
            }
          } catch (cause) {
            alive(); if (cause?.code === 'request_cancelled') throw cause;
            row.status = 'error';
          }
          items[index] = row;
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, parsed.items.length) }, worker)); alive();
      // A cover removed or edited while its targets load cannot expose old membership.
      const fresh = await share.read(publicId); alive();
      if (fresh.status !== 'published') return { status: 'missing' };
      const latest = model.parse(fresh.snapshot, options.baseURL);
      if (fresh.revision !== page.revision || JSON.stringify(latest) !== JSON.stringify(parsed)) fail('cover_changed');
      return { status: 'published', publicId, revision: page.revision, title: parsed.title, intro: parsed.intro, items };
    }
    function dispose() { if (disposed) return; disposed = true; generation++; share.dispose(); blog.dispose(); }
    return Object.freeze({ read, dispose });
  }
  return Object.freeze({ create, targetURL, key, postExcerpt });
});

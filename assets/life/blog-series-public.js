/* A series is an ordered list of existing public tokens, never a body copy. */
(function (root, factory) {
  const api = factory(root); (root.HaedoLife ||= {}).BlogSeriesPublic = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.document?.getElementById('seriesContent')) api.start();
})(globalThis, function (root) {
  'use strict';
  const dependency = (name, file) => root.HaedoLife?.[name] || require('./' + file);
  const fail = (code = 'invalid_series') => { throw Object.assign(new Error(code), { code }); };
  const check = (value, code) => { if (!value) fail(code); };
  const token = value => dependency('BlogPublic', 'blog-public.js').token(value);
  const base = value => new URL('blog.html', value || root.location?.href).href;
  function wrapper(title, intro, tokens, baseURL) {
    check(Array.isArray(tokens) && tokens.length > 0 && tokens.length <= 100);
    const seen = new Set(), snapshot = { format: 'life-share-v1', title, intro: intro || null,
      entries: tokens.map((value, index) => {
        const id = token(value); check(!seen.has(id)); seen.add(id);
        const url = new URL(base(baseURL)); url.searchParams.set('post', id);
        return { title: (index + 1) + '편', pinned: false, note: null, parts: [],
          attachments: [{ type: 'article', title: (index + 1) + '편', creator: '', url: url.href }] };
      }) };
    dependency('Share', 'share.js').validate(snapshot); return snapshot;
  }
  function parseWrapper(snapshot, baseURL) {
    dependency('Share', 'share.js').validate(snapshot);
    check(snapshot.entries.length > 0); const tokens = [], expected = base(baseURL);
    for (const [index, entry] of snapshot.entries.entries()) {
      const label = (index + 1) + '편';
      check(entry.title === label && !entry.pinned && entry.note === null && entry.parts.length === 0 && entry.attachments?.length === 1);
      const item = entry.attachments[0]; check(item.type === 'article' && item.title === label && item.creator === '');
      const url = new URL(item.url), values = url.searchParams.getAll('post');
      check(values.length === 1); const id = token(values[0]), canonical = new URL(expected); canonical.searchParams.set('post', id);
      check(url.href === canonical.href && !tokens.includes(id)); tokens.push(id);
    }
    return tokens;
  }
  function createReader(options = {}) {
    const share = options.shareReader || dependency('ShareRemote', 'share-remote.js').createReader(options);
    const blog = options.blogReader || dependency('BlogPublic', 'blog-public.js').createReader(options);
    let disposed = false, generation = 0;
    async function read(id, { post = null } = {}) {
      id = token(id); if (post !== null) post = token(post);
      check(!disposed, 'request_cancelled'); const captured = ++generation;
      const alive = () => check(!disposed && captured === generation, 'request_cancelled');
      const page = await share.read(id); alive();
      if (page.status !== 'published') return { status: 'missing' };
      const ids = parseWrapper(page.snapshot, options.baseURL);
      check(post === null || ids.includes(post), 'invalid_request');
      const entries = new Array(ids.length); let position = 0, blogToken = null, selected = null;
      async function worker() {
        while (position < ids.length) {
          const index = position++, value = await blog.read(ids[index]); alive();
          if (value) {
            check(!blogToken || blogToken === value.blogToken); blogToken = value.blogToken;
            if (ids[index] === post) selected = value;
          }
          entries[index] = { token: ids[index], available: !!value, title: value?.snapshot.title || (value ? '제목 없는 글' : null) };
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker)); alive();
      if (post) {
        selected = await blog.read(post); alive();
        if (selected) check(!blogToken || blogToken === selected.blogToken);
        const current = entries.find(entry => entry.token === post); current.available = !!selected; current.title = selected ? selected.snapshot.title || '제목 없는 글' : null;
      }
      // Recheck the wrapper after child requests. A removal or revocation during
      // loading must not render the old membership/order even briefly.
      const fresh = await share.read(id); alive();
      if (fresh.status !== 'published') return { status: 'missing' };
      check(fresh.revision === page.revision && JSON.stringify(fresh.snapshot) === JSON.stringify(page.snapshot), 'series_changed');
      return { status: 'published', publicId: id, revision: page.revision, title: page.snapshot.title, intro: page.snapshot.intro,
        entries, post: selected, requestedPost: post };
    }
    function dispose() { disposed = true; generation++; share.dispose(); blog.dispose(); }
    return Object.freeze({ read, photoURL: (id, photo) => { check(!disposed, 'request_cancelled'); return blog.photoURL(id, photo); }, dispose });
  }
  function start({ document = root.document, window = root, readerFactory = createReader } = {}) {
    const content = document.getElementById('seriesContent'), status = document.getElementById('seriesStatus'), refresh = document.getElementById('seriesRefresh');
    let reader = null, epoch = 0, timer = null, disposed = false, serialized = null;
    const url = new URL(window.location.href), seriesIds = url.searchParams.getAll('series'), posts = url.searchParams.getAll('post');
    let id = null, post = null;
    try { check(seriesIds.length === 1 && posts.length <= 1); id = token(seriesIds[0]); if (posts.length) post = token(posts[0]); } catch (_) { id = null; }
    const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = text; if (cls) n.className = cls; return n; };
    const message = (text, state) => { status.textContent = text; status.dataset.state = state; };
    const address = target => { const next = new URL('series.html', window.location.href); next.searchParams.set('series', id); if (target) next.searchParams.set('post', target); return next.href; };
    function clear() { content.replaceChildren(); serialized = null; document.title = '모음 · 해도'; }
    function cancel() { epoch++; clearTimeout(timer); reader?.dispose(); reader = null; }
    function render(value) {
      const header = node('header', null, 'bs-public-heading');
      if (post) { const back = node('a', value.title, 'blog-back bs-public-series'); back.href = address(null); header.append(back); }
      else { header.append(node('h1', value.title)); if (value.intro) header.append(node('p', value.intro)); }
      const list = node('ol', null, 'bs-public-toc'); list.setAttribute('aria-label', '모음 목차');
      for (const [index, entry] of value.entries.entries()) {
        const li = node('li');
        if (entry.available) { const link = node('a', entry.title); link.href = address(entry.token); if (entry.token === post) link.setAttribute('aria-current', 'page'); li.append(link); }
        else li.append(node('span', (index + 1) + '편 · 공개된 글이 없습니다.'));
        list.append(li);
      }
      content.append(header);
      if (post) { const details = node('details', null, 'bs-public-contents'); details.append(node('summary', '모음 목차 · ' + value.entries.length + '편'), list); content.append(details); }
      else content.append(list);
      if (post && !value.post) content.append(node('p', '이 글은 공개가 종료됐거나 주소가 바뀌었습니다. 다른 글을 선택해 주세요.', 'bs-public-unavailable'));
      if (value.post) {
        const article = dependency('BlogPublicUI', 'blog-public-ui.js').render(value.post.snapshot, { document, photoUrl: photo => reader.photoURL(post, photo.id) });
        article.tabIndex = -1; content.append(article);
        const active = value.entries.filter(entry => entry.available), index = active.findIndex(entry => entry.token === post), nav = node('nav', null, 'bs-public-navigation'); nav.setAttribute('aria-label', '모음 글 이동');
        for (const [target, label] of [[active[index - 1], '이전 글'], [active[index + 1], '다음 글']]) if (target) { const link = node('a', label + ' · ' + target.title); link.href = address(target.token); nav.append(link); }
        const back = node('a', '모음 목차'); back.href = address(null); nav.append(back); content.append(nav);
      }
      document.title = value.title + ' · 해도';
    }
    async function load() {
      if (disposed) return; cancel(); const captured = epoch;
      if (document.hidden) { clear(); message('돌아오면 공개 상태를 다시 확인합니다.', 'paused'); return; }
      if (!id) { clear(); message('모음 주소를 확인해 주세요.', 'missing'); refresh.disabled = true; return; }
      refresh.disabled = true; content.setAttribute('aria-busy', 'true'); message('공개한 모음을 확인하고 있습니다…', 'loading');
      try {
        reader = readerFactory({ config: window.HAEDO_CONFIG, baseURL: window.location.href }); const value = await reader.read(id, { post });
        if (disposed || captured !== epoch || document.hidden) return;
        if (value.status !== 'published') { clear(); message('공개된 모음이 없습니다. 공개가 종료됐거나 주소가 바뀌었습니다.', 'missing'); return; }
        const next = JSON.stringify(value);
        if (next !== serialized || !content.childNodes.length) { content.replaceChildren(); render(value); serialized = next; }
        message('', 'published'); timer = setTimeout(load, 30000);
      } catch (_) { if (!disposed && captured === epoch && !document.hidden) { clear(); message('공개 상태를 확인하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.', 'error'); } }
      finally { if (captured === epoch) { refresh.disabled = false; content.removeAttribute('aria-busy'); } }
    }
    const hide = () => { cancel(); clear(); message('공개 상태를 다시 확인합니다.', 'paused'); }, visibility = () => document.hidden ? hide() : load();
    const offline = () => { hide(); message('인터넷 연결 후 공개 상태를 다시 확인해 주세요.', 'error'); }, show = event => { if (event.persisted) load(); };
    refresh.addEventListener('click', load); document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show); window.addEventListener('offline', offline); window.addEventListener('online', load);
    load();
    return { load, dispose() { disposed = true; hide(); refresh.removeEventListener('click', load); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); window.removeEventListener('offline', offline); window.removeEventListener('online', load); } };
  }
  return Object.freeze({ wrapper, parseWrapper, createReader, start });
});

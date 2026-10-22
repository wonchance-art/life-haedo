/* Naver address identity and acquired-text projection only. No network/storage. */
(function (root, factory) {
  'use strict';
  const api = factory(root); (root.HaedoLife ||= {}).NaverBlog = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const BLOG_ID = /^[A-Za-z0-9_-]{1,50}$/;
  const LOG_NO = /^[1-9][0-9]{0,29}$/;
  const ITEM_FIELDS = ['id', 'blog_id', 'log_no', 'title', 'url', 'content_text', 'content_hash', 'published_at', 'fetched_at', 'coverage'];
  const ROW_FIELDS = ['key', 'status', 'sourceId', 'sourceVersionId', 'sourceUrl', 'candidateSourceIds'];
  const core = () => root.HaedoLife?.Core || (typeof require === 'function' && require('./core.js'));
  function check(condition) {
    if (!condition) throw Object.assign(new Error('네이버 블로그 주소와 수집한 자료 형식을 확인해 주세요.'), { code: 'naver_blog_invalid' });
  }
  function plain(value) {
    return value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  }
  function text(value, max, empty = false) {
    return typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0) &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(value);
  }
  function stamp(value) {
    return typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
  }
  function address(value) {
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    if (!raw || raw.length > 8192 || /[\s\u0000-\u001f\u007f\\]/.test(raw)) return null;
    const authority = /^https?:\/\/([^/?#]+)/i.exec(raw);
    if (!authority || !['blog.naver.com', 'm.blog.naver.com'].includes(authority[1].toLowerCase())) return null;
    try {
      const url = new URL(raw);
      if (!['blog.naver.com', 'm.blog.naver.com'].includes(url.hostname) || url.username || url.password || url.port) return null;
      const rawPath = raw.slice(authority[0].length).split(/[?#]/)[0];
      if (rawPath.includes('%') || rawPath.split('/').some(part => part === '.' || part === '..')) return null;
      const seen = new Set();
      for (const [key] of url.searchParams) {
        const folded = key.toLowerCase();
        if (seen.has(folded) || (['blogid', 'logno'].includes(folded) && !['blogId', 'logNo'].includes(key))) return null;
        seen.add(folded);
      }
      // Identity itself is never percent-decoded into another account/post.
      for (const pair of url.search.slice(1).split('&')) {
        const [key, val = ''] = pair.split('=');
        if ((['blogId', 'logNo'].includes(key) && /[%+]/.test(val)) || /%/.test(key)) return null;
      }
      const path = url.pathname.replace(/\/$/, '');
      let blogId, logNo = null;
      if (path === '/PostList.naver' || path === '/PostView.naver') {
        blogId = url.searchParams.get('blogId');
        logNo = url.searchParams.get('logNo');
        if (path === '/PostList.naver' ? logNo !== null : !LOG_NO.test(logNo || '')) return null;
      } else {
        const parts = /^\/([A-Za-z0-9_-]+)(?:\/([1-9][0-9]*))?$/.exec(path);
        if (!parts || url.searchParams.has('blogId') || url.searchParams.has('logNo')) return null;
        blogId = parts[1]; logNo = parts[2] || null;
      }
      if (!BLOG_ID.test(blogId || '') || logNo !== null && !LOG_NO.test(logNo)) return null;
      return { blogId, logNo };
    } catch (_) { return null; }
  }
  function parseBlog(input) {
    check(typeof input === 'string');
    const trimmed = input.trim();
    const parsed = BLOG_ID.test(trimmed) ? { blogId: trimmed } : address(trimmed);
    check(parsed);
    return { blogId: parsed.blogId, url: 'https://blog.naver.com/' + parsed.blogId,
      feedUrl: 'https://rss.blog.naver.com/' + parsed.blogId + '.xml' };
  }
  function postIdentity(value) {
    const parsed = address(value);
    if (!parsed || parsed.logNo === null) return null;
    return { ...parsed, key: parsed.blogId + ':' + parsed.logNo,
      url: 'https://blog.naver.com/' + parsed.blogId + '/' + parsed.logNo };
  }
  function itemSnapshot(value, projected = false) {
    check(plain(value));
    const keys = Reflect.ownKeys(value), allowed = projected ? [...ITEM_FIELDS, ...ROW_FIELDS] : ITEM_FIELDS;
    check(ITEM_FIELDS.every(key => Object.hasOwn(value, key)) && keys.every(key => typeof key === 'string' && allowed.includes(key) &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')));
    check(text(value.id, 128) && typeof value.blog_id === 'string' && BLOG_ID.test(value.blog_id) &&
      typeof value.log_no === 'string' && LOG_NO.test(value.log_no) && text(value.title, 500) &&
      text(value.url, 8192) && stamp(value.fetched_at) && (value.published_at === null || stamp(value.published_at)));
    const identity = postIdentity(value.url);
    check(identity && identity.blogId === value.blog_id && identity.logNo === value.log_no);
    if (value.coverage === 'link_only') check(value.content_text === null && value.content_hash === null);
    else check(value.coverage === 'partial' && text(value.content_text, 1024 * 1024) &&
      new TextEncoder().encode(value.content_text).length <= 1024 * 1024 && typeof value.content_hash === 'string' && /^[a-f0-9]{64}$/.test(value.content_hash));
    return Object.fromEntries(ITEM_FIELDS.map(key => [key, value[key]]));
  }
  function project(items, bundle) {
    check(Array.isArray(items) && items.length <= 1000 && Reflect.ownKeys(items).length === items.length + 1);
    for (let index = 0; index < items.length; index++) check(Object.hasOwn(items, index) &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(items, String(index)), 'value'));
    core().validateWorkspace(bundle);
    const byIdentity = new Map(), latest = new Map();
    for (const source of bundle.sources) {
      if (source.origin !== 'naver_blog') continue;
      const identity = postIdentity(source.url);
      if (!identity) continue;
      if (!byIdentity.has(identity.key)) byIdentity.set(identity.key, []);
      byIdentity.get(identity.key).push(source);
    }
    // Same current-version order as Core.searchSources and the existing reader.
    for (const version of bundle.sourceVersions) latest.set(version.sourceId, version);
    const seen = new Set();
    return items.map(input => {
      const item = itemSnapshot(input), identity = postIdentity(item.url);
      check(!seen.has(identity.key)); seen.add(identity.key);
      const candidates = byIdentity.get(identity.key) || [], source = candidates.length === 1 ? candidates[0] : null;
      const version = source ? latest.get(source.id) : null;
      const complete = version?.coverage.status === 'full_text' && typeof version.contentText === 'string';
      return { ...item, key: identity.key,
        status: candidates.length > 1 ? 'ambiguous' : source ? !core().isSourceActive(bundle, source.id) ? 'trashed' : complete ? 'imported' : 'needs_content' : 'new',
        sourceId: source?.id || null, sourceVersionId: version?.id || null, sourceUrl: source?.url || null,
        candidateSourceIds: candidates.map(candidate => candidate.id) };
    });
  }
  function toImportInput(value) {
    const item = itemSnapshot(value, true);
    return { origin: 'naver_blog', title: item.title, url: item.url, text: item.content_text,
      authorRelation: 'unknown', originalCreatedAt: item.published_at,
      coverage: { status: item.coverage, omissions: ['원문 전체 미확인', '사진·영상·댓글 미보관'] } };
  }
  return Object.freeze({ parseBlog, postIdentity, project, toImportInput });
});

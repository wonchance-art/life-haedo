/* Public metadata only. No credentials, arbitrary URL fetching, HTML or image loading. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.HaedoLife ||= {}).CollectionMetadata = api;
})(globalThis, function () {
  'use strict';
  function identify(value) {
    const fail = () => { throw new Error('YouTube 영상 또는 GitHub 공개 저장소 주소를 넣어 주세요. 다른 주소는 직접 입력해 저장할 수 있습니다.'); };
    if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/u.test(value)) return fail();
    let url; try { url = new URL(value); } catch (_) { return fail(); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return fail();
    if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
      const match = /^\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})\/?$/.exec(url.pathname);
      if (!match || ['.', '..'].includes(match[2])) return fail();
      const repo = match[2].replace(/\.git$/, ''); if (!repo) return fail();
      const path = match[1] + '/' + repo;
      return Object.freeze({ provider: 'GitHub', type: 'tool', url: 'https://github.com/' + path, endpoint: 'https://api.github.com/repos/' + path });
    }
    let id;
    if (url.hostname === 'youtu.be') id = /^\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
    }
    if (!id || !/^[\w-]{11}$/.test(id)) return fail();
    const canonical = 'https://www.youtube.com/watch?v=' + id;
    return Object.freeze({ provider: 'YouTube', type: 'video', url: canonical, endpoint: 'https://www.youtube.com/oembed?url=' + encodeURIComponent(canonical) + '&format=json' });
  }
  function clean(value, max, required = false) {
    if (value === undefined || value === null) value = '';
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/u.test(value) || !value.isWellFormed()) throw new Error('제공된 정보 형식이 맞지 않습니다. 직접 입력해 주세요.');
    if (required && !value.trim()) throw new Error('제목 정보가 없습니다. 직접 입력해 주세요.');
    return value;
  }
  async function requestJSON(endpoint, { fetcher = globalThis.fetch, signal, timeout = 10000 } = {}) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; cancel(); }, timeout);
    try {
      if (controller.signal.aborted) throw new DOMException('조회 취소', 'AbortError');
      const response = await fetcher(endpoint, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store', signal: controller.signal });
      if ([403, 429].includes(response.status)) throw new Error('제공자가 조회를 제한했습니다. 잠시 뒤 다시 시도하거나 직접 입력해 주세요.');
      if (response.status === 404 || response.status === 401) throw new Error('공개 정보를 찾지 못했습니다. 주소를 확인하거나 직접 입력해 주세요.');
      if (!response.ok) throw new Error('정보를 받지 못했습니다. 잠시 뒤 다시 시도하거나 직접 입력해 주세요.');
      // Stream a bounded response; never retain an unbounded remote document.
      const reader = response.body.getReader(); let size = 0; const parts = [];
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 65536) { await reader.cancel(); throw new Error('조회 정보가 너무 큽니다. 직접 입력해 주세요.'); } parts.push(value); } }
      finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
      const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('잘못된 조회 응답입니다. 직접 입력해 주세요.');
      return data;
    } catch (error) {
      if (timedOut) throw new Error('조회 시간이 초과됐습니다. 다시 시도하거나 직접 입력해 주세요.');
      if (signal?.aborted) throw new DOMException('조회 취소', 'AbortError');
      if (error instanceof TypeError || error instanceof SyntaxError) throw new Error('연결 또는 응답을 확인하지 못했습니다. 직접 입력한 내용은 그대로입니다.');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  async function lookup(value, options = {}) {
    const source = identify(value), data = await requestJSON(source.endpoint, options);
      if (source.provider === 'GitHub' && data.private !== false) throw new Error('공개 저장소만 조회할 수 있습니다. 직접 입력해 주세요.');
      const thumbnail = source.provider === 'YouTube' && typeof data.thumbnail_url === 'string' && /^https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\/(?:default|mqdefault|hqdefault|sddefault|maxresdefault)\.jpg$/.test(data.thumbnail_url) && data.thumbnail_url.split('/')[4] === new URL(source.url).searchParams.get('v') ? data.thumbnail_url : null;
      return Object.freeze({ ...(thumbnail ? { thumbnail } : {}), provider: source.provider, type: source.type, url: source.url,
        title: clean(source.provider === 'GitHub' ? data.name : data.title, 500, true),
        attribution: clean(source.provider === 'GitHub' ? data.owner?.login : data.author_name, 500),
        attributionLabel: source.provider === 'GitHub' ? '저장소 소유자' : '게시 채널' });
  }
  const nextSearch = new Map(); // Only timestamps; never retain queries or account data.
  async function search(provider, query, options = {}) {
    if (!['books', 'projects'].includes(provider)) throw new Error('지원하지 않는 검색입니다.');
    query = clean(query, 160, true).trim();
    if (query.length < 2) throw new Error('검색어를 두 글자 이상 입력해 주세요.');
    if (options.signal?.aborted) throw new DOMException('조회 취소', 'AbortError');
    const now = Date.now();
    if (now < (nextSearch.get(provider) || 0)) throw new Error('조회 간격을 두고 잠시 뒤 다시 검색해 주세요.');
    nextSearch.set(provider, now + (provider === 'projects' ? 6100 : 1100));
    const endpoint = provider === 'books' ? new URL('https://openlibrary.org/search.json') : new URL('https://api.github.com/search/repositories');
    endpoint.searchParams.set('q', query);
    if (provider === 'books') {
      endpoint.searchParams.set('fields', 'key,title,author_name,first_publish_year');
      endpoint.searchParams.set('limit', '6');
    } else endpoint.searchParams.set('per_page', '6');
    const data = await requestJSON(endpoint.href, options), rows = provider === 'books' ? data.docs : data.items;
    if (!Array.isArray(rows)) throw new Error('검색 응답 형식이 맞지 않습니다. 직접 입력해 주세요.');
    const results = [];
    for (const row of rows.slice(0, 6)) {
      try {
        if (provider === 'books') {
          if (!/^\/works\/OL[0-9]+W$/.test(row.key)) continue;
          const creator = row.author_name == null ? '' : row.author_name.map(name => clean(name, 500)).join(', ');
          results.push(Object.freeze({ provider: 'Open Library', type: 'book', title: clean(row.title, 500, true), creator: clean(creator, 500),
            url: 'https://openlibrary.org' + row.key, attribution: creator, attributionLabel: '저자',
            detail: '작품 정보 · 판본 미지정' + (Number.isInteger(row.first_publish_year) && row.first_publish_year > 0 && row.first_publish_year < 10000 ? ' · 첫 출간 ' + row.first_publish_year : '') }));
        } else {
          if (row.private !== false) continue;
          const source = identify('https://github.com/' + clean(row.full_name, 150, true));
          results.push(Object.freeze({ provider: 'GitHub', type: 'tool', title: clean(row.name, 500, true), creator: '', url: source.url,
            attribution: clean(row.owner?.login, 500), attributionLabel: '저장소 소유자', detail: clean(row.description, 500) }));
        }
      } catch (_) { /* Skip an invalid candidate without losing other valid matches. */ }
    }
    return Object.freeze({ results: Object.freeze(results), incomplete: data.incomplete_results === true });
  }
  return Object.freeze({ identify, lookup, search });
});

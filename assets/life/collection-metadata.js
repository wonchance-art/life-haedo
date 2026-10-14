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
  // A source hint, not a fetched or verified artwork record. Preserve the exact input URL.
  function reference(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/u.test(value)) return null;
    let url; try { url = new URL(value); } catch (_) { return null; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
    if (url.hostname !== 'www.artic.edu' || !/^\/artworks\/[1-9][0-9]{0,9}(?:\/[A-Za-z0-9-]+)?\/?$/.test(url.pathname)) return null;
    return Object.freeze({provider:'시카고 미술관',type:'artwork',url:value});
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
  function pace(provider) {
    const now = Date.now();
    if (now < (nextSearch.get(provider) || 0)) throw new Error('조회 간격을 두고 잠시 뒤 다시 검색해 주세요.');
    nextSearch.set(provider, now + (provider === 'projects' ? 6100 : 1100));
  }
  async function paceBooks(options) {
    // Wait for one explicit follow-up request; never retry a failed response.
    const delay = Math.max(0, (nextSearch.get('books') || 0) - Date.now());
    if (delay) await new Promise((resolve,reject) => {
      const abort = () => {clearTimeout(timer); options.signal?.removeEventListener('abort',abort); reject(new DOMException('조회 취소','AbortError'));};
      const timer = setTimeout(() => {options.signal?.removeEventListener('abort',abort); resolve();},delay);
      if(options.signal?.aborted) abort(); else options.signal?.addEventListener('abort',abort,{once:true});
    });
    pace('books');
  }
  async function editions(workUrl, offset = 0, options = {}) {
    if (typeof workUrl !== 'string' || !/^https:\/\/openlibrary\.org\/works\/OL[0-9]+W$/.test(workUrl) || !Number.isSafeInteger(offset) || offset < 0 || offset > 600 || offset % 6) throw new Error('책의 작품 주소와 판본 범위를 확인해 주세요.');
    if (options.signal?.aborted) throw new DOMException('조회 취소', 'AbortError');
    await paceBooks(options);
    const data = await requestJSON(workUrl + '/editions.json?limit=6&offset=' + offset, options);
    if (!Array.isArray(data.entries)) throw new Error('판본 응답 형식이 맞지 않습니다.');
    const results = [], workKey = new URL(workUrl).pathname;
    const list = value => value == null ? '' : value.map(v => clean(v, 500)).join(' · ');
    for (const row of data.entries.slice(0, 6)) {
      try {
        if (!/^\/books\/OL[0-9]{1,12}M$/.test(row.key) || !Array.isArray(row.works) || !row.works.some(w => w.key === workKey)) continue;
        const languages = row.languages == null ? '' : row.languages.map(v => {
          const code = /^\/languages\/([a-z]{3})$/.exec(v.key)?.[1];
          if (!code) throw new Error('Invalid language');
          return ({kor:'한국어',eng:'영어',jpn:'일본어',chi:'중국어',fre:'프랑스어',ger:'독일어',spa:'스페인어'})[code] || code;
        }).join(' · ');
        results.push(Object.freeze({provider:'Open Library',type:'book',title:clean(row.title,500,true),creator:'',url:'https://openlibrary.org'+row.key,
          detail: [languages || '언어 미상', list(row.publishers) || '출판사 미상', clean(row.publish_date,500) || '발행일 미상'].join(' · ')}));
      } catch (_) { /* Keep only editions explicitly associated with the selected work. */ }
    }
    return Object.freeze({results:Object.freeze(results),offset,hasMore:offset < 600 && data.entries.length > 0 && Number.isSafeInteger(data.size) && data.size > offset + 6});
  }
  async function koreanEdition(workUrl, options = {}) {
    if (typeof workUrl !== 'string' || !/^https:\/\/openlibrary\.org\/works\/OL[0-9]+W$/.test(workUrl)) throw new Error('책의 작품 주소를 확인해 주세요.');
    if (options.signal?.aborted) throw new DOMException('조회 취소', 'AbortError');
    await paceBooks(options);
    const workKey = new URL(workUrl).pathname, endpoint = new URL('https://openlibrary.org/search.json');
    endpoint.searchParams.set('q', 'key:' + workKey + ' language:kor');
    endpoint.searchParams.set('fields', 'key,editions,editions.key,editions.title,editions.language,editions.publisher,editions.publish_date');
    endpoint.searchParams.set('limit', '1');
    const data = await requestJSON(endpoint.href, options);
    if (!Array.isArray(data.docs)) throw new Error('판본 응답 형식이 맞지 않습니다.');
    const results = [];
    const work = data.docs.find(row => row?.key === workKey);
    if ((data.docs.length && !work) || (work && !Array.isArray(work.editions?.docs))) throw new Error('판본 응답 형식이 맞지 않습니다.');
    const row = work?.editions?.docs?.[0];
    if (row) {
      if (!/^\/books\/OL[0-9]{1,12}M$/.test(row.key) || !Array.isArray(row.language) || !row.language.includes('kor')) throw new Error('한국어 판본의 출처를 확인하지 못했습니다. 전체 판본에서 확인해 주세요.');
      const list = value => {
        if (value == null) return '';
        if (!Array.isArray(value)) throw new Error('판본 응답 형식이 맞지 않습니다.');
        return value.map(v => clean(v, 500)).join(' · ');
      };
      results.push(Object.freeze({provider:'Open Library',type:'book',title:clean(row.title,500,true),creator:'',url:'https://openlibrary.org'+row.key,
        detail:['한국어',list(row.publisher)||'출판사 미상',list(row.publish_date)||'발행일 미상'].join(' · ')}));
    }
    return Object.freeze({results:Object.freeze(results),hasMore:false});
  }
  async function search(provider, query, options = {}) {
    if (!['books', 'projects'].includes(provider)) throw new Error('지원하지 않는 검색입니다.');
    query = clean(query, 160, true).trim();
    if (query.length < 2) throw new Error('검색어를 두 글자 이상 입력해 주세요.');
    if (options.signal?.aborted) throw new DOMException('조회 취소', 'AbortError');
    const page = options.page ?? 1;
    if (!Number.isSafeInteger(page) || page < 1 || page > 100 || (provider !== 'books' && page !== 1)) throw new Error('검색 범위를 확인해 주세요.');
    if (provider === 'books' && page > 1) await paceBooks(options); else pace(provider);
    const endpoint = provider === 'books' ? new URL('https://openlibrary.org/search.json') : new URL('https://api.github.com/search/repositories');
    endpoint.searchParams.set('q', query);
    if (provider === 'books') {
      endpoint.searchParams.set('fields', 'key,title,author_name,first_publish_year');
      endpoint.searchParams.set('limit', '6');
      if (page > 1) endpoint.searchParams.set('page', String(page));
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
    return Object.freeze({ results: Object.freeze(results), incomplete: data.incomplete_results === true, page,
      hasMore: provider === 'books' && page < 100 && rows.length > 0 && Number.isSafeInteger(data.numFound ?? data.num_found) && (data.numFound ?? data.num_found) > page * 6 });
  }
  return Object.freeze({ identify, reference, lookup, search, editions, koreanEdition });
});

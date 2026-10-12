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
  async function lookup(value, { fetcher = globalThis.fetch, signal, timeout = 10000 } = {}) {
    const source = identify(value), controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; cancel(); }, timeout);
    try {
      const response = await fetcher(source.endpoint, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store', signal: controller.signal });
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
      if (source.provider === 'GitHub' && data.private !== false) throw new Error('공개 저장소만 조회할 수 있습니다. 직접 입력해 주세요.');
      return Object.freeze({ provider: source.provider, type: source.type, url: source.url,
        title: clean(source.provider === 'GitHub' ? data.name : data.title, 500, true),
        attribution: clean(source.provider === 'GitHub' ? data.owner?.login : data.author_name, 500),
        attributionLabel: source.provider === 'GitHub' ? '저장소 소유자' : '게시 채널' });
    } catch (error) {
      if (timedOut) throw new Error('조회 시간이 초과됐습니다. 다시 시도하거나 직접 입력해 주세요.');
      if (signal?.aborted) throw new DOMException('조회 취소', 'AbortError');
      if (error instanceof TypeError || error instanceof SyntaxError) throw new Error('연결 또는 응답을 확인하지 못했습니다. 직접 입력한 내용은 그대로입니다.');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  return Object.freeze({ identify, lookup });
});

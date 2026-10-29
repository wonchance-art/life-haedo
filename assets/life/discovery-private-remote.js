/* Account-scoped publisher reading. Private captures never enter the public
 * catalog, reaction snapshots or frozen recommendation comparisons. */
(function (root, factory) {
  'use strict'; const api = factory(root);
  (root.HaedoLife ||= {}).DiscoveryPrivateRemote = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const MAX_BYTES = 2 * 1024 * 1024, TIMEOUT_MS = 35000;
  const FRONTIERS = /^\/(?:journals\/psychology\/articles|articles)\/(10\.3389\/fpsyg\.\d{4}\.([0-9]{1,12}))(?:\/(?:full|xml))?$/;
  const PROVIDERS = Object.freeze({
    'frontiers-psychology': { host: 'www.frontiersin.org', path: FRONTIERS, feed: '/journals/psychology/rss' },
    'mit-linguistics': { host: 'news.mit.edu', path: /^\/\d{4}\/[a-zA-Z0-9-]{1,240}$/, feed: '/topic/mitlinguistics-rss.xml' },
    'llt-journal': { host: 'www.lltjournal.org', path: /^\/item\/[0-9]{1,12}-[0-9]{1,12}\/$/, feed: '/feedlet/' }
  });
  const messages = {
    discovery_private_auth: '로그인 계정을 다시 확인해 주세요.', discovery_private_cancelled: '계정이나 화면이 바뀌어 이전 글 요청을 중단했습니다.',
    discovery_private_setup: '개인 읽기 연결을 준비 중입니다.', discovery_private_invalid: '받아 온 글의 출처와 내용을 확인하지 못했습니다.',
    discovery_private_busy: '글을 가져오는 중입니다. 잠시 뒤 다시 열어 주세요.', discovery_private_rate_limited: '잠시 뒤 글을 다시 열어 주세요.',
    discovery_private_network: '글을 가져오지 못했습니다. 다시 시도하거나 원문을 열어 주세요.'
  };
  const model = () => root.HaedoLife?.Discovery || (typeof require === 'function' && require('./discovery.js'));
  const fault = code => Object.assign(new Error(messages[code] || messages.discovery_private_network), { code: messages[code] ? code : 'discovery_private_network' });
  const check = (value, code = 'discovery_private_invalid') => { if (!value) throw fault(code); };
  const plain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const text = (value, max, empty = false) => typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(value);
  function fields(value, required, optional = []) { check(plain(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key))); }
  function secureURL(value) {
    check(typeof value === 'string' && value.length <= 8192 && !/[\s\\\u0000-\u001f\u007f]/u.test(value));
    let url; try { url = new URL(value); } catch (_) { throw fault('discovery_private_invalid'); }
    check(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && url.href === value); return url;
  }
  function identity(article) {
    check(plain(article) && id(article.id) && id(article.sourceId) && text(article.title, 500));
    const canonical = model().canonicalUrl(article.url), url = secureURL(canonical), provider = PROVIDERS[article.sourceId];
    check(Object.hasOwn(model().ALLOWED_SOURCES, article.sourceId) && model().ALLOWED_SOURCES[article.sourceId].includes(url.hostname));
    check(article.canonicalUrl === undefined || article.canonicalUrl === canonical);
    if (!provider) return null;
    check(url.hostname === provider.host && !url.search && provider.path.test(url.pathname));
    return { sourceId: article.sourceId, url: canonical };
  }
  function license(value) { fields(value, ['label', 'url']); check(text(value.label, 250)); if (value.url !== null) secureURL(value.url); }
  function content(value, input) {
    fields(value, ['coverage', 'summary', 'rights', 'acquisition'], ['bodyText', 'images']);
    check(['summary', 'full_text'].includes(value.coverage) && text(value.summary, 50000, value.coverage === 'full_text'));
    check(value.coverage === 'full_text' ? text(value.bodyText, 200000) : !Object.hasOwn(value, 'bodyText'));
    fields(value.rights, ['mode', 'label', 'url']); check(value.rights.mode === 'private_reading' && text(value.rights.label, 500));
    if (value.rights.url !== null) secureURL(value.rights.url);
    const a = value.acquisition, provider = PROVIDERS[input.sourceId], original = new URL(input.url);
    fields(a, ['scope', 'method', 'sourceUrl', 'fetchedAt', 'license']); license(a.license);
    check(a.scope === 'private_account' && ['publisher_xml', 'publisher_rss', 'publisher_html'].includes(a.method));
    check(typeof a.fetchedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(a.fetchedAt) && Number.isFinite(Date.parse(a.fetchedAt)) && new Date(a.fetchedAt).toISOString() === a.fetchedAt && Date.parse(a.fetchedAt) <= Date.now() + 300000);
    const acquired = secureURL(a.sourceUrl); check(acquired.hostname === provider.host && !acquired.search);
    const match = input.sourceId === 'frontiers-psychology' ? FRONTIERS.exec(original.pathname) : null;
    if (a.method === 'publisher_xml') check(match && acquired.pathname === '/journals/psychology/articles/' + match[1] + '/xml');
    else if (a.method === 'publisher_html') check(input.sourceId === 'mit-linguistics' && acquired.href === input.url);
    else check(acquired.pathname === provider.feed);
    const projected = structuredClone(value);
    if (value.images !== undefined) {
      check(value.coverage === 'full_text' && a.method === 'publisher_xml' && Array.isArray(value.images) && value.images.length <= 2);
      const seen = new Set();
      for (const picture of value.images) {
        check(plain(picture)); const url = secureURL(picture.sourceUrl);
        check(url.hostname === provider.host && !url.search && new RegExp('^/files/Articles/' + match[2] + '/xml-images/fpsyg-[0-9]+-' + match[2] + '-g[0-9]+\\.webp$').test(url.pathname) && !seen.has(picture.sourceUrl));
        seen.add(picture.sourceUrl);
      }
      // Invalid optional bytes are dropped; validated text remains readable.
      projected.images = model().validatePrivateImages(value.images, input.sourceId, value.bodyText);
    }
    return projected;
  }
  function project(metadata, response) {
    const request = identity(metadata); check(request);
    fields(response, ['status', 'sourceId', 'url', 'content', 'contentHash', 'cached', 'stale']);
    check(response.status === 'ready' && response.sourceId === request.sourceId && response.url === request.url && /^[a-f0-9]{64}$/.test(response.contentHash) && typeof response.cached === 'boolean' && typeof response.stale === 'boolean');
    const snapshot = content(response.content, request), article = structuredClone(metadata);
    // Remove any older capture before installing the exact returned version.
    delete article.bodyText; delete article.images; delete article.acquisition; delete article.privateReceipt; delete article.privateReader;
    return { ...article, ...snapshot, privateReader: true, privateReceipt: { sourceId: request.sourceId, url: request.url, contentHash: response.contentHash, cached: response.cached, stale: response.stale } };
  }
  function toImportInput(article) {
    check(article?.privateReader === true); const input = identity(article), receipt = article.privateReceipt; check(input);
    fields(receipt, ['sourceId', 'url', 'contentHash', 'cached', 'stale']);
    check(receipt.sourceId === input.sourceId && receipt.url === input.url && /^[a-f0-9]{64}$/.test(receipt.contentHash) && typeof receipt.cached === 'boolean' && typeof receipt.stale === 'boolean');
    const selected = content(Object.fromEntries(['coverage', 'summary', 'rights', 'acquisition', 'bodyText', 'images'].filter(key => Object.hasOwn(article, key)).map(key => [key, article[key]])), input);
    const line = value => value.replace(/[\r\n]+/g, ' '), full = selected.coverage === 'full_text';
    check(article.author === null || article.author === undefined || text(article.author, 200));
    const body = full ? selected.bodyText : selected.summary;
    const appendix = '\n\n[해도 출처 정보]\n아래는 해도가 덧붙인 출처 정보이며 원문 본문에 포함되지 않습니다.\n제목: ' + line(article.title) +
      '\n원저자: ' + line(article.author || '미확인') + '\n원문 URL: ' + article.url + '\n보관 범위: 비공개 개인 읽기 · ' + (full ? '확보한 본문' : '제공된 요약') +
      '\n수집 출처: ' + selected.acquisition.sourceUrl + '\n수집 시각: ' + selected.acquisition.fetchedAt + '\n출처 표시: ' + line(selected.acquisition.license.label) +
      '\n출처 권리 URL: ' + (selected.acquisition.license.url || '미제공') + '\n변경 사항: 서식을 평문으로 단순화했습니다. 사진·영상은 보관하지 않았습니다.';
    return { origin: 'other', title: article.title, url: article.url, text: body + appendix, format: 'text/plain', author: article.author || '', authorRelation: article.author ? 'other' : 'unknown',
      originalCreatedAt: typeof article.publishedAt === 'string' && Number.isFinite(Date.parse(article.publishedAt)) ? new Date(article.publishedAt).toISOString() : '',
      coverage: { status: full ? 'full_text' : 'partial', omissions: [...(full ? [] : ['원문 전체 미확보']), '사진·영상 미보관'] } };
  }
  async function readJSON(response, signal) {
    check(/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || ''));
    const length = response.headers.get('content-length'); check(length === null || /^\d+$/.test(length) && Number(length) <= MAX_BYTES);
    check(response.body?.getReader); const reader = response.body.getReader(), chunks = []; let total = 0;
    try {
      while (true) { check(!signal.aborted, 'discovery_private_cancelled'); const part = await reader.read(); if (part.done) break; total += part.value.byteLength; check(total <= MAX_BYTES); chunks.push(part.value); }
      const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (error) { try { await reader.cancel(); } catch (_) {} throw error; }
    finally { reader.releaseLock(); }
  }
  function abortable(promise, signal) {
    const pending = Promise.resolve(promise);
    if (signal.aborted) { pending.catch(() => {}); return Promise.reject(fault('discovery_private_cancelled')); }
    return new Promise((resolve, reject) => {
      const abort = () => reject(fault('discovery_private_cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      pending.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    });
  }
  function create({ auth = root.HaedoAuth, storage, isCurrent = () => true, fetcher = root.fetch?.bind(root) } = {}) {
    check(storage?.isAccountScoped && storage.account && auth?.verify && auth.client?.auth?.getSession && typeof fetcher === 'function', 'discovery_private_auth');
    const owner = { ...storage.account }, endpoint = secureURL(auth.config?.url?.replace(/\/$/, '') + '/functions/v1/haedo-discovery-private');
    check(new URL(owner.projectUrl).origin === endpoint.origin && typeof auth.config.key === 'string' && auth.config.key.length > 0, 'discovery_private_auth');
    let disposed = false, generation = 0; const controllers = new Set();
    function cancel() { generation++; for (const controller of controllers) controller.abort(); controllers.clear(); }
    const unlisten = auth.onAccountChange?.(() => {
      const account = auth.getAccount?.();
      if (account?.userId !== owner.userId || account?.projectUrl !== owner.projectUrl) cancel();
    });
    function guard(context) {
      check(!disposed && generation === context.generation && auth.epoch === context.epoch && isCurrent(context.workspaceId) && auth.user?.id === owner.userId && auth.getAccount?.()?.userId === owner.userId && auth.getAccount?.()?.projectUrl === owner.projectUrl && auth.config?.url?.replace(/\/$/, '') === owner.projectUrl.replace(/\/$/, ''), 'discovery_private_cancelled');
    }
    async function loadPrivateArticle(metadata, { workspaceId, signal } = {}) {
      check(id(workspaceId)); const context = { generation, epoch: auth.epoch, workspaceId }; guard(context);
      const snapshot = structuredClone(metadata), input = identity(snapshot); if (!input) return null;
      const controller = new AbortController(); controllers.add(controller);
      const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      let timedOut = false;
      const timer = root.setTimeout(() => { timedOut = true; abort(); }, TIMEOUT_MS);
      try {
        check(!controller.signal.aborted, 'discovery_private_cancelled');
        const user = await abortable(auth.verify(), controller.signal); guard(context); check(user?.id === owner.userId, 'discovery_private_auth');
        const session = await abortable(auth.client.auth.getSession(), controller.signal); guard(context);
        check(!session.error && session.data?.session?.user?.id === owner.userId && text(session.data.session.access_token, 16384), 'discovery_private_auth');
        check(!controller.signal.aborted, 'discovery_private_cancelled');
        const response = await abortable(fetcher(endpoint.href, { method: 'POST', headers: { apikey: auth.config.key, Authorization: 'Bearer ' + session.data.session.access_token, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(input), signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' }), controller.signal);
        guard(context); check(!controller.signal.aborted, 'discovery_private_cancelled');
        if (response.status === 401 || response.status === 403) throw fault('discovery_private_auth');
        if (response.status === 429) throw fault('discovery_private_rate_limited');
        check(response.ok, 'discovery_private_network');
        const data = await abortable(readJSON(response, controller.signal), controller.signal); guard(context); check(!controller.signal.aborted, 'discovery_private_cancelled');
        if (plain(data) && Object.keys(data).length === 1) {
          if (data.error === 'setup_required') throw fault('discovery_private_setup');
          if (data.status === 'unavailable') return null;
          if (data.status === 'busy') throw fault('discovery_private_busy');
          if (data.status === 'rate_limited') throw fault('discovery_private_rate_limited');
        }
        const article = project(snapshot, data); guard(context); return article;
      } catch (error) {
        guard(context);
        if (controller.signal.aborted) throw fault(timedOut ? 'discovery_private_network' : 'discovery_private_cancelled');
        if (messages[error?.code]) throw fault(error.code);
        if (error instanceof SyntaxError || error instanceof TypeError && error.message?.includes('encoded data')) throw fault('discovery_private_invalid');
        throw fault('discovery_private_network');
      } finally { root.clearTimeout(timer); signal?.removeEventListener('abort', abort); controllers.delete(controller); }
    }
    return Object.freeze({ loadPrivateArticle, cancel, dispose() { if (disposed) return; disposed = true; cancel(); unlisten?.(); } });
  }
  return Object.freeze({ MAX_BYTES, TIMEOUT_MS, create, project, toImportInput });
});

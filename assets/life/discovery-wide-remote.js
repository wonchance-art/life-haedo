/* 넓게 찾기: account-scoped request to the haedo-news-wide function (docs/design-review/news-wide-feed.md).
 * Only the interest topics typed in news settings and the content language codes leave the device, and only
 * while the account setting is on. Results are link metadata (no body, no image); they are never written to a
 * public file, the service-worker cache or shared browser storage. Nothing here logs a topic or a title. */
(function (root, factory) {
  'use strict'; const api = factory(root);
  (root.HaedoLife ||= {}).DiscoveryWideRemote = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const SUPPLIER = 'google-news-rss', SUPPLIER_LABEL = 'Google 뉴스', LINK_PREFIX = 'https://news.google.com/', LINK_HOST = 'news.google.com';
  const LIMITS = Object.freeze({ topics: 8, topicLength: 40, items: 200, title: 500, name: 200, url: 2048, bytes: 1024 * 1024 });
  const LANGUAGES = Object.freeze(['ko', 'en']);
  const TIMEOUT_MS = 35000;
  const STATUSES = Object.freeze(['fresh', 'cached', 'stale', 'failed', 'limited']);
  const messages = {
    wide_auth: '로그인 계정을 다시 확인해 주세요.', wide_cancelled: '계정이나 화면이 바뀌어 이전 요청을 중단했습니다.',
    wide_not_enabled: '이 계정에서는 넓게 찾기를 쓸 수 없습니다.', wide_refused: '넓게 찾기 요청이 받아들여지지 않았습니다.',
    wide_invalid_topic: '서버가 받지 않는 주제가 있습니다.', wide_unavailable: '넓게 찾기를 지금 가져오지 못했습니다.',
    wide_invalid: '받은 결과의 형식을 확인하지 못했습니다.'
  };
  const fault = code => Object.assign(new Error(messages[code] || messages.wide_unavailable), { code: messages[code] ? code : 'wide_unavailable' });
  const check = (value, code = 'wide_invalid') => { if (!value) throw fault(code); };
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

  // --- topics. Which characters a topic may hold is the server's rule (supabase/functions/haedo-news-wide/topics.mjs,
  // contract 5a9466c) and is not written a second time here: the server's `invalid_topic` answer is asked for each
  // topic and shown as it is (see refused below). This side only brings a topic to the server's own spelling (NFC,
  // single spaces, trimmed) and keeps the two counts a request must respect: 1 to 40 characters, at most 8 topics.
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const REASONS = Object.freeze({
    empty: '빈 주제는 보내지 않습니다.', too_long: '40자까지 보낼 수 있습니다.',
    refused: '서버가 받지 않는 주제입니다. 따옴표·괄호·쌍점·별표 같은 기호, 빼기로 시작하는 낱말, 낱말 사이의 대문자 OR·AND·NOT은 받지 않습니다.',
    duplicate: '같은 주제를 이미 보냅니다.', over_limit: '위에서부터 8개까지만 보냅니다.'
  });
  // Examples for the settings help, as the contract lists them.
  const EXAMPLES = Object.freeze({ accepted: Object.freeze(['10%', '1,000원', 'Yahoo!', '왜?', 'Portland OR', 'K-pop', 'C++', 'R&D']), refused: Object.freeze(['"기후"', 'site:example.com', '50:50', '-날씨', '기후 OR 날씨', '기후*']) });
  function checkTopic(raw) {
    if (typeof raw !== 'string' || LONE_SURROGATE.test(raw)) return { ok: false, reason: 'empty' };
    if (raw.length > LIMITS.topicLength * 8) return { ok: false, reason: 'too_long' };
    const topic = raw.normalize('NFC').replace(/\p{Zs}+/gu, ' ').trim(), length = [...topic].length;
    if (length < 1) return { ok: false, reason: 'empty' };
    if (length > LIMITS.topicLength) return { ok: false, reason: 'too_long' };
    return { ok: true, topic };
  }
  const topicKey = topic => topic.toLowerCase();
  // Which of the typed topics are sent, in the order they are listed in settings: the first eight.
  // `manual` is the list of { id, label } the person typed and left checked; nothing else can be passed in.
  // `refused` holds the topics the server answered `invalid_topic` for; they are not sent again.
  function plan(manual, { refused = new Set() } = {}) {
    check(Array.isArray(manual) && manual.every(item => plain(item) && typeof item.id === 'string' && typeof item.label === 'string') && refused instanceof Set);
    const topics = [], rows = [], seen = new Set();
    for (const item of manual) {
      const result = checkTopic(item.label);
      if (!result.ok) { rows.push({ id: item.id, label: item.label, sent: false, reason: result.reason }); continue; }
      const key = topicKey(result.topic);
      if (refused.has(key)) { rows.push({ id: item.id, label: item.label, sent: false, reason: 'refused' }); continue; }
      if (seen.has(key)) { rows.push({ id: item.id, label: item.label, sent: false, reason: 'duplicate' }); continue; }
      if (topics.length >= LIMITS.topics) { rows.push({ id: item.id, label: item.label, sent: false, reason: 'over_limit' }); continue; }
      seen.add(key); topics.push(result.topic); rows.push({ id: item.id, label: item.label, sent: true, topic: result.topic });
    }
    return { topics, rows };
  }
  // Several answers (one request per topic, after the server refused a request as a whole) read as one.
  function merge(results) {
    check(Array.isArray(results) && results.every(result => plain(result) && Array.isArray(result.items) && Array.isArray(result.topics)));
    const items = [], seen = new Set(), times = results.map(result => result.fetchedAt).filter(Boolean).sort();
    for (const result of results) for (const item of result.items) if (!seen.has(item.id) && items.length < LIMITS.items) { seen.add(item.id); items.push(item); }
    return { supplier: SUPPLIER, items, topics: results.flatMap(result => result.topics), fetchedAt: times[0] || null, stale: results.some(result => result.stale), dropped: results.reduce((sum, result) => sum + (result.dropped || 0), 0) };
  }
  // The content-language setting decides the editions asked for; the supplier has Korean and English only.
  function languages(contentLanguages) {
    if (contentLanguages === null || contentLanguages === undefined) return [...LANGUAGES];
    check(Array.isArray(contentLanguages));
    return LANGUAGES.filter(code => contentLanguages.includes(code));
  }
  const requestKey = (topics, codes) => JSON.stringify([topics, codes]);

  // --- response: strict. An unknown field is ignored, an item that does not fit is dropped, nothing is trusted as HTML.
  const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim().length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) && !LONE_SURROGATE.test(value);
  const stamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
  function link(value) {
    if (typeof value !== 'string' || value.length > LIMITS.url || !value.startsWith(LINK_PREFIX) || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
    try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === LINK_HOST && !url.username && !url.password && !url.port ? value : null; } catch (_) { return null; }
  }
  function publisherUrl(value) {
    if (typeof value !== 'string' || value.length > LIMITS.url || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? value : null; } catch (_) { return null; }
  }
  function validate(raw, { now = Date.now() } = {}) {
    check(plain(raw) && raw.supplier === SUPPLIER && Array.isArray(raw.items) && Array.isArray(raw.topics) && typeof raw.stale === 'boolean');
    check(raw.fetchedAt === null || stamp(raw.fetchedAt));
    const items = [], seen = new Set(); let dropped = 0;
    for (const item of raw.items.slice(0, LIMITS.items)) {
      const address = plain(item) ? link(item.link) : null;
      if (!address || typeof item.id !== 'string' || !/^[a-f0-9]{32}$/.test(item.id) || seen.has(item.id) || !text(item.title, LIMITS.title) ||
          !(item.publishedAt === null || stamp(item.publishedAt)) || !(item.sourceName === null || text(item.sourceName, LIMITS.name)) ||
          !text(item.topic, LIMITS.topicLength * 4) || !LANGUAGES.includes(item.language)) { dropped++; continue; }
      seen.add(item.id);
      // A publication time far ahead of this clock is not shown as a time.
      const publishedAt = item.publishedAt !== null && Date.parse(item.publishedAt) <= now + 300000 ? new Date(Date.parse(item.publishedAt)).toISOString() : null;
      items.push({ id: item.id, title: item.title, link: address, publishedAt, sourceName: item.sourceName === null ? null : item.sourceName.trim(),
        sourceUrl: item.sourceUrl === null || item.sourceUrl === undefined ? null : publisherUrl(item.sourceUrl), topic: item.topic, language: item.language });
    }
    dropped += Math.max(0, raw.items.length - LIMITS.items);
    const topics = [];
    for (const row of raw.topics.slice(0, LIMITS.topics * LANGUAGES.length)) {
      if (!plain(row) || !text(row.topic, LIMITS.topicLength * 4) || !LANGUAGES.includes(row.language) || !STATUSES.includes(row.status) ||
          !(row.fetchedAt === null || stamp(row.fetchedAt)) || !Number.isSafeInteger(row.count) || row.count < 0) continue;
      topics.push({ topic: row.topic, language: row.language, status: row.status, fetchedAt: row.fetchedAt, count: row.count,
        reason: typeof row.reason === 'string' && /^[a-z_]{1,40}$/.test(row.reason) ? row.reason : null });
    }
    return { supplier: SUPPLIER, items, topics, fetchedAt: raw.fetchedAt, stale: raw.stale, dropped };
  }
  // A received item in the shape the news list and the reaction snapshot use. Link metadata only.
  function toArticle(item, { sourceId, canonicalUrl, fetchedAt }) {
    return { id: item.id, sourceId, sourceName: item.sourceName || SUPPLIER_LABEL, url: item.link, canonicalUrl: canonicalUrl(item.link), title: item.title, author: null,
      language: item.language, tags: [], publishedAt: item.publishedAt, updatedAt: null, sortDate: item.publishedAt, dateStatus: item.publishedAt ? 'valid' : 'unknown', dateBasis: item.publishedAt ? 'published' : 'unknown',
      fetchedAt, summary: '', coverage: 'link_only', rights: { label: 'Google 뉴스에서 받은 제목과 링크 · 본문 미확보', url: null, mode: 'metadata_only' }, wide: { topic: item.topic, sourceUrl: item.sourceUrl } };
  }

  async function readJSON(response) {
    check(/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || ''));
    const body = await response.text(); check(new TextEncoder().encode(body).length <= LIMITS.bytes);
    return JSON.parse(body);
  }
  function abortable(promise, signal) {
    const pending = Promise.resolve(promise);
    if (signal.aborted) { pending.catch(() => {}); return Promise.reject(fault('wide_cancelled')); }
    return new Promise((resolve, reject) => {
      const abort = () => reject(fault('wide_cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      pending.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    });
  }
  function create({ auth = root.HaedoAuth, storage, isCurrent = () => true, fetcher = root.fetch?.bind(root) } = {}) {
    check(storage?.isAccountScoped && storage.account && auth?.verify && auth.client?.auth?.getSession && typeof fetcher === 'function', 'wide_auth');
    const owner = { ...storage.account }, baseUrl = String(auth.config?.url || '').replace(/\/$/, '');
    const endpoint = new URL(baseUrl + '/functions/v1/haedo-news-wide'), clearEndpoint = new URL(baseUrl + '/rest/v1/rpc/life_news_wide_clear');
    check(endpoint.protocol === 'https:' && new URL(owner.projectUrl).origin === endpoint.origin && typeof auth.config.key === 'string' && auth.config.key.length > 0, 'wide_auth');
    let disposed = false, generation = 0; const controllers = new Set();
    function cancel() { generation++; for (const controller of controllers) controller.abort(); controllers.clear(); }
    const unlisten = auth.onAccountChange?.(() => {
      const account = auth.getAccount?.();
      if (account?.userId !== owner.userId || account?.projectUrl !== owner.projectUrl) cancel();
    });
    // A response is used only by the account, workspace and screen that asked for it.
    function guard(context) {
      check(!disposed && generation === context.generation && auth.epoch === context.epoch && isCurrent(context.workspaceId) && auth.user?.id === owner.userId &&
        auth.getAccount?.()?.userId === owner.userId && auth.getAccount?.()?.projectUrl === owner.projectUrl && String(auth.config?.url || '').replace(/\/$/, '') === owner.projectUrl.replace(/\/$/, ''), 'wide_cancelled');
    }
    async function send(url, body, { workspaceId, signal }, read) {
      const context = { generation, epoch: auth.epoch, workspaceId }; guard(context);
      const controller = new AbortController(); controllers.add(controller);
      const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      let timedOut = false; const timer = root.setTimeout(() => { timedOut = true; abort(); }, TIMEOUT_MS);
      try {
        check(!controller.signal.aborted, 'wide_cancelled');
        const user = await abortable(auth.verify(), controller.signal); guard(context); check(user?.id === owner.userId, 'wide_auth');
        const session = await abortable(auth.client.auth.getSession(), controller.signal); guard(context);
        check(!session.error && session.data?.session?.user?.id === owner.userId && typeof session.data.session.access_token === 'string' && session.data.session.access_token.length > 0, 'wide_auth');
        const response = await abortable(fetcher(url.href, { method: 'POST', headers: { apikey: auth.config.key, Authorization: 'Bearer ' + session.data.session.access_token, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body), signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' }), controller.signal);
        guard(context);
        // Only 401 is a sign-in problem. A 5xx is temporary and never drops the session.
        if (response.status === 401) throw fault('wide_auth');
        if (response.status === 403 || response.status === 400) {
          let code = null; try { code = (await abortable(readJSON(response), controller.signal))?.error; } catch (_) { code = null; }
          guard(context);
          throw fault(code === 'not_enabled_for_account' ? 'wide_not_enabled' : code === 'invalid_topic' ? 'wide_invalid_topic' : 'wide_refused');
        }
        check(response.ok, 'wide_unavailable');
        const data = await abortable(readJSON(response), controller.signal); guard(context);
        const result = read(data); guard(context); return result;
      } catch (error) {
        guard(context);
        if (controller.signal.aborted) throw fault(timedOut ? 'wide_unavailable' : 'wide_cancelled');
        if (messages[error?.code]) throw fault(error.code);
        if (error instanceof SyntaxError) throw fault('wide_invalid');
        throw fault('wide_unavailable');
      } finally { root.clearTimeout(timer); signal?.removeEventListener('abort', abort); controllers.delete(controller); }
    }
    // topics: output of plan().topics only. The request body is exactly these two fields. A request outside that
    // shape is refused as a rejected promise, like every other failure, and nothing is sent.
    async function load({ topics, languages: codes, workspaceId, signal } = {}) {
      check(Array.isArray(topics) && topics.length >= 1 && topics.length <= LIMITS.topics && topics.every(topic => checkTopic(topic).ok && checkTopic(topic).topic === topic), 'wide_invalid_topic');
      check(Array.isArray(codes) && codes.length >= 1 && codes.length <= LANGUAGES.length && codes.every(code => LANGUAGES.includes(code)) && new Set(codes).size === codes.length, 'wide_refused');
      return send(endpoint, { topics: [...topics], languages: [...codes] }, { workspaceId, signal }, data => validate(data));
    }
    function clear({ workspaceId, signal } = {}) {
      return send(clearEndpoint, {}, { workspaceId, signal }, data => {
        check(plain(data) && ['cleared', 'not_allowed'].includes(data.status) && (data.removed === undefined || Number.isSafeInteger(data.removed) && data.removed >= 0));
        return { status: data.status, removed: data.removed ?? 0 };
      });
    }
    return Object.freeze({ load, clear, cancel, dispose() { if (disposed) return; disposed = true; cancel(); unlisten?.(); } });
  }
  return Object.freeze({ SUPPLIER, SUPPLIER_LABEL, LINK_PREFIX, LIMITS, LANGUAGES, REASONS, EXAMPLES, TIMEOUT_MS, checkTopic, topicKey, plan, merge, languages, requestKey, link, validate, toArticle, create, messages });
});

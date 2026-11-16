/* AI 추천 (news_pick, docs/design-review/news-pick.md). The device collects and checks the candidates; Claude Haiku 5.5
 * on the haedo-ai function only answers candidate numbers. What leaves the device is exactly:
 *   { requestId, task: 'news_pick', topics, language, candidates: [{ n, title, publisher, publishedAt }] }
 * topics are the interest topics typed in news settings and left checked (first eight), language is the content
 * language choice, and each candidate is public metadata of an article already in this list. No like, saved or read
 * item, word taken from them, account, workspace or post ID, address, e-mail or device detail is ever added.
 * An answer is read against the list that was sent: a number that was not sent is dropped, and the screen shows its
 * own candidate record for each number, so the model can bring in no address, title or date. Answers live in the
 * screen's memory only (never a public file, the service-worker cache or browser storage). The one thing kept in
 * browser storage is how many picks were asked today (a date and a count, nothing else). Nothing here logs. */
(function (root, factory) {
  'use strict'; const api = factory(root);
  (root.HaedoLife ||= {}).DiscoveryPick = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const TASK = 'news_pick', PROVIDER = 'Anthropic', MODEL = 'claude-haiku-5-5';
  // Same numbers as the server's PICK (supabase/functions/haedo-ai/handler.mjs). `bytes` is the device's budget for the
  // whole request body, under the server's 64 KiB limit with room for JSON escapes the estimate does not see.
  const LIMITS = Object.freeze({ topics: 8, topicLength: 40, candidates: 150, title: 300, publisher: 100, picks: 20, reason: 60, clusterSize: 10, bytes: 56 * 1024 });
  // A found link (넓게 찾기) older than this is not a candidate; fixed-source articles keep the catalog's own rules.
  const WIDE_WINDOW_MS = 72 * 60 * 60 * 1000, FUTURE_MS = 5 * 60 * 1000;
  // A pick is asked when news opens, on 지금 갱신, and when topics or languages change; never by the timed refresh.
  // The same topics and language reuse an answer this long; a refresh the person asks for always asks.
  const REUSE_MS = 30 * 60 * 1000;
  // At most this many picks a day on one device (see the cost estimate in the design note).
  const DAILY_LIMIT = 12;
  const COUNT_KEY = 'caeyeon_life_news_pick_calls';
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const CONTROL = /[\u0000-\u001f\u007f]/;
  const ADDRESS = /https?:|www\.|[a-z0-9-]+\.(?:com|net|org|kr|io|co|jp|dev|app|news)\b/i;
  const fault = (code = 'wide_invalid') => Object.assign(new Error('추천 결과를 확인하지 못했습니다.'), { code });
  const check = (value, code) => { if (!value) throw fault(code); };
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const codePoints = value => [...value].length;
  const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !CONTROL.test(value) && !LONE_SURROGATE.test(value);
  const clean = value => typeof value === 'string' ? value.normalize('NFC').replace(/\s+/gu, ' ').trim() : '';
  const bytes = value => new TextEncoder().encode(value).length;

  // The content-language setting as one word: 한국어만, 영어만, or both / not chosen.
  function language(contentLanguages) {
    if (!Array.isArray(contentLanguages)) return 'any';
    const ko = contentLanguages.includes('ko'), en = contentLanguages.includes('en');
    return ko && !en ? 'ko' : en && !ko ? 'en' : 'any';
  }
  // The typed topics that go: `manual` is the { id, label } list the person typed and left checked, in order.
  // The first eight distinct ones (case ignored) of 1-40 characters; nothing else can be passed in.
  function topics(manual) {
    check(Array.isArray(manual) && manual.every(item => plain(item) && typeof item.label === 'string'), 'wide_refused');
    const out = [], seen = new Set();
    for (const item of manual) {
      const topic = clean(item.label), key = topic.toLowerCase();
      if (!topic || codePoints(topic) > LIMITS.topicLength || CONTROL.test(topic) || LONE_SURROGATE.test(topic) || seen.has(key)) continue;
      seen.add(key); out.push(topic); if (out.length >= LIMITS.topics) break;
    }
    return out;
  }
  function https(value) {
    if (typeof value !== 'string' || value.length > 2048) return false;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch (_) { return false; }
  }
  const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
  /* Candidates from the rows of this list (fixed-source and found ones, already without kept, judged, turned-off or
   * other-language articles). Kept: one per canonical address, an https link, a title and a publisher; a found link
   * only with a publication time in the last 72 hours. Newest first (unknown times last), at most 150.
   * `publisherOf(article)` gives the name shown on the card. */
  function candidates(rows, { now = Date.now(), isWide = () => false, publisherOf = article => article.sourceName } = {}) {
    check(Array.isArray(rows), 'wide_refused');
    const seen = new Set(), list = [];
    for (const row of rows) {
      const article = row?.article || row;
      if (!plain(article) || typeof article.canonicalUrl !== 'string' || !article.canonicalUrl || seen.has(article.canonicalUrl)) continue;
      if (!https(article.url) || !https(article.canonicalUrl)) continue;
      const title = clean(article.title), publisher = clean(publisherOf(article) || '');
      if (!text(title, LIMITS.title) || !text(publisher, LIMITS.publisher)) continue;
      const at = time(article.publishedAt), valid = at !== null && at <= now + FUTURE_MS && (article.dateStatus === undefined || article.dateStatus === 'valid');
      if (isWide(article) && !(valid && now - at <= WIDE_WINDOW_MS)) continue;
      seen.add(article.canonicalUrl);
      list.push({ canonicalUrl: article.canonicalUrl, title, publisher, publishedAt: valid ? new Date(at).toISOString() : null, at: valid ? at : -Infinity });
    }
    list.sort((a, b) => b.at - a.at || (a.canonicalUrl < b.canonicalUrl ? -1 : a.canonicalUrl > b.canonicalUrl ? 1 : 0));
    return list.slice(0, LIMITS.candidates).map(({ at, ...candidate }) => candidate);
  }
  /* The request. Candidates are numbered 1, 2, 3, ... in that order and added while the body stays within the byte
   * budget. `sent` maps each number back to its candidate (canonical address) on this device only. */
  function prepare({ requestId, topics: chosen, language: code, candidates: list }) {
    check(typeof requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId), 'wide_refused');
    check(Array.isArray(chosen) && chosen.length <= LIMITS.topics && chosen.every(topic => text(topic, LIMITS.topicLength * 4) && codePoints(topic) <= LIMITS.topicLength), 'wide_refused');
    check(['ko', 'en', 'any'].includes(code) && Array.isArray(list), 'wide_refused');
    const body = { requestId, task: TASK, topics: [...chosen], language: code, candidates: [] }, sent = new Map();
    let size = bytes(JSON.stringify(body));
    for (const candidate of list.slice(0, LIMITS.candidates)) {
      const record = { n: body.candidates.length + 1, title: candidate.title, publisher: candidate.publisher, publishedAt: candidate.publishedAt };
      const cost = bytes(JSON.stringify(record)) + 1;
      if (size + cost > LIMITS.bytes) break;
      size += cost; body.candidates.push(record); sent.set(record.n, candidate.canonicalUrl);
    }
    check(body.candidates.length > 0, 'pick_empty');
    return Object.freeze({ body, sent, bytes: size, provider: PROVIDER, model: MODEL });
  }
  /* The answer, read against what was sent. The status, request ID and task must match. A pick whose number was not
   * sent (or comes again) is dropped; a reason that is too long or holds an address becomes ''. Any other field the
   * answer may carry is ignored: the result is canonical addresses of this device's own candidates. */
  function read(raw, prepared) {
    check(plain(raw) && raw.status === 'ok' && raw.task === TASK && typeof raw.requestId === 'string' && raw.requestId.toLowerCase() === prepared.body.requestId.toLowerCase());
    check(Array.isArray(raw.picks) && Array.isArray(raw.clusters));
    const picks = [], seen = new Set();
    for (const pick of raw.picks.slice(0, LIMITS.picks * 3)) {
      if (!plain(pick) || !Number.isSafeInteger(pick.n) || !prepared.sent.has(pick.n) || seen.has(pick.n) || picks.length >= LIMITS.picks) continue;
      seen.add(pick.n);
      const reason = typeof pick.reason === 'string' ? pick.reason.trim() : '';
      const keep = reason && codePoints(reason) <= LIMITS.reason && !ADDRESS.test(reason) && !CONTROL.test(reason) && !/[<>]/.test(reason) && !LONE_SURROGATE.test(reason);
      picks.push({ canonicalUrl: prepared.sent.get(pick.n), reason: keep ? reason : '' });
    }
    check(picks.length > 0);
    const clusters = [], clustered = new Set();
    for (const cluster of raw.clusters.slice(0, LIMITS.picks)) {
      if (!Array.isArray(cluster)) continue;
      const members = [...new Set(cluster.filter(n => Number.isSafeInteger(n) && prepared.sent.has(n) && !clustered.has(n)))].slice(0, LIMITS.clusterSize);
      if (members.length < 2) continue;
      members.forEach(n => clustered.add(n)); clusters.push(members.map(n => prepared.sent.get(n)));
    }
    return { picks, clusters };
  }
  /* The list in AI 추천: the picked rows first in the answer's order (one per cluster of the same story), then every
   * other row in the order it already had. A pick that is no longer in the list (kept, judged, turned off) is skipped. */
  function order(rows, answer) {
    if (!answer?.picks?.length) return rows;
    const url = row => row.article.canonicalUrl, byUrl = new Map(rows.map(row => [url(row), row]));
    const clusterOf = new Map(); (answer.clusters || []).forEach((members, index) => members.forEach(member => clusterOf.set(member, index)));
    const first = [], used = new Set(), clustersUsed = new Set();
    for (const pick of answer.picks) {
      const row = byUrl.get(pick.canonicalUrl); if (!row || used.has(pick.canonicalUrl)) continue;
      const cluster = clusterOf.get(pick.canonicalUrl);
      if (cluster !== undefined && clustersUsed.has(cluster)) continue;
      if (cluster !== undefined) clustersUsed.add(cluster);
      used.add(pick.canonicalUrl); first.push({ ...row, pick: { reason: pick.reason } });
    }
    return [...first, ...rows.filter(row => !used.has(url(row)))];
  }
  const requestKey = (chosen, code) => JSON.stringify([chosen, code]);
  // The local calendar day on this device.
  const day = now => { const d = new Date(now); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  /* Today's count of picks asked on this device. Browser storage holds { day, count } only; when it cannot be read
   * or written (private window, blocked storage) the screen's own count is used. */
  function counter({ store = (() => { try { return root.localStorage; } catch (_) { return null; } })(), now = () => Date.now(), limit = DAILY_LIMIT } = {}) {
    let memory = { day: day(now()), count: 0 };
    const load = () => {
      const today = day(now());
      try {
        const value = JSON.parse(store?.getItem(COUNT_KEY) || 'null');
        if (plain(value) && Object.keys(value).length === 2 && value.day === today && Number.isSafeInteger(value.count) && value.count >= 0) memory = { day: today, count: Math.max(value.count, memory.day === today ? memory.count : 0) };
      } catch (_) { /* the screen's count stands */ }
      if (memory.day !== today) memory = { day: today, count: 0 };
      return memory;
    };
    return Object.freeze({
      remaining() { return Math.max(0, limit - load().count); },
      take() {
        const value = load(); if (value.count >= limit) return false;
        memory = { day: value.day, count: value.count + 1 };
        try { store?.setItem(COUNT_KEY, JSON.stringify(memory)); } catch (_) { /* counted in memory */ }
        return true;
      }
    });
  }
  return Object.freeze({ TASK, PROVIDER, MODEL, LIMITS, WIDE_WINDOW_MS, REUSE_MS, DAILY_LIMIT, COUNT_KEY, language, topics, candidates, prepare, read, order, requestKey, counter });
});

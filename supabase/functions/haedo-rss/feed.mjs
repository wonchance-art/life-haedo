/* RSS 2.0 / Atom 1.0 text acquisition. HTML remains inert source text: this
 * adapter never renders markup, downloads enclosures, or visits article URLs. */
export const LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, itemBytes: 1024 * 1024, items: 100, pages: 2, timeout: 10000 });
export const ALLOWED_HOSTS = Object.freeze([]); // A reviewed real source has not been supplied.
export const failure = code => Object.assign(new Error(code), { code });
const need = (ok, code = 'invalid_feed') => { if (!ok) throw failure(code); };
const enc = new TextEncoder();
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' ? v : object(v) && typeof v['#text'] === 'string' &&
  Object.keys(v).every(k => k === '#text' || k.startsWith('@_')) ? v['#text'] : null;
const single = (v, key) => { need(!Array.isArray(v?.[key])); return v?.[key]; };
const list = v => v === undefined ? [] : Array.isArray(v) ? v : [v];
function checkEntities(xml) {
  need(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uD800-\uDFFF\uFFFE\uFFFF]/u.test(xml));
  // FXP intentionally tolerates undeclared/invalid references. Reject them
  // before parsing rather than silently repairing exact source text. CDATA
  // and comments contain literal ampersands, not XML character references.
  for (let at = 0; at < xml.length; at++) {
    if (xml.startsWith('<![CDATA[', at) || xml.startsWith('<!--', at)) {
      const cdata = xml.startsWith('<![CDATA[', at), end = xml.indexOf(cdata ? ']]>' : '-->', at + (cdata ? 9 : 4));
      need(end >= 0); at = end + 2; continue;
    }
    if (xml[at] !== '&') continue;
    const end = xml.indexOf(';', at + 1); need(end > at && end - at <= 16);
    const ref = xml.slice(at + 1, end);
    if (!['amp','lt','gt','quot','apos'].includes(ref)) {
      need(/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(ref));
      const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      need([9,10,13].includes(code) || code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) && code !== 0xfffe && code !== 0xffff);
    }
    at = end;
  }
}
export async function sha256(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function safeURL(raw, allowedHosts = ALLOWED_HOSTS) {
  need(typeof raw === 'string' && raw.length <= 2048 && !/[\s\\\u0000-\u001f\u007f]/u.test(raw), 'blocked_url');
  // Check authority before URL normalizes explicit :443, Unicode and IP forms.
  const authority = /^https:\/\/([^/?#]+)/.exec(raw)?.[1];
  need(authority && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(authority) &&
    !authority.includes('..') && !/^\d+(?:\.\d+)*$/.test(authority) &&
    !['localhost','metadata.google.internal'].includes(authority) &&
    !['.localhost','.local','.internal','.lan'].some(s => authority.endsWith(s)) &&
    allowedHosts.includes(authority), 'blocked_url');
  let url; try { url = new URL(raw); } catch (_) { throw failure('blocked_url'); }
  need(url.protocol === 'https:' && url.hostname === authority && !url.username && !url.password && !url.port && !url.hash && url.href.length <= 2048, 'blocked_url');
  return url.href;
}
function sourceURL(raw, base) {
  if (typeof raw !== 'string' || !raw.trim() || /[\s\\\u0000-\u001f\u007f]/u.test(raw.trim())) return null;
  try {
    const url = new URL(raw.trim(), base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) return null;
    return url.href; // Identity is exact, including parameters and fragment. Never fetched.
  } catch (_) { return null; }
}
function date(raw, atom) {
  if (!raw) return null;
  raw = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
  const rfc = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(GMT|UT|[+-]\d{4})$/;
  const found = (atom ? iso : rfc).exec(raw);
  if (!found) return null;
  const parts = atom ? found.slice(1, 7).map(Number) : [Number(found[3]), ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(found[2]) + 1, Number(found[1]), Number(found[4]), Number(found[5]), Number(found[6] || 0)];
  const [y,m,d,h,min,s] = parts;
  const test = new Date(Date.UTC(y,m-1,d,h,min,s));
  if (y < 1970 || m < 1 || m > 12 || d < 1 || h > 23 || min > 59 || s > 59 || test.getUTCMonth() !== m-1 || test.getUTCDate() !== d) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
export function createParser({ XMLParser, XMLValidator }) {
  need(typeof XMLParser === 'function' && typeof XMLValidator?.validate === 'function', 'setup_required');
  let nodes = 0;
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: false,
    parseTagValue: false, parseAttributeValue: false, alwaysCreateTextNode: true, ignoreDeclaration: true,
    maxNestedTags: 24, updateTag: (name, _path, attrs) => {
      need(++nodes <= 20000 && !Object.hasOwn(attrs, '@_xml:base'));
      return name; // xml:base needs an explicit inherited-base fidelity contract.
    },
    processEntities: { enabled: true, maxTotalExpansions: 10000, maxExpandedLength: LIMITS.bytes },
    isArray: (_name, path) => ['rss.channel.item', 'feed.entry', 'feed.link', 'feed.entry.link', 'rss.channel.atom:link'].includes(path) });
  return async (xml, baseURL) => {
    need(typeof xml === 'string' && enc.encode(xml).length <= LIMITS.bytes, 'feed_too_large');
    checkEntities(xml);
    need(!/<!DOCTYPE|<!ENTITY/i.test(xml) && !/<\?(?!xml(?:\s|\?>))/i.test(xml));
    need(!/^\s*<\?xml[^?]*encoding\s*=\s*['"](?!utf-8['"])/i.test(xml));
    need(XMLValidator.validate(xml) === true); nodes = 0;
    let doc; try { doc = parser.parse(xml); } catch (_) { throw failure('invalid_feed'); }
    const atom = !!doc.feed;
    need(Object.keys(doc).length === 1);
    const feed = atom ? doc.feed : single(doc.rss, 'channel');
    need(object(feed) && (atom ? feed['@_xmlns'] === 'http://www.w3.org/2005/Atom' : doc.rss?.['@_version'] === '2.0'));
    const entries = list(feed[atom ? 'entry' : 'item']);
    need(entries.length <= LIMITS.items, 'item_limit');
    const items = [];
    for (const entry of entries) {
      need(object(entry));
      let rawURL, itemHold = null;
      if (atom) {
        const links = list(entry.link).filter(x => object(x) && (!x['@_rel'] || x['@_rel'] === 'alternate'));
        if (links.length > 1) itemHold = 'ambiguous_links';
        else rawURL = links[0]?.['@_href'];
      } else rawURL = text(single(entry, 'link'));
      const url = sourceURL(rawURL, baseURL);
      const rawID = text(single(entry, atom ? 'id' : 'guid'));
      const id = rawID?.trim() ? rawID : null;
      need(!id || id.length <= 2043, 'item_limit');
      const rawTitle = text(single(entry, 'title'));
      const title = rawTitle?.trim() ? rawTitle : '제목 없음';
      need(title.length <= 400, 'item_limit');
      const body = atom ? single(entry, 'content') ?? single(entry, 'summary') : single(entry, 'content:encoded') ?? single(entry, 'description');
      // Unsupported item representations stay held; unrelated feed entries
      // continue. Do not manufacture exact text from an XHTML object tree.
      const unsupported = atom && (body?.['@_src'] || body?.['@_type'] && !['text','html'].includes(body['@_type']));
      const content = body === undefined || unsupported ? null : text(body);
      if (unsupported || body !== undefined && content === null) itemHold ||= 'unsupported_content';
      const publishedField = single(entry, atom ? 'published' : 'pubDate');
      // 2026-11-05 orchestrator decision: only absence (not invalidity) of
      // Atom published permits updated fallback. See README source conditions.
      const dateField = atom && publishedField === undefined ? single(entry, 'updated') : publishedField;
      const rawDate = text(dateField);
      const published = date(rawDate, atom);
      const identity = id ? (atom ? 'atom:' : 'guid:') + id : url ? 'url:' + url : 'unidentified:' + await sha256(JSON.stringify(entry));
      need(identity.length <= 2048, 'item_limit');
      let held = itemHold || (!id && !url ? 'missing_identity' : !url ? 'missing_url' : !content ? 'missing_content' : dateField !== undefined && !published ? 'invalid_date' : null);
      if (content !== null && enc.encode(content).length > LIMITS.itemBytes) held = 'content_too_large';
      items.push({ identity, title, url, content_text: content, content_hash: content === null ? null : await sha256(content), published_at: published,
        ...(held ? { hold_reason: held } : {}) });
    }
    markConflicts(items);
    const nextLinks = list(feed[atom ? 'link' : 'atom:link']).filter(x => object(x) && x['@_rel'] === 'next');
    need(nextLinks.length <= 1);
    let next = null;
    if (nextLinks.length) {
      const href = nextLinks[0]['@_href'];
      // URL(undefined, base) produces a real /undefined path. Validate before
      // resolution, including whitespace that URL() would silently discard.
      need(typeof href === 'string' && href.length > 0 && !/[\s\\\u0000-\u001f\u007f]/u.test(href));
      try { next = new URL(href, baseURL).href; } catch (_) { throw failure('invalid_feed'); }
      need(next.length <= 2048); // URL percent-encoding may expand a short Unicode href.
    }
    return { items, next };
  };
}
function markConflicts(items) {
  const map = new Map();
  for (const item of items) {
    const previous = map.get(item.identity);
    if (previous && (previous.url !== item.url || previous.content_hash !== item.content_hash || previous.published_at !== item.published_at)) {
      for (const row of items) if (row.identity === item.identity) row.hold_reason = 'identity_conflict';
    } else map.set(item.identity, item);
  }
}
export async function readBounded(response, limit) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) { await response.body?.cancel(); throw failure('feed_too_large'); }
  need(response.body, 'network_error');
  const reader = response.body.getReader(), chunks = []; let count = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; count += part.value.length; need(count <= limit, 'feed_too_large'); chunks.push(part.value); }
    const bytes = new Uint8Array(count); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (_) { throw failure('invalid_feed'); }
  } finally { try { await reader.cancel(); } catch (_) { /* consumed */ } reader.releaseLock(); }
}
export async function collect({ url, cursor = null, active = false, scanPages = 0, known, parse, fetcher = fetch, allowedHosts = ALLOWED_HOSTS, signal }) {
  const initial = safeURL(url, allowedHosts);
  need(Number.isSafeInteger(scanPages) && scanPages >= 0 && scanPages <= 50, 'server_error');
  let next = cursor || initial, bytes = 0;
  const items = [], pages = [], visited = new Set(), observedThisRun = new Set();
  const result = (error = null) => {
    markConflicts(items);
    return { items, pages, cursor: next, complete: !next && !error, bytes, error };
  };
  // A partial active sweep resumes its oldest unconsumed page. Once that tail
  // completes, SQL schedules an immediate fresh-head sweep. No head probe is
  // marked observed while a tail gap remains. This avoids budget starvation
  // and newly observed head IDs hiding an unconsumed middle section.
  for (let requestCount = 0; requestCount < LIMITS.pages && next; requestCount++) {
    if (scanPages + pages.length >= 50) return result(active ? 'catchup_page_limit' : 'baseline_page_limit');
    if (items.length >= LIMITS.items || bytes >= LIMITS.bytes) return result();
    const attempted = next;
    try {
      const current = safeURL(next, allowedHosts);
      need(new URL(current).origin === new URL(initial).origin && !visited.has(current), 'blocked_url');
      visited.add(current);
      let res;
      try { res = await fetcher(current, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(LIMITS.timeout)]) : AbortSignal.timeout(LIMITS.timeout),
        headers: { Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml', 'Accept-Encoding': 'identity', 'User-Agent': 'HaedoRSS/1.0' } }); }
      catch (_) { throw failure('network_error'); }
      if (res.redirected || res.url && res.url !== current) { await res.body?.cancel(); throw failure('blocked_url'); }
      if (!res.ok) { await res.body?.cancel(); throw failure(res.status === 429 ? 'rate_limited' : res.status === 401 || res.status === 403 ? 'blocked_url' : 'network_error'); }
      let xml;
      try { xml = await readBounded(res, LIMITS.bytes - bytes); }
      catch (error) {
        // The remaining run budget may be too small for an otherwise valid
        // page. Retry that whole page with a fresh budget, never truncate it.
        if (pages.length && error.code === 'feed_too_large') return result();
        throw error;
      }
      bytes += enc.encode(xml).length;
      const parsed = await parse(xml, current);
      if (items.length + parsed.items.length > LIMITS.items) return result();
      const identities = [...new Set(parsed.items.map(item => item.identity))];
      let observed = [];
      if (typeof known === 'function') {
        observed = await known(identities);
        need(Array.isArray(observed) && observed.length <= identities.length && observed.every(id => identities.includes(id)), 'server_error');
      }
      if (!active && (!identities.length || identities.every(id => observed.includes(id) || observedThisRun.has(id)))) {
        return result('baseline_stalled');
      }
      const nextURL = parsed.next;
      if (nextURL) {
        safeURL(nextURL, allowedHosts);
        need(new URL(nextURL).origin === new URL(initial).origin && !visited.has(nextURL), 'blocked_url');
      }
      items.push(...parsed.items);
      pages.push({ url: current, identities, next: nextURL });
      identities.forEach(id => observedThisRun.add(id));
      next = nextURL;
      // known() is a cycle-start snapshot for active sweeps. Rows discovered
      // during this sweep must not prematurely terminate a shifted page tail.
      if (active && identities.length && typeof known === 'function' && identities.every(id => !id.startsWith('unidentified:') && observed.includes(id))) next = null;
    } catch (error) {
      next = attempted;
      if (!pages.length) throw error;
      return result(error?.code || 'network_error');
    }
  }
  return result(next && scanPages + pages.length >= 50 ? active ? 'catchup_page_limit' : 'baseline_page_limit' : null);
}

/* Item normalization for haedo-news-wide. An item is link-only metadata:
 *   { id, title, link, publishedAt, sourceName, sourceUrl }
 * No body, summary, description or image is kept. Titles and names are plain
 * text: the client must set them as text, never as HTML. */

export const ITEM_LIMITS = Object.freeze({ perTopic: 30, total: 200, raw: 200, title: 300, link: 2048, sourceName: 100 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 24 * 60 * 60 * 1000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const encoder = new TextEncoder();

/** Plain one-line text: NFC, no control or direction characters, single spaces. Null when empty. */
export function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const cleaned = value.normalize('NFC')
    // Invisible and direction characters become a space; ZWNJ/ZWJ (U+200C/200D) stay: scripts and emoji need them.
    .replace(/[\p{Cc}\p{Zl}\p{Zp}\u00ad\u061c\u115f\u1160\u180e\u200b\u200e\u200f\u202a-\u202e\u2060-\u2069\u3164\ufeff\uffa0\ufff9-\ufffb\ufffe\uffff\u{e0000}-\u{e007f}]/gu, ' ')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, ' ')
    .replace(/[\p{Zs} ]+/gu, ' ').trim();
  if (!cleaned) return null;
  const chars = [...cleaned];
  return chars.length <= max ? cleaned : chars.slice(0, max - 1).join('').trimEnd() + '…';
}

/** An https address on one of the supplier's link hosts, or null. Never fetched here. */
export function safeLink(raw, hosts) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > ITEM_LIMITS.link || /[\s\\\u0000-\u001f\u007f-\u009f]/u.test(value)) return null;
  // Authority is read from the raw text first: userinfo, ports, upper case and
  // Unicode look-alikes never reach URL normalization.
  const authority = /^https:\/\/([^/?#]+)/.exec(value)?.[1];
  if (!authority || !hosts.includes(authority)) return null;
  let url; try { url = new URL(value); } catch (_) { return null; }
  if (url.protocol !== 'https:' || url.hostname !== authority || url.username || url.password || url.port) return null;
  return url.href.length <= ITEM_LIMITS.link ? url.href : null;
}

/** The outlet's own https home address for display, or null. Never fetched here. */
export function safeSourceURL(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > ITEM_LIMITS.link || /[\s\\\u0000-\u001f\u007f-\u009f]/u.test(value)) return null;
  const authority = /^https:\/\/([^/?#]+)/.exec(value)?.[1];
  if (!authority || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(authority) || !authority.includes('.') || authority.includes('..') ||
    /^\d+(?:\.\d+)*$/.test(authority) || ['.localhost', '.local', '.internal', '.lan'].some(suffix => authority.endsWith(suffix))) return null;
  let url; try { url = new URL(value); } catch (_) { return null; }
  if (url.protocol !== 'https:' || url.hostname !== authority || url.username || url.password || url.port) return null;
  return url.href.length <= ITEM_LIMITS.link ? url.href : null;
}

/** RFC 822 feed date to ISO, or null. A date more than a day ahead is not trusted. */
export function publishedAt(raw, now = Date.now()) {
  if (typeof raw !== 'string') return null;
  const found = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(GMT|UT|[+-]\d{4})$/.exec(raw.trim());
  if (!found) return null;
  const y = Number(found[3]), m = MONTHS.indexOf(found[2]), d = Number(found[1]), h = Number(found[4]), min = Number(found[5]), s = Number(found[6] || 0);
  const probe = new Date(Date.UTC(y, m, d, h, min, s));
  if (y < 1990 || d < 1 || h > 23 || min > 59 || s > 59 || probe.getUTCMonth() !== m || probe.getUTCDate() !== d) return null;
  const zone = /^[+-]\d{4}$/.test(found[7]) ? (found[7][0] === '-' ? -1 : 1) * (Number(found[7].slice(1, 3)) * 60 + Number(found[7].slice(3))) : 0;
  const time = probe.getTime() - zone * 60000;
  return Number.isFinite(time) && time <= now + DAY ? new Date(time).toISOString() : null;
}

async function linkID(link) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(link)));
  return [...digest.slice(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

const time = item => item.publishedAt === null ? -Infinity : Date.parse(item.publishedAt);
/** Newest first; undated items last; otherwise the given order. */
export const newestFirst = items => items.map((item, index) => ({ item, index }))
  .sort((a, b) => (time(b.item) - time(a.item)) || (a.index - b.index)).map(entry => entry.item);

/** Raw adapter rows to at most ITEM_LIMITS.perTopic valid items of one topic.
 * @param {Array<{title:any, link:any, published:any, sourceName:any, sourceUrl:any}>} raw
 * @param {{ linkHosts: readonly string[] }} supplier */
export async function normalizeItems(raw, supplier, now = Date.now()) {
  if (!Array.isArray(raw) || raw.length > ITEM_LIMITS.raw) throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
  const items = [], seen = new Set();
  for (const row of raw) {
    if (!object(row)) continue;
    const link = safeLink(row.link, supplier.linkHosts);
    if (!link || seen.has(link)) continue;
    const sourceName = cleanText(row.sourceName, ITEM_LIMITS.sourceName);
    let title = cleanText(row.title, ITEM_LIMITS.title + ITEM_LIMITS.sourceName + 3);
    // "headline - outlet": the tail goes only when it is exactly the <source> name.
    if (title && sourceName && title.endsWith(' - ' + sourceName) && title.length > sourceName.length + 3) title = title.slice(0, -(sourceName.length + 3)).trimEnd();
    title = cleanText(title, ITEM_LIMITS.title);
    if (!title) continue;
    seen.add(link);
    items.push({ id: await linkID(link), title, link, publishedAt: publishedAt(row.published, now), sourceName, sourceUrl: safeSourceURL(row.sourceUrl) });
  }
  return newestFirst(items).slice(0, ITEM_LIMITS.perTopic);
}

/** Items read back from the cache are checked again; a row that is not exactly
 * the stored shape is dropped. Returns null when the value is not a list. */
export function storedItems(value, supplier) {
  if (!Array.isArray(value)) return null;
  const items = [];
  for (const row of value.slice(0, ITEM_LIMITS.perTopic)) {
    if (!object(row) || Object.keys(row).length !== 6) continue;
    const link = safeLink(row.link, supplier.linkHosts);
    if (!link || link !== row.link || typeof row.id !== 'string' || !/^[a-f0-9]{32}$/.test(row.id)) continue;
    const title = cleanText(row.title, ITEM_LIMITS.title);
    if (!title || title !== row.title) continue;
    if (row.publishedAt !== null && !(typeof row.publishedAt === 'string' && ISO.test(row.publishedAt) && Number.isFinite(Date.parse(row.publishedAt)))) continue;
    if (row.sourceName !== null && cleanText(row.sourceName, ITEM_LIMITS.sourceName) !== row.sourceName) continue;
    if (row.sourceUrl !== null && safeSourceURL(row.sourceUrl) !== row.sourceUrl) continue;
    items.push({ id: row.id, title, link, publishedAt: row.publishedAt, sourceName: row.sourceName, sourceUrl: row.sourceUrl });
  }
  return items;
}

/** One list for the whole request: the same link once (first topic in request
 * order keeps it), at most ITEM_LIMITS.total taken in turns so every topic is
 * represented, newest first.
 * @param {Array<{ topic: string, language: string, items: any[] }>} groups */
export function mergeItems(groups) {
  const seen = new Set(), queues = groups.map(group => {
    const own = [];
    for (const item of group.items) {
      if (seen.has(item.link)) continue;
      seen.add(item.link); own.push({ ...item, topic: group.topic, language: group.language });
    }
    return own;
  });
  const picked = [], counts = queues.map(() => 0);
  for (let round = 0; picked.length < ITEM_LIMITS.total && queues.some(queue => queue.length > round); round++) {
    queues.forEach((queue, at) => {
      if (queue.length > round && picked.length < ITEM_LIMITS.total) { picked.push(queue[round]); counts[at]++; }
    });
  }
  return { items: newestFirst(picked), counts };
}

/* Deliberately restricted RSS 2.0 reader, not a general XML/HTML parser.
 * Never executes HTML or follows embedded links/images. No caller-supplied URL. */
export const LIMITS = Object.freeze({ feed: 2 * 1024 * 1024, robots: 128 * 1024,
  items: 100, title: 400, content: 50000, json: 4 * 1024 * 1024, timeout: 10000 });
const BLOG = /^[A-Za-z0-9_-]{1,50}$/;
const LOG = /^[1-9][0-9]{0,29}$/;
const UA = 'HaedoNaverCollector';
const encoder = new TextEncoder();
export function failure(code) { return Object.assign(new Error(code), { code }); }
const need = (condition, code = 'invalid_feed') => { if (!condition) throw failure(code); };
export function feedURL(blogId) {
  need(typeof blogId === 'string' && BLOG.test(blogId), 'invalid_blog');
  return 'https://rss.blog.naver.com/' + blogId + '.xml';
}
function clean(value) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, '')
    .replace(/\s+/gu, ' ').trim();
}
function entities(value, html = false) {
  const known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ...(html ? { nbsp: ' ', ensp: ' ', emsp: ' ', ndash: '–', mdash: '—', hellip: '…' } : {}) };
  return value.replace(/&([^;\s<&]+);|&/gu, (match, name) => {
    if (name && Object.hasOwn(known, name)) return known[name];
    if (name && /^#(?:[0-9]+|x[0-9a-f]+)$/i.test(name)) {
      const n = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      need(n === 9 || n === 10 || n === 13 || n >= 32 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) && n !== 0xfffe && n !== 0xffff);
      return String.fromCodePoint(n);
    }
    need(html); // XML allows only its five predefined entities, never custom declarations.
    return match;
  });
}
export function plainText(html) {
  need(typeof html === 'string');
  // Discard active/hidden containers, including malformed/unclosed containers.
  let output = '', position = 0; const blocked = [];
  const hidden = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'head']);
  const tags = /<!--[\s\S]*?(?:-->|$)|<![^>]*(?:>|$)|<\/?([A-Za-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*(?:>|$)/g;
  for (const match of html.matchAll(tags)) {
    if (!blocked.length) output += html.slice(position, match.index);
    const tag = match[1]?.toLowerCase();
    if (tag) {
      if (/^<\//.test(match[0])) {
        if (blocked.at(-1) === tag) blocked.pop();
      } else if (hidden.has(tag) && !/\/\s*>$/.test(match[0]) && !['embed'].includes(tag)) blocked.push(tag);
      if (!blocked.length) output += ' ';
    }
    position = match.index + match[0].length;
  }
  if (!blocked.length) output += html.slice(position);
  return clean(entities(output, true));
}
function xml(text) {
  need(typeof text === 'string' && encoder.encode(text).length <= LIMITS.feed);
  need(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF\uFFFE\uFFFF]/u.test(text));
  text = text.replace(/^\uFEFF/, '');
  const root = { name: '#root', children: [], text: '' }, stack = [root];
  let pos = 0, nodes = 0;
  while (pos < text.length) {
    if (text[pos] !== '<') {
      const end = text.indexOf('<', pos), next = end < 0 ? text.length : end;
      need(!text.slice(pos, next).includes(']]>'));
      stack.at(-1).text += entities(text.slice(pos, next)); pos = next; continue;
    }
    if (text.startsWith('<!--', pos)) {
      const end = text.indexOf('-->', pos + 4); need(end >= 0 && !text.slice(pos + 4, end).includes('--')); pos = end + 3; continue;
    }
    if (text.startsWith('<![CDATA[', pos)) {
      need(stack.length > 1); const end = text.indexOf(']]>', pos + 9); need(end >= 0);
      stack.at(-1).text += text.slice(pos + 9, end); pos = end + 3; continue;
    }
    if (text.startsWith('<?xml', pos)) {
      need(pos === 0 && text.startsWith('<?xml ', pos)); const end = text.indexOf('?>', pos); need(end >= 0);
      const declaration = text.slice(pos, end + 2);
      need(/^<\?xml\s+version\s*=\s*(['"])1\.0\1(?:\s+encoding\s*=\s*(['"])utf-8\2)?(?:\s+standalone\s*=\s*(['"])(?:yes|no)\3)?\s*\?>$/i.test(declaration));
      pos = end + 2; continue;
    }
    // No DTD, entity, processing instruction or other declaration is supported.
    need(!text.startsWith('<!', pos) && !text.startsWith('<?', pos));
    // Scan a bounded tag before matching attributes: no unbounded regex
    // backtracking on a hostile, unterminated run of whitespace/quotes.
    let end = pos + 1, quote = null;
    for (; end < text.length && end - pos <= 8192; end++) {
      const ch = text[end];
      if (quote) { if (ch === quote) quote = null; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
      else need(ch !== '<');
    }
    need(end < text.length && end - pos <= 8192 && !quote && text[end] === '>');
    const found = /^<(\/)?([A-Za-z_][\w:.-]*)(\s[\s\S]*?)?\s*(\/?)>$/.exec(text.slice(pos, end + 1));
    need(found); const [, closing, name, originalAttrs = '', slash] = found;
    const selfClosing = slash || /\/\s*$/.test(originalAttrs);
    const rawAttrs = selfClosing ? originalAttrs.replace(/\/\s*$/, '') : originalAttrs;
    if (closing) { need(!rawAttrs.trim() && !selfClosing && stack.length > 1 && stack.at(-1).name === name); stack.pop(); }
    else {
      let attrs = rawAttrs, count = 0; const keys = new Set(), values = Object.create(null);
      while (attrs.trim()) {
        const attribute = /^\s+([A-Za-z_][\w:.-]*)\s*=\s*(['"])([^<]*?)\2/.exec(attrs);
        need(attribute && !keys.has(attribute[1]) && ++count <= 32); keys.add(attribute[1]);
        values[attribute[1]] = entities(attribute[3]); attrs = attrs.slice(attribute[0].length);
      }
      need(++nodes <= 20000 && stack.length <= 32);
      const child = { name, attributes: values, children: [], text: '' }; stack.at(-1).children.push(child);
      if (!selfClosing) stack.push(child);
    }
    pos += found[0].length;
  }
  need(stack.length === 1 && !root.text.trim() && root.children.length === 1); return root.children[0];
}
function field(node, name, required = false) {
  const found = node.children.filter(child => child.name === name);
  need(found.length <= 1 && (!required || found.length === 1));
  if (!found.length) return null;
  need(found[0].children.length === 0); return found[0].text;
}
export function postIdentity(raw, blogId) {
  need(typeof raw === 'string' && raw.length <= 8192 && !/[\s\\\u0000-\u001f\u007f]/.test(raw));
  const authority = /^https?:\/\/([^/?#]+)/i.exec(raw);
  need(authority && ['blog.naver.com', 'm.blog.naver.com'].includes(authority[1].toLowerCase()));
  const url = new URL(raw); need(!url.username && !url.password && !url.port && !url.hash);
  const rawPath = raw.slice(authority[0].length).split(/[?#]/)[0];
  need(!rawPath.includes('%') && !rawPath.split('/').some(v => v === '.' || v === '..'));
  let id, log; const parts = /^\/([A-Za-z0-9_-]+)\/([1-9][0-9]*)\/?$/.exec(url.pathname);
  if (parts) { [ , id, log ] = parts; need(!url.searchParams.has('blogId') && !url.searchParams.has('logNo')); }
  else {
    need(url.pathname === '/PostView.naver'); id = url.searchParams.get('blogId'); log = url.searchParams.get('logNo');
  }
  const keys = new Set();
  for (const pair of url.search.slice(1).split('&').filter(Boolean)) {
    const [key, value = ''] = pair.split('='); const folded = key.toLowerCase();
    need(!keys.has(folded) && !key.includes('%')); keys.add(folded);
    if (['blogid', 'logno'].includes(folded)) need(['blogId', 'logNo'].includes(key) && !/[%+]/.test(value));
  }
  need(id === blogId && BLOG.test(id || '') && LOG.test(log || ''));
  return { logNo: log, url: 'https://blog.naver.com/' + id + '/' + log };
}
export async function parseFeed(text, blogId) {
  feedURL(blogId); const tree = xml(text); need(tree.name === 'rss' && tree.attributes.version === '2.0');
  const channels = tree.children.filter(node => node.name === 'channel'); need(channels.length === 1);
  const entries = channels[0].children.filter(node => node.name === 'item'); need(entries.length > 0 && entries.length <= LIMITS.items);
  const seen = new Set(), items = [];
  for (const entry of entries) {
    const identity = postIdentity(field(entry, 'link', true).trim(), blogId); need(!seen.has(identity.logNo)); seen.add(identity.logNo);
    const title = plainText(field(entry, 'title', true)); need(title && title.length <= LIMITS.title);
    const content = plainText(field(entry, 'description') || ''); need(content.length <= LIMITS.content);
    const date = field(entry, 'pubDate'); let published = null;
    if (date?.trim()) { need(date.length <= 128 && Number.isFinite(Date.parse(date))); published = new Date(date).toISOString(); }
    const hash = content ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(content)))].map(n => n.toString(16).padStart(2, '0')).join('') : null;
    items.push({ log_no: identity.logNo, title, url: identity.url, content_text: content || null,
      content_hash: hash, published_at: published, coverage: content ? 'partial' : 'link_only' });
  }
  need(encoder.encode(JSON.stringify(items)).length <= LIMITS.json, 'feed_too_large'); return items;
}
function robotsPath(value) {
  // RFC 9309 §2.2.2: compare UTF-8 percent-encoded paths, decoding only
  // unreserved ASCII. Encoded reserved bytes stay distinct from separators
  // and from the literal '*'/'$' robots operators. Never rewrite a fetch URL.
  need(typeof value === 'string' && !/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(value), 'blocked');
  try {
    // Reject malformed escapes/UTF-8 rather than treating them as no match.
    need(!/[\u0000-\u001f\u007f]/u.test(decodeURIComponent(value)), 'blocked');
  } catch (_) { throw failure('blocked'); }
  return value.replace(/%([0-9a-f]{2})|[^\x00-\x7f]/giu, (match, hex) => {
    if (!hex) return encodeURIComponent(match);
    const char = String.fromCharCode(parseInt(hex, 16));
    return /^[A-Za-z0-9._~-]$/.test(char) ? char : '%' + hex.toUpperCase();
  });
}
export function robotsAllowed(text, path) {
  need(typeof text === 'string' && encoder.encode(text).length <= LIMITS.robots, 'blocked');
  need(!/<\s*!?\/?(?:html|doctype)\b/i.test(text), 'blocked');
  path = robotsPath(path);
  const groups = []; let group = null, rulesStarted = false;
  for (const line of text.split(/\r?\n/)) {
    const cleanLine = line.replace(/#.*/, '').trim(); if (!cleanLine) continue;
    const colon = cleanLine.indexOf(':'); if (colon < 0) continue;
    const key = cleanLine.slice(0, colon).trim().toLowerCase(), value = cleanLine.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!group || rulesStarted) { group = { agents: [], rules: [], delay: null }; groups.push(group); rulesStarted = false; }
      if (value) group.agents.push(value.toLowerCase());
    } else if (group && ['allow', 'disallow'].includes(key)) {
      rulesStarted = true;
      need(value.length <= 2048 && (value.match(/\*/g) || []).length <= 16, 'blocked');
      if (value) group.rules.push({ allow: key === 'allow', path: robotsPath(value) });
    } else if (group && key === 'crawl-delay') {
      rulesStarted = true; group.delay = value;
    }
  }
  const explicit = groups.filter(g => g.agents.some(a => a !== '*' && UA.toLowerCase().includes(a)));
  const selected = explicit.length ? explicit : groups.filter(g => g.agents.includes('*'));
  // This first collector has no per-origin pacing scheduler. Do not silently
  // ignore a server's nonzero/unknown delay directive; keep ingestion blocked.
  need(selected.every(g => g.delay === null || /^0(?:\.0+)?$/.test(g.delay)), 'blocked');
  let winner = null;
  for (const group of selected) for (const rule of group.rules) {
    const end = rule.path.endsWith('$'), value = end ? rule.path.slice(0, -1) : rule.path;
    // Small dynamic program instead of a wildcard regex (no exponential
    // backtracking with repeated '*' in an untrusted robots response).
    let reachable = new Set([0]);
    for (const ch of value) {
      const next = new Set();
      for (const index of reachable) {
        if (ch === '*') for (let at = index; at <= path.length; at++) next.add(at);
        else if (path[index] === ch) next.add(index + 1);
      }
      reachable = next; if (!reachable.size) break;
    }
    if (!(end ? reachable.has(path.length) : reachable.size > 0)) continue;
    const size = value.replace(/\*/g, '').length;
    if (!winner || size > winner.size || size === winner.size && rule.allow) winner = { size, allow: rule.allow };
  }
  return !winner || winner.allow;
}
export async function readBounded(response, limit) {
  const encoding = response.headers.get('content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') { await response.body?.cancel(); throw failure('invalid_response'); }
  const length = response.headers.get('content-length');
  if (!(length === null || /^(0|[1-9][0-9]*)$/.test(length) && Number(length) <= limit)) {
    await response.body?.cancel(); throw failure('feed_too_large');
  }
  need(response.body, 'invalid_response'); const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength; need(size <= limit, 'feed_too_large'); chunks.push(next.value);
    }
    need(length === null || size === Number(length), 'incomplete_response');
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (_) { throw failure('invalid_feed'); }
  } finally { try { await reader.cancel(); } catch (_) { /* closed stream */ } reader.releaseLock(); }
}
export async function collect(blogId, { fetcher = fetch, signal } = {}) {
  const target = feedURL(blogId);
  const get = async (url, limit, robots = false) => {
    const timeout = AbortSignal.timeout(LIMITS.timeout);
    const response = await fetcher(url, { redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { 'User-Agent': UA + '/1.0', Accept: robots ? 'text/plain' : 'application/rss+xml, application/xml, text/xml', 'Accept-Encoding': 'identity' } });
    need(!response.redirected && (!response.url || response.url === url), 'blocked');
    if (robots && [404, 410].includes(response.status)) { await response.body?.cancel(); return null; }
    if (!response.ok) { await response.body?.cancel(); throw failure(response.status === 403 || response.status === 401 ? 'blocked' : 'network_error'); }
    try { return await readBounded(response, limit); } catch (error) { throw error; }
  };
  const robots = await get('https://rss.blog.naver.com/robots.txt', LIMITS.robots, true);
  need(robots === null || robotsAllowed(robots, new URL(target).pathname), 'blocked');
  return parseFeed(await get(target, LIMITS.feed), blogId);
}

// Publisher-specific private reading. Never accepts arbitrary fetch URLs or HTML.
// DOM parsing uses the existing pinned cheerio/slim injected by the Edge entry.
import { failure, robotsAllowed } from '../haedo-naver-blog/collector.mjs';
import { readBytes, imageMetadata } from '../haedo-naver-blog/harvest-network.mjs';

export const INTAKE_LIMITS = Object.freeze({ xml: 2 * 1024 * 1024, summary: 50000, body: 200000,
  images: 2, imageBytes: 256 * 1024, imageSide: 4096, imagePixels: 16 * 1024 * 1024, robots: 128 * 1024 });
const UA = 'HaedoDiscoveryReader/1.0';
const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';
const FRONTIERS = /^\/(?:journals\/psychology\/articles|articles)\/(10\.3389\/fpsyg\.\d{4}\.([0-9]{1,12}))(?:\/(?:full|xml))?$/;
const PROVIDERS = Object.freeze({
  'frontiers-psychology': { host: 'www.frontiersin.org', path: FRONTIERS, feed: '/journals/psychology/rss', label: 'Frontiers' },
  'mit-linguistics': { host: 'news.mit.edu', path: /^\/\d{4}\/[a-zA-Z0-9-]{1,240}$/, feed: '/topic/mitlinguistics-rss.xml', label: 'MIT News' },
  'llt-journal': { host: 'www.lltjournal.org', path: /^\/item\/[0-9]{1,12}-[0-9]{1,12}\/$/, feed: '/feedlet/', label: 'Language Learning & Technology' }
});
const need = (value, code = 'invalid_article') => { if (!value) throw failure(code); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clean = value => String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, '').replace(/\s+/gu, ' ').trim();
const utf8 = value => new TextEncoder().encode(value).length;
const decode = bytes => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (_) { throw failure('invalid_article'); } };
const blocked = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'sub-article', 'response', 'noscript', 'svg', 'form', 'input', 'button', 'textarea', 'select']);
const name = node => (node?.name || '').split(':').at(-1);
const children = node => (node?.children || []).filter(child => child.type === 'tag');
const child = (node, tag) => children(node).find(item => name(item) === tag);
const descend = (node, tag) => {
  const found = []; for (const item of children(node)) { if (name(item) === tag) found.push(item); if (!blocked.has(name(item))) found.push(...descend(item, tag)); } return found;
};
function exactKeys(value, required, optional = []) {
  need(plain(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key)));
}
function secureURL(raw) {
  need(typeof raw === 'string' && raw.length <= 2048 && !/[\s\\\u0000-\u001f\u007f]/u.test(raw));
  let url; try { url = new URL(raw); } catch (_) { throw failure('invalid_article'); }
  need(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && url.href === raw);
  return url;
}
export function validateArticleInput(value) {
  exactKeys(value, ['sourceId', 'url']);
  const provider = PROVIDERS[value.sourceId], url = secureURL(value.url);
  need(provider && url.hostname === provider.host && !url.search && provider.path.test(url.pathname));
  return { sourceId: value.sourceId, url: url.href };
}
function frontiersIdentity(raw) {
  const input = validateArticleInput({ sourceId: 'frontiers-psychology', url: raw });
  const match = FRONTIERS.exec(new URL(input.url).pathname);
  return { doi: match[1], number: match[2], xml: 'https://www.frontiersin.org/journals/psychology/articles/' + match[1] + '/xml' };
}
function licenseURL(raw) {
  if (!raw) return null;
  try { return secureURL(raw).href; } catch (_) { return null; }
}
function textOf(node) {
  if (!node || blocked.has(name(node)) || node.attribs && Object.hasOwn(node.attribs, 'hidden')) return '';
  if (node.type === 'text') return node.data;
  if (node.type === 'comment') return '';
  const parts = (node.children || []).map(textOf);
  return ['ref', 'name', 'string-name', 'person-group', 'element-citation', 'mixed-citation'].includes(name(node)) ? parts.map(clean).filter(Boolean).join(' ') : parts.join('');
}
function tableRows(table) {
  const rows = descend(table, 'tr'), cells = new Map(); let width = 0;
  need(rows.length <= 200 && descend(table, 'table').length === 0);
  rows.forEach((row, r) => {
    let column = 0;
    for (const cell of children(row).filter(item => ['th', 'td'].includes(name(item)))) {
      while (cells.has(r + ':' + column)) column++;
      const rs = cell.attribs?.rowspan || '1', cs = cell.attribs?.colspan || '1';
      need(/^[1-9][0-9]{0,2}$/.test(rs) && /^[1-9][0-9]?$/.test(cs));
      const rowspan = Number(rs), colspan = Number(cs);
      need(rowspan <= 200 && colspan <= 40 && r + rowspan <= rows.length && column + colspan <= 40);
      for (let x = 0; x < rowspan; x++) for (let y = 0; y < colspan; y++) {
        const key = (r + x) + ':' + (column + y); need(!cells.has(key)); cells.set(key, x === 0 && y === 0 ? clean(textOf(cell)) : '');
      }
      column += colspan; width = Math.max(width, column);
    }
  });
  return rows.map((_, r) => Array.from({ length: width }, (_, c) => cells.get(r + ':' + c) || '').join(' | '));
}
function paragraphs(node) {
  if (!node || blocked.has(name(node))) return [];
  if (node.type === 'text') return clean(node.data) ? [clean(node.data)] : [];
  if (node.type === 'comment') return [];
  const kind = name(node);
  if (kind === 'fig') { const value = clean(textOf(child(node, 'label')) + ' ' + textOf(child(node, 'caption'))); return value ? [value] : []; }
  if (kind === 'table') return tableRows(node);
  if (['p', 'title', 'label', 'disp-quote', 'list-item', 'ref', 'ack', 'fn'].includes(kind)) { const value = clean(textOf(node)); return value ? [value] : []; }
  return (node.children || []).flatMap(paragraphs);
}
// Cheerio's XML DOM builder is intentionally forgiving. Validate the bounded
// XML grammar first so malformed or entity-bearing documents cannot look valid.
function checkedXML(raw, load, allowJats = false) {
  need(typeof load === 'function' && typeof raw === 'string' && utf8(raw) <= INTAKE_LIMITS.xml);
  need(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF\uFFFE\uFFFF]/u.test(raw));
  let text = raw.replace(/^\uFEFF/, '');
  const dtd = '<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Publishing DTD v1.3 20210610//EN" "JATS-journalpublishing1-3-mathml3.dtd">';
  if (allowJats) text = text.replace(dtd, '');
  const stack = []; let pos = 0, nodes = 0, roots = 0;
  const entities = value => {
    need(!value.replace(/&(?:amp|lt|gt|quot|apos|#\d{1,8}|#x[0-9a-fA-F]{1,6});/g, match => {
      if (match[1] !== '#') return '';
      const code = match[2] === 'x' ? parseInt(match.slice(3, -1), 16) : Number(match.slice(2, -1));
      need(code === 9 || code === 10 || code === 13 || code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) && ![0xfffe, 0xffff].includes(code)); return '';
    }).includes('&'));
  };
  while (pos < text.length) {
    if (text[pos] !== '<') {
      let end = text.indexOf('<', pos); if (end < 0) end = text.length;
      const part = text.slice(pos, end); need(!part.includes(']]>') && (stack.length || !part.trim())); entities(part); pos = end; continue;
    }
    if (text.startsWith('<!--', pos)) { const end = text.indexOf('-->', pos + 4); need(end >= 0 && !text.slice(pos + 4, end).includes('--')); pos = end + 3; continue; }
    if (text.startsWith('<![CDATA[', pos)) { const end = text.indexOf(']]>', pos + 9); need(stack.length && end >= 0); pos = end + 3; continue; }
    if (text.startsWith('<?xml', pos)) {
      const end = text.indexOf('?>', pos); need(pos === 0 && end >= 0 && /^<\?xml\s+version\s*=\s*(['"])1\.0\1(?:\s+encoding\s*=\s*(['"])utf-8\2)?(?:\s+standalone\s*=\s*(['"])(?:yes|no)\3)?\s*\?>$/i.test(text.slice(pos, end + 2))); pos = end + 2; continue;
    }
    need(!text.startsWith('<!', pos) && !text.startsWith('<?', pos));
    let end = pos + 1, quote = null;
    for (; end < text.length && end - pos <= 8192; end++) { const c = text[end]; if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break; else need(c !== '<'); }
    need(end < text.length && end - pos <= 8192 && !quote && text[end] === '>');
    const tag = /^<(\/)?([A-Za-z_][\w:.-]*)(\s[\s\S]*?)?\s*(\/?)>$/.exec(text.slice(pos, end + 1)); need(tag);
    const [, closing, tagName, attr = '', slash] = tag, selfClosing = slash || /\/\s*$/.test(attr);
    let attrs = selfClosing ? attr.replace(/\/\s*$/, '') : attr;
    if (closing) { need(!attrs.trim() && !selfClosing && stack.pop() === tagName); }
    else {
      const keys = new Set();
      while (attrs.trim()) {
        const a = /^\s+([A-Za-z_][\w:.-]*)\s*=\s*(['"])([^<]*?)\2/.exec(attrs);
        need(a && !keys.has(a[1]) && keys.size < 64); keys.add(a[1]); entities(a[3]); attrs = attrs.slice(a[0].length);
      }
      need(++nodes <= 30000 && stack.length < 48); if (!stack.length) roots++; if (!selfClosing) stack.push(tagName);
    }
    pos = end + 1;
  }
  need(stack.length === 0 && roots === 1);
  return load(text, { xmlMode: true, decodeEntities: true });
}
function acquisition(method, sourceUrl, license, now) {
  return { scope: 'private_account', method, sourceUrl, fetchedAt: new Date(now).toISOString(), license };
}
function readLicense(node) {
  const candidates = node ? [node, ...descend(node, 'license_ref'), ...descend(node, 'ext-link')] : [];
  const urls = candidates.flatMap(item => [item.attribs?.['xlink:href'], item.attribs?.href, name(item) === 'license_ref' ? clean(textOf(item)) : '']).map(licenseURL).filter(Boolean);
  const url = urls.includes(CC_BY) ? CC_BY : urls[0] || null;
  return { label: url === CC_BY ? 'CC BY 4.0' : clean(textOf(node)).slice(0, 250) || '원문 이용 조건', url };
}
export function parseFrontiersXML(raw, url, { load, now = Date.now() } = {}) {
  const identity = frontiersIdentity(url), $ = checkedXML(raw, load, true);
  const root = $.root().children().get(0); need(name(root) === 'article');
  const meta = child(child(root, 'front'), 'article-meta'); need(meta);
  const dois = children(meta).filter(item => name(item) === 'article-id' && item.attribs?.['pub-id-type'] === 'doi');
  need(dois.length === 1 && clean(textOf(dois[0])) === identity.doi);
  const authors = children(meta).filter(item => name(item) === 'contrib-group').flatMap(group => children(group).filter(item => name(item) === 'contrib' && item.attribs?.['contrib-type'] === 'author')).map(item => {
    const person = child(item, 'name'); return clean(person ? textOf(child(person, 'given-names')) + ' ' + textOf(child(person, 'surname')) : textOf(child(item, 'collab')));
  }).filter(Boolean);
  const author = [...new Set(authors)].join(', '), attribution = author.length > 300 ? authors[0].slice(0, 260) + ' et al.' : author;
  need(attribution);
  const license = readLicense(child(child(meta, 'permissions'), 'license'));
  let summary = paragraphs(child(meta, 'abstract')).join('\n\n'), body = '';
  const bodyNode = child(root, 'body');
  try {
    const main = paragraphs(bodyNode);
    if (main.length) body = [...(summary ? [summary] : []), ...main, ...paragraphs(child(root, 'back'))].join('\n\n');
  } catch (_) { body = ''; }
  if (summary.length > INTAKE_LIMITS.summary) summary = '';
  if (body.length > INTAKE_LIMITS.body || ['math', 'inline-formula', 'disp-formula'].some(tag => descend(bodyNode, tag).length)) body = '';
  need(body || summary, 'unavailable');
  const content = { coverage: body ? 'full_text' : 'summary', summary, ...(body ? { bodyText: body } : {}),
    rights: { mode: 'private_reading', label: attribution + ' · Frontiers', url: license.url || url },
    acquisition: acquisition('publisher_xml', identity.xml, license, now) };
  const candidates = [], bodyParagraphs = body.split('\n\n');
  for (const fig of body ? descend(bodyNode, 'fig') : []) {
    const caption = clean(textOf(child(fig, 'caption'))), label = clean(textOf(child(fig, 'label')));
    const filename = child(fig, 'graphic')?.attribs?.['xlink:href'] || '', match = new RegExp('^(fpsyg-[0-9]+-' + identity.number + '-g[0-9]+)\\.(?:tif|tiff|jpg|png|webp)$').exec(filename);
    if (!match || !caption) continue;
    const figLicenseNode = child(child(fig, 'permissions'), 'license'), figLicense = figLicenseNode ? readLicense(figLicenseNode) : license;
    const extraCredit = ['attrib', 'credit', 'copyright-statement'].flatMap(tag => descend(fig, tag).map(textOf)).map(clean).filter(Boolean).join(' · ');
    const candidate = { sourceUrl: 'https://www.frontiersin.org/files/Articles/' + identity.number + '/xml-images/' + match[1] + '.webp',
      alt: clean(label + ' ' + caption).slice(0, 1000), caption: caption.slice(0, 2000), credit: clean(attribution + ' · Frontiers' + (extraCredit ? ' · ' + extraCredit : '')).slice(0, 500), license: figLicense };
    const original = clean(label + ' ' + caption), index = bodyParagraphs.indexOf(original);
    if (index >= 0 && bodyParagraphs.lastIndexOf(original) === index) candidate.afterParagraph = index;
    candidates.push(candidate); if (candidates.length === INTAKE_LIMITS.images) break;
  }
  return { content, candidates };
}
function htmlText(value, load, maximum = INTAKE_LIMITS.summary) {
  need(typeof value === 'string' && value.length <= maximum * 4);
  const $ = load(value, { xmlMode: false, decodeEntities: true });
  $('script,style,iframe,object,embed,template,noscript,svg,math,form,input,button,textarea,select,[hidden]').remove();
  $('p,div,br,li,h1,h2,h3,h4,blockquote').each((_, element) => { $(element).prepend('\n\n'); $(element).append('\n\n'); });
  const text = $.root().text().split(/\n\s*\n/).map(clean).filter(Boolean).join('\n\n');
  need(text && text.length <= maximum, 'unavailable'); return text;
}
export function parseMITHTML(raw, input, { load, now = Date.now() } = {}) {
  input = validateArticleInput(input); need(input.sourceId === 'mit-linguistics' && typeof raw === 'string' && utf8(raw) <= INTAKE_LIMITS.xml && typeof load === 'function');
  const $ = load(raw, { xmlMode: false, decodeEntities: true });
  const identity = $('link[rel="canonical"],meta[property="og:url"]').map((_, node) => $(node).attr('href') || $(node).attr('content')).get();
  need(identity.length && identity.every(url => url === input.url));
  const root = $('.news-article--content--body--inner'); need(root.length === 1, 'unavailable');
  // Source-specific reading root; navigation, recommendations, captions from
  // other stories and scripts elsewhere in the document never enter the body.
  root.find('script,style,iframe,object,embed,template,noscript,form,button,nav,[hidden]').remove();
  need(!root.find('math,table').length, 'unavailable');
  const bodyText = htmlText(root.html(), load, INTAKE_LIMITS.body);
  const description = $('meta[property="og:description"]').first().attr('content') || '';
  const summary = clean(description).slice(0, INTAKE_LIMITS.summary), license = { label: 'MIT News 이용 조건', url: 'https://news.mit.edu/terms-of-use' };
  return { coverage: 'full_text', summary, bodyText, rights: { mode: 'private_reading', label: 'MIT News', url: license.url },
    acquisition: acquisition('publisher_html', input.url, license, now) };
}
export function parsePublisherRSS(raw, input, { load, now = Date.now() } = {}) {
  input = validateArticleInput(input); const provider = PROVIDERS[input.sourceId], $ = checkedXML(raw, load);
  const root = $.root().children().get(0); need(name(root) === 'rss' && child(root, 'channel'));
  const matches = children(child(root, 'channel')).filter(item => name(item) === 'item').filter(item => {
    const links = children(item).filter(node => name(node) === 'link'); if (links.length !== 1) return false;
    try { const candidate = validateArticleInput({ sourceId: input.sourceId, url: clean(textOf(links[0])) }); return input.sourceId === 'frontiers-psychology' ? frontiersIdentity(candidate.url).doi === frontiersIdentity(input.url).doi : candidate.url === input.url; } catch (_) { return false; }
  });
  need(matches.length === 1, 'unavailable');
  const description = child(matches[0], 'description'); need(description, 'unavailable');
  const markup = children(description).length ? $(description).html() : textOf(description);
  const summary = htmlText(markup, load), license = { label: '원문 이용 조건', url: null };
  return { coverage: 'summary', summary, rights: { mode: 'private_reading', label: provider.label + ' · 공식 RSS', url: input.url },
    acquisition: acquisition('publisher_rss', 'https://' + provider.host + provider.feed, license, now) };
}
function safeResource(raw, input, kind) {
  const url = secureURL(raw), provider = PROVIDERS[input.sourceId]; need(url.hostname === provider.host && !url.search, 'blocked');
  if (kind === 'robots') need(url.pathname === '/robots.txt' || input.sourceId === 'llt-journal' && url.pathname === '/robots.txt/', 'blocked');
  else if (kind === 'rss') need(url.pathname === provider.feed, 'blocked');
  else if (kind === 'xml') need(input.sourceId === 'frontiers-psychology' && raw === frontiersIdentity(input.url).xml, 'blocked');
  else if (kind === 'html') need(input.sourceId === 'mit-linguistics' && raw === input.url, 'blocked');
  else if (kind === 'image') { const n = frontiersIdentity(input.url).number; need(new RegExp('^/files/Articles/' + n + '/xml-images/fpsyg-[0-9]+-' + n + '-g[0-9]+\\.webp$').test(url.pathname), 'blocked'); }
  else throw failure('blocked');
  return url;
}
function createNetwork(input, { fetcher = fetch, signal, deadline = Date.now() + 25000 } = {}) {
  const robots = new Map(); let requests = 0;
  const timeout = () => { const left = deadline - Date.now(); need(left > 0 && !signal?.aborted, 'network_error'); return signal ? AbortSignal.any([signal, AbortSignal.timeout(Math.min(left, 8000))]) : AbortSignal.timeout(Math.min(left, 8000)); };
  async function request(raw, kind, limit) {
    const url = safeResource(raw, input, kind); need(++requests <= 6, 'network_error');
    // LLT's reviewed Django route redirects the standard robots path to its
    // trailing-slash form (which currently returns 404). Only that exact
    // same-origin single hop is accepted; no location becomes a fetch target.
    const lltRobots = input.sourceId === 'llt-journal' && kind === 'robots' && url.pathname === '/robots.txt';
    let response;
    try { response = await fetcher(url.href, { method: 'GET', redirect: lltRobots ? 'manual' : 'error', signal: timeout(), credentials: 'omit', headers: {
      'User-Agent': UA, 'Accept-Encoding': 'identity', Accept: kind === 'image' ? 'image/png,image/jpeg,image/webp' : kind === 'robots' ? 'text/plain' : kind === 'html' ? 'text/html' : 'application/xml,application/rss+xml,text/xml' } }); }
    catch (_) { throw failure('network_error'); }
    if (response.redirected || response.url && response.url !== url.href) { await response.body?.cancel(); throw failure('blocked'); }
    if (lltRobots && [301, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      need(location === '/robots.txt/' || location === 'https://www.lltjournal.org/robots.txt/', 'blocked');
      return request('https://www.lltjournal.org/robots.txt/', 'robots', limit);
    }
    if (kind === 'robots' && [404, 410].includes(response.status)) { await response.body?.cancel(); return null; }
    if (!response.ok) { await response.body?.cancel(); throw failure([401, 403].includes(response.status) ? 'blocked' : [404, 410].includes(response.status) ? 'unavailable' : 'network_error'); }
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (kind !== 'image' && kind !== 'robots' && !(kind === 'html' ? type === 'text/html' : ['application/xml', 'application/rss+xml', 'text/xml'].includes(type))) { await response.body?.cancel(); throw failure('invalid_article'); }
    try { return { bytes: await readBytes(response, limit), type }; } catch (error) { throw failure(error?.code === 'response_too_large' ? 'invalid_article' : 'network_error'); }
  }
  return { async resource(raw, kind, limit) {
    const url = safeResource(raw, input, kind), robotsURL = url.origin + '/robots.txt';
    if (!robots.has(robotsURL)) { const response = await request(robotsURL, 'robots', INTAKE_LIMITS.robots); robots.set(robotsURL, response ? decode(response.bytes) : null); }
    need(robots.get(robotsURL) === null || robotsAllowed(robots.get(robotsURL), url.pathname, UA), 'blocked');
    return request(raw, kind, limit);
  } };
}
function base64(bytes) { let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(binary); }
export function imagePayload(bytes, type, candidate) {
  need(bytes.length <= INTAKE_LIMITS.imageBytes);
  const meta = imageMetadata(bytes, type); need(meta.width <= INTAKE_LIMITS.imageSide && meta.height <= INTAKE_LIMITS.imageSide && meta.width * meta.height <= INTAKE_LIMITS.imagePixels);
  return { ...candidate, mimeType: meta.mimeType, dataBase64: base64(bytes) };
}
export async function collectArticle(input, options = {}) {
  input = validateArticleInput(input); const provider = PROVIDERS[input.sourceId], network = createNetwork(input, options);
  if (input.sourceId === 'mit-linguistics') {
    try { const response = await network.resource(input.url, 'html', INTAKE_LIMITS.xml); return validateArticleContent(parseMITHTML(decode(response.bytes), input, options), input); }
    catch (error) { if (error.code === 'blocked' || options.signal?.aborted) throw error; }
  }
  if (input.sourceId === 'frontiers-psychology') {
    let parsed;
    try { const response = await network.resource(frontiersIdentity(input.url).xml, 'xml', INTAKE_LIMITS.xml); parsed = parseFrontiersXML(decode(response.bytes), input.url, options); }
    catch (error) { if (error.code === 'blocked' || options.signal?.aborted) throw error; }
    if (parsed) {
      const images = [];
      for (const candidate of parsed.candidates) {
        try { const response = await network.resource(candidate.sourceUrl, 'image', INTAKE_LIMITS.imageBytes); images.push(imagePayload(response.bytes, response.type, candidate)); }
        catch (_) { if (options.signal?.aborted) throw failure('network_error'); /* Keep verified text and its figure caption. */ }
      }
      return validateArticleContent({ ...parsed.content, ...(images.length ? { images } : {}) }, input);
    }
  }
  const response = await network.resource('https://' + provider.host + provider.feed, 'rss', INTAKE_LIMITS.xml);
  return validateArticleContent(parsePublisherRSS(decode(response.bytes), input, options), input);
}
function checkedArticleContent(value, input) {
  exactKeys(value, ['coverage', 'summary', 'rights', 'acquisition'], ['bodyText', 'images']);
  const text = (v, max, empty = false) => typeof v === 'string' && v.length <= max && (empty || v.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(v);
  need(['summary', 'full_text'].includes(value.coverage) && text(value.summary, INTAKE_LIMITS.summary, value.coverage === 'full_text'));
  need(value.coverage === 'full_text' ? text(value.bodyText, INTAKE_LIMITS.body) : !Object.hasOwn(value, 'bodyText'));
  exactKeys(value.rights, ['mode', 'label', 'url']); need(value.rights.mode === 'private_reading' && text(value.rights.label, 500) && licenseURL(value.rights.url));
  const a = value.acquisition; exactKeys(a, ['scope', 'method', 'sourceUrl', 'fetchedAt', 'license']);
  need(a.scope === 'private_account' && ['publisher_xml', 'publisher_rss', 'publisher_html'].includes(a.method) && typeof a.fetchedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(a.fetchedAt) && Number.isFinite(Date.parse(a.fetchedAt)) && new Date(a.fetchedAt).toISOString() === a.fetchedAt);
  const checkLicense = license => { exactKeys(license, ['label', 'url']); need(text(license.label, 250) && (license.url === null || licenseURL(license.url))); };
  checkLicense(a.license);
  const origin = secureURL(a.sourceUrl);
  const providerId = Object.keys(PROVIDERS).find(id => PROVIDERS[id].host === origin.hostname); need(providerId);
  if (input) { input = validateArticleInput(input); need(input.sourceId === providerId); safeResource(a.sourceUrl, input, { publisher_xml: 'xml', publisher_rss: 'rss', publisher_html: 'html' }[a.method]); }
  else if (a.method === 'publisher_xml') frontiersIdentity(a.sourceUrl);
  else if (a.method === 'publisher_html') { need(providerId === 'mit-linguistics'); validateArticleInput({ sourceId: providerId, url: a.sourceUrl }); }
  else need(origin.pathname === PROVIDERS[providerId].feed && !origin.search);
  if (value.images !== undefined) {
    need(value.coverage === 'full_text' && a.method === 'publisher_xml' && Array.isArray(value.images) && value.images.length <= INTAKE_LIMITS.images);
    const seen = new Set();
    for (const picture of value.images) {
      exactKeys(picture, ['sourceUrl', 'alt', 'caption', 'credit', 'license', 'mimeType', 'dataBase64'], ['afterParagraph']);
      need(text(picture.alt, 1000) && text(picture.caption, 2000) && text(picture.credit, 500)); checkLicense(picture.license);
      safeResource(picture.sourceUrl, { sourceId: 'frontiers-psychology', url: a.sourceUrl }, 'image'); need(!seen.has(picture.sourceUrl)); seen.add(picture.sourceUrl);
      need(typeof picture.dataBase64 === 'string' && picture.dataBase64.length <= 4 * Math.ceil(INTAKE_LIMITS.imageBytes / 3) && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(picture.dataBase64));
      const bytes = Uint8Array.from(atob(picture.dataBase64), c => c.charCodeAt(0)); need(base64(bytes) === picture.dataBase64); imagePayload(bytes, picture.mimeType, picture);
      if (picture.afterParagraph !== undefined) need(Number.isInteger(picture.afterParagraph) && picture.afterParagraph >= 0 && picture.afterParagraph < value.bodyText.split(/\n[ \t]*\n/).length);
    }
  }
  return structuredClone(value);
}
export function validateArticleContent(value, input) {
  try { return checkedArticleContent(value, input); } catch (_) { throw failure('invalid_article'); }
}

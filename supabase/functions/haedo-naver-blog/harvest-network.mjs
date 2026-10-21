import { failure, robotsAllowed } from './collector.mjs';
import { imageURL } from './extractor.mjs';
const need = (ok, code) => { if (!ok) throw failure(code); };
export const MEDIA_MAX_BYTES = 16 * 1024 * 1024;
export function safeResource(raw, kind) {
  if (kind === 'image') return imageURL(raw);
  need(typeof raw === 'string' && !/[\s\\\u0000-\u001f\u007f]/.test(raw), 'blocked');
  const url = new URL(raw);
  need(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
    ['blog.naver.com', 'm.blog.naver.com', 'rss.blog.naver.com'].includes(url.hostname), 'blocked');
  const keys = [...url.searchParams.keys()]; need(new Set(keys).size === keys.length, 'blocked');
  if (kind === 'robots') need(url.pathname === '/robots.txt' && !url.search, 'blocked');
  else {
    need(url.hostname === 'blog.naver.com' && ['/PostView.naver', '/SummaryContentFetch.naver', '/PostTitleListAsync.naver'].includes(url.pathname), 'blocked');
    const allowed = url.pathname === '/PostTitleListAsync.naver' ? ['blogId', 'currentPage', 'categoryNo', 'countPerPage'] : ['blogId', 'logNo'];
    need(keys.length === allowed.length && keys.every(k => allowed.includes(k)) && /^[A-Za-z0-9_-]{1,50}$/.test(url.searchParams.get('blogId') || ''), 'blocked');
    if (allowed.includes('logNo')) need(/^[1-9][0-9]{0,29}$/.test(url.searchParams.get('logNo') || ''), 'blocked');
    else need(/^[1-9][0-9]{0,5}$/.test(url.searchParams.get('currentPage') || '') && url.searchParams.get('categoryNo') === '0' && url.searchParams.get('countPerPage') === '30', 'blocked');
  }
  return url.href;
}
export async function readBytes(response, limit) {
  const encoding = response.headers.get('content-encoding'), length = response.headers.get('content-length');
  if (encoding && encoding.toLowerCase() !== 'identity') { await response.body?.cancel(); throw failure('invalid_encoding'); }
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > limit)) { await response.body?.cancel(); throw failure('response_too_large'); }
  need(response.body, 'incomplete_response'); const reader = response.body.getReader(); let count = 0; const chunks = [];
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; count += part.value.byteLength; need(count <= limit, 'response_too_large'); chunks.push(part.value); }
    need(length === null || Number(length) === count, 'incomplete_response');
    const bytes = new Uint8Array(count); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
  } finally { try { await reader.cancel(); } catch (_) { /* already consumed */ } reader.releaseLock(); }
}
export function imageMetadata(bytes, contentType) {
  need(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= MEDIA_MAX_BYTES, 'invalid_image');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), type = (contentType || '').split(';')[0].trim().toLowerCase(); let width, height;
  if (type === 'image/png') {
    need(bytes.length >= 45 && [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b) && view.getUint32(8) === 13 && String.fromCharCode(...bytes.slice(12, 16)) === 'IHDR', 'invalid_image');
    width = view.getUint32(16); height = view.getUint32(20);
    need(String.fromCharCode(...bytes.slice(-8, -4)) === 'IEND', 'invalid_image');
  } else if (type === 'image/jpeg') {
    need(bytes.length > 10 && view.getUint16(0) === 0xffd8 && view.getUint16(bytes.length - 2) === 0xffd9, 'invalid_image');
    let at = 2;
    while (at + 4 <= bytes.length) {
      need(bytes[at++] === 255, 'invalid_image'); while (bytes[at] === 255) at++;
      const marker = bytes[at++]; if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      need(at + 2 <= bytes.length, 'invalid_image'); const length = view.getUint16(at); need(length >= 2 && at + length <= bytes.length, 'invalid_image');
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) { need(length >= 8, 'invalid_image'); height = view.getUint16(at + 3); width = view.getUint16(at + 5); break; }
      at += length;
    }
  } else if (type === 'image/webp') {
    need(bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP' && view.getUint32(4, true) + 8 === bytes.length, 'invalid_image');
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === 'VP8X') { width = 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65536; height = 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65536; }
    else if (chunk === 'VP8 ') { need(bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a, 'invalid_image'); width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff; }
    else if (chunk === 'VP8L') { need(bytes[20] === 0x2f, 'invalid_image'); const bits = view.getUint32(21, true); width = 1 + (bits & 0x3fff); height = 1 + (bits >>> 14 & 0x3fff); }
  }
  // Header dimensions are reported as metadata, not as proof of source-original
  // pixels or a full image decoder verdict. Payload keeps originalStatus unknown.
  need(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width <= 100000 && height <= 100000 && width * height <= 200000000, 'invalid_image');
  return { mimeType: type, width, height, bytes: bytes.length };
}
export function createNetwork({ fetcher = fetch, signal, deadline = Date.now() + 75000 } = {}) {
  const robots = new Map();
  const timeout = () => { const left = deadline - Date.now(); need(left > 500, 'deadline'); return signal ? AbortSignal.any([signal, AbortSignal.timeout(Math.min(left, 10000))]) : AbortSignal.timeout(Math.min(left, 10000)); };
  async function request(raw, kind, limit) {
    const url = safeResource(raw, kind);
    const response = await fetcher(url, { method: 'GET', redirect: 'error', signal: timeout(), headers: {
      'User-Agent': 'HaedoNaverCollector/1.0', Accept: kind === 'image' ? 'image/png,image/jpeg,image/webp' : kind === 'robots' ? 'text/plain' : 'text/html,application/json', 'Accept-Encoding': 'identity' } });
    if (response.redirected || response.url && response.url !== url) { await response.body?.cancel(); throw failure('blocked'); }
    if (kind === 'robots' && [404,410].includes(response.status)) { await response.body?.cancel(); return null; }
    if (!response.ok) { await response.body?.cancel(); throw failure(response.status === 404 || response.status === 410 ? 'unavailable' : response.status === 403 || response.status === 401 ? 'blocked' : 'network_error'); }
    return { bytes: await readBytes(response, limit), type: response.headers.get('content-type') || '' };
  }
  async function resource(raw, kind, limit) {
    const url = safeResource(raw, kind), parsed = new URL(url);
    if (kind !== 'image') {
      const robotURL = parsed.origin + '/robots.txt';
      const robot = await request(robotURL, 'robots', 128 * 1024);
      const content = robot === null ? null : new TextDecoder('utf-8', { fatal: true }).decode(robot.bytes);
      need(content === null || robotsAllowed(content, parsed.pathname + parsed.search), 'blocked'); robots.set(robotURL, content);
    }
    // CDN robots are not inferred from blog robots. No images are requested if
    // their origin policy was not checked during this same execution.
    else {
      const robotURL = parsed.origin + '/robots.txt';
      if (!robots.has(robotURL)) {
        // Exact CDN host is already reviewed by imageURL; reuse the same fixed
        // origin and block redirects, but robots itself has no image extension.
        const result = await fetcher(robotURL, { redirect: 'error', signal: timeout(), headers: { 'User-Agent': 'HaedoNaverCollector/1.0', 'Accept-Encoding': 'identity' } });
        need(!result.redirected && (!result.url || result.url === robotURL), 'blocked');
        if ([404,410].includes(result.status)) { await result.body?.cancel(); robots.set(robotURL, null); }
        else {
          need(result.ok && !result.redirected && (!result.url || result.url === robotURL), 'blocked');
          const text = new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(result, 128 * 1024)); robots.set(robotURL, text);
        }
      }
      need(robots.get(robotURL) === null || robotsAllowed(robots.get(robotURL), parsed.pathname + parsed.search), 'blocked');
    }
    return request(url, kind, limit);
  }
  return { resource, timeout, remaining: () => deadline - Date.now() };
}

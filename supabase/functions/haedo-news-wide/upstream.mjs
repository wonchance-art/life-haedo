/* The only code in haedo-news-wide that talks to an outside news service.
 *
 * What leaves the server for one topic is exactly:
 *   GET https://<supplier.host><supplier.path>?<the supplier's query>
 *   Accept, Accept-Encoding: identity, User-Agent (a generic reader name)
 * and nothing else: no account or session value, no cookie, no Referer, no
 * project name. This module is never given the user, the token or the keys.
 *
 * The address is checked here, after the adapter built it, so an adapter
 * cannot send a request to another host, path, port or scheme. Redirects are
 * not followed (also not to the same host): a redirect fails that topic. */
import { createXMLReader } from './xml.mjs';
import { normalizeItems } from './items.mjs';

export const UPSTREAM = Object.freeze({
  bytes: 1024 * 1024,   // decoded response body; one 100-item answer measured about 111 KB on 2026-11-11
  timeout: 8000,        // per call
  concurrency: 4,       // calls in flight per request
  userAgent: 'Mozilla/5.0 (compatible; FeedReader/1.0)',
});
export const failure = code => Object.assign(new Error(code), { code });
const SUPPLIER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** Refuses an adapter that does not have the shape documented in suppliers/google-news.mjs. */
export function checkSupplier(supplier) {
  const ok = supplier !== null && typeof supplier === 'object' &&
    typeof supplier.id === 'string' && SUPPLIER_ID.test(supplier.id) &&
    typeof supplier.label === 'string' && supplier.label.length > 0 &&
    typeof supplier.host === 'string' && HOST.test(supplier.host) && !/^\d+(?:\.\d+)*$/.test(supplier.host) &&
    typeof supplier.path === 'string' && /^\/[A-Za-z0-9._~/-]*$/.test(supplier.path) &&
    Array.isArray(supplier.linkHosts) && supplier.linkHosts.length > 0 && supplier.linkHosts.every(host => typeof host === 'string' && HOST.test(host)) &&
    Array.isArray(supplier.accept) && supplier.accept.length > 0 && supplier.accept.every(type => typeof type === 'string' && /^[a-z]+\/[a-z0-9.+-]+$/.test(type)) &&
    Array.isArray(supplier.arrays) && Array.isArray(supplier.languages) && supplier.languages.length > 0 &&
    typeof supplier.url === 'function' && typeof supplier.extract === 'function';
  if (!ok) throw failure('setup_required');
  return supplier;
}

/** The adapter's address for one topic, accepted only as https://<host><path>?<query>. */
export function upstreamURL(supplier, topic, language) {
  const address = supplier.url(topic, language), prefix = 'https://' + supplier.host + supplier.path + '?';
  if (typeof address !== 'string' || address.length > 2048 || !address.startsWith(prefix) || /[\s\\#\u0000-\u001f\u007f-\uffff]/u.test(address)) throw failure('blocked');
  let url; try { url = new URL(address); } catch (_) { throw failure('blocked'); }
  if (url.protocol !== 'https:' || url.hostname !== supplier.host || url.port || url.username || url.password || url.hash ||
    url.pathname !== supplier.path || url.href !== address) throw failure('blocked');
  return address;
}

async function readBounded(response, limit) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) { await response.body?.cancel(); throw failure('invalid_response'); }
  if (!response.body) throw failure('invalid_response');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; if (size > limit) throw failure('invalid_response');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (_) { throw failure('invalid_response'); }
  } finally { try { await reader.cancel(); } catch (_) { /* already finished */ } reader.releaseLock(); }
}

/** @param {{ supplier: any, XMLParser: any, XMLValidator: any, fetcher?: typeof fetch, now?: () => number }} options
 *  @returns {(topic: string, language: string, options?: { signal?: AbortSignal, timeout?: number }) => Promise<any[]>}
 *  One GET for one topic. Resolves to normalized items; rejects with one of
 *  network_error | rate_limited | blocked | invalid_response (never upstream text). */
export function createUpstream({ supplier, XMLParser, XMLValidator, fetcher = fetch, now = Date.now }) {
  checkSupplier(supplier);
  const read = createXMLReader({ XMLParser, XMLValidator, arrays: supplier.arrays, maxBytes: UPSTREAM.bytes });
  return async (topic, language, { signal, timeout = UPSTREAM.timeout } = {}) => {
    const address = upstreamURL(supplier, topic, language);
    const limit = AbortSignal.timeout(Math.max(1, Math.min(timeout, UPSTREAM.timeout)));
    let response;
    try {
      response = await fetcher(address, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
        signal: signal ? AbortSignal.any([signal, limit]) : limit,
        headers: { Accept: supplier.accept.join(', '), 'Accept-Encoding': 'identity', 'User-Agent': UPSTREAM.userAgent } });
    } catch (_) { throw failure('network_error'); }
    try {
      if (response.redirected || response.url && response.url !== address || response.type === 'opaqueredirect' ||
        response.status >= 300 && response.status < 400) throw failure('blocked');
      if (response.status === 429) throw failure('rate_limited');
      if (response.status === 401 || response.status === 403) throw failure('blocked');
      if (response.status !== 200) throw failure('network_error');
      const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!supplier.accept.includes(type)) throw failure('invalid_response');
    } catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
    let xml;
    try { xml = await readBounded(response, UPSTREAM.bytes); }
    catch (error) { throw failure(error?.code === 'invalid_response' ? 'invalid_response' : 'network_error'); }
    let raw;
    try { raw = supplier.extract(read(xml)); } catch (_) { throw failure('invalid_response'); }
    try { return await normalizeItems(raw, supplier, now()); } catch (_) { throw failure('invalid_response'); }
  };
}

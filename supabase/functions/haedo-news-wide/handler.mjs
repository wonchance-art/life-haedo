/* haedo-news-wide: news for the interest topics the owner typed into the news
 * settings, looked up at an outside news aggregator and returned to that
 * account only (owner approval 2026-11-11; docs/design-review/news-wide-feed.md).
 *
 * Request   POST { topics: string[1..8], languages: ("ko"|"en")[1..2] }  (nothing else)
 * Response  { supplier, items, fetchedAt, stale, topics: [{ topic, language, status, fetchedAt, count, reason? }] }
 *           status: fresh (fetched now) | cached (within the TTL) | stale (old cache, no new answer)
 *                 | failed (no answer, no cache) | limited (call allowance used up; cache only)
 *
 * What leaves the server: the topic and the language edition, to the one
 * supplier host (upstream.mjs). The account ID, e-mail, session token, keys,
 * cookies, Referer and project name are never part of that request; the
 * upstream module is not given them.
 *
 * Who: a signed-in, non-anonymous account that is on the allow list
 * (haedo_news_wide_private.allowed_accounts, filled only by the reviewed
 * operations SQL; empty means nobody). The session is checked with Auth
 * (/auth/v1/user); the cache RPC checks the live session again, is bound to
 * auth.uid() and answers not_allowed for every other account, in which case
 * this handler answers 403 not_enabled_for_account and never calls the
 * supplier. Deploy with verify_jwt=false: the handler refuses any Bearer value
 * that is not JWT-shaped (API keys included) by itself.
 *
 * Cache and allowance live in haedo_news_wide_private (migration
 * 20261111130000_news_wide_feed.sql): 30-minute TTL, 60 upstream calls per
 * hour and 600 per day per account. Fresh cache never calls the supplier.
 *
 * Logs: counts, states and time only. Topic text, item titles, links, the
 * account ID and upstream response text are never logged or put in an error. */
import { validateRequest, LIMITS, failure } from './topics.mjs';
import { createUpstream, UPSTREAM } from './upstream.mjs';
import { storedItems, mergeItems } from './items.mjs';
import { googleNews } from './suppliers/google-news.mjs';
import { supabaseKeys, serverHeaders } from '../_shared/supabase-keys.mjs';

export const ALLOWED_ORIGINS = Object.freeze(['https://wonchance-art.github.io', 'http://127.0.0.1:4173', 'http://localhost:4173']);
/** Whole-request budget, and the part kept back for storing results and answering. */
export const BUDGET = Object.freeze({ deadline: 25000, reserve: 4000, minimumCall: 1000, rpc: 8000, auth: 5000 });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const BASE_HEADERS = Object.freeze({ 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
const STATUS = Object.freeze({ invalid_request: 400, invalid_topic: 400, unauthorized: 401, origin_not_allowed: 403, not_enabled_for_account: 403,
  setup_required: 503, auth_unavailable: 503, server_error: 500 });
// A supplier that refuses (429, 401/403, redirect) is not asked again in the same request.
const SUPPLIER_REFUSALS = Object.freeze(['rate_limited', 'blocked']);
const UPSTREAM_ERRORS = Object.freeze(['network_error', 'rate_limited', 'blocked', 'invalid_response']);
const CLAIM_STATES = Object.freeze(['fresh', 'claimed', 'busy', 'backoff', 'limited']);
const RPC_LIMIT = 5 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (ok, code = 'server_error') => { if (!ok) throw failure(code); };
const count = value => Number.isSafeInteger(value) && value >= 0;

async function readBounded(message, limit) {
  const reader = message.body?.getReader(); need(reader, 'invalid_request');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; need(size <= limit, 'invalid_request'); chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally { try { await reader.cancel(); } catch (_) { /* already finished */ } reader.releaseLock(); }
}

/** What a log line may hold: the time, a known status word and non-negative whole numbers.
 * Every other field and every other kind of value is dropped, whatever the caller passes. */
export function logFields(entry, at) {
  const number = name => count(entry?.[name]) ? entry[name] : null;
  return { at, fn: 'haedo-news-wide', status: entry?.status === 'ok' || typeof entry?.status === 'string' && Object.hasOwn(STATUS, entry.status) ? entry.status : 'server_error',
    topics: number('topics'), languages: number('languages'), upstream: number('upstream'), fresh: number('fresh'), cached: number('cached'),
    stale: number('stale'), failed: number('failed'), limited: number('limited'), items: number('items'), ms: number('ms') };
}

/** @param {{ fetcher?: typeof fetch, environment?: (name: string) => string | undefined, XMLParser?: any, XMLValidator?: any,
 *   supplier?: any, origins?: ReadonlyArray<string>, log?: (entry: object) => void, now?: () => number }} [options]
 * `supplier` and `origins` are construction-time configuration, never request fields. */
export function createHandler({ fetcher = fetch, environment = name => globalThis.Deno?.env.get(name), XMLParser, XMLValidator,
  supplier = googleNews, origins = ALLOWED_ORIGINS, log = entry => console.log(JSON.stringify(entry)), now = Date.now } = {}) {
  const allowedOrigins = new Set(origins);
  let upstream = null;
  try { upstream = createUpstream({ supplier, XMLParser, XMLValidator, fetcher, now }); } catch (_) { /* every request answers setup_required */ }
  // The only log writer: whatever it is given, only logFields() of it is written.
  const record = entry => {
    try { log(logFields(entry, new Date(now()).toISOString())); } catch (_) { /* logging never changes the answer */ }
  };
  return async request => {
    const started = now(), deadline = started + BUDGET.deadline;
    const browserOrigin = request.headers.get('origin'), headers = { ...BASE_HEADERS };
    if (allowedOrigins.has(browserOrigin)) headers['Access-Control-Allow-Origin'] = browserOrigin;
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    const tally = {};
    const refuse = code => { record({ ...tally, status: code, ms: now() - started }); return reply({ error: code }, STATUS[code] || 500); };
    // A browser page from any other origin is refused before any work.
    if (browserOrigin !== null && !allowedOrigins.has(browserOrigin)) return refuse('origin_not_allowed');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply({ error: 'invalid_request' }, 405);
    try {
      let project;
      try { project = new URL(environment('SUPABASE_URL') || ''); } catch (_) { throw failure('setup_required'); }
      need(project.protocol === 'https:' && !project.username && !project.password && project.pathname === '/' && !project.search && !project.hash, 'setup_required');
      const origin = project.origin, { publicKey, server: serviceKey } = supabaseKeys(environment);
      need(publicKey && serviceKey && upstream, 'setup_required');
      // verify_jwt=false: only a JWT-shaped user session goes on, before the body is read.
      const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') || '')?.[1];
      need(token && token.length <= 8192 && JWT.test(token), 'unauthorized');
      let input;
      try { input = validateRequest(JSON.parse(await readBounded(request, LIMITS.body))); }
      catch (error) { throw failure(error?.code === 'invalid_topic' ? 'invalid_topic' : 'invalid_request'); }
      tally.topics = input.topics.length; tally.languages = input.languages.length;

      const within = ms => AbortSignal.any([request.signal, AbortSignal.timeout(Math.max(1, Math.min(ms, deadline - now())))]);
      // Auth validates the session; decoded claims are never trusted.
      let authenticated;
      try {
        authenticated = await fetcher(origin + '/auth/v1/user', { method: 'GET', redirect: 'error', credentials: 'omit',
          signal: within(BUDGET.auth), headers: { apikey: publicKey, Authorization: 'Bearer ' + token } });
      } catch (_) { throw failure('auth_unavailable'); }
      if (!authenticated.ok) {
        // Only Auth saying "no" (401/403) is a sign-in problem. 429, 5xx and anything
        // else is a temporary failure: the client must not sign the person out for it.
        const refused = authenticated.status === 401 || authenticated.status === 403;
        await authenticated.body?.cancel().catch(() => {});
        throw failure(refused ? 'unauthorized' : 'auth_unavailable');
      }
      let user;
      try { user = JSON.parse(await readBounded(authenticated, 16384)); } catch (_) { throw failure('auth_unavailable'); }
      need(object(user) && typeof user.id === 'string' && UUID.test(user.id) && user.role === 'authenticated' && user.is_anonymous === false, 'unauthorized');

      const rpc = async (name, args, { service = false, detached = false } = {}) => {
        let result;
        try {
          result = await fetcher(origin + '/rest/v1/rpc/' + name, { method: 'POST', redirect: 'error', credentials: 'omit',
            signal: detached ? AbortSignal.timeout(BUDGET.rpc) : within(BUDGET.rpc),
            headers: { ...(service ? serverHeaders(serviceKey) : { apikey: publicKey, Authorization: 'Bearer ' + token }), 'Content-Type': 'application/json' },
            body: JSON.stringify(args) });
        } catch (_) { throw failure('server_error'); }
        if (!result.ok) {
          await result.body?.cancel(); // never read: it could repeat request text
          throw Object.assign(failure(result.status === 404 ? 'setup_required' : !service && [401, 403].includes(result.status) ? 'unauthorized' : 'server_error'), { httpStatus: result.status });
        }
        try { return JSON.parse(await readBounded(result, RPC_LIMIT)); } catch (_) { throw failure('server_error'); }
      };

      // One {topic, language} pair is one cache row and at most one upstream call.
      const pairs = input.topics.flatMap(topic => input.languages.map(language => ({ topic, language })));
      const claim = await rpc('life_news_wide_claim', { p_supplier: supplier.id, p_requests: pairs });
      // Not on the allow list: nothing was created or counted, and the supplier is never called.
      if (object(claim) && claim.status === 'not_allowed') throw failure('not_enabled_for_account');
      need(object(claim) && claim.status === 'ok' && Array.isArray(claim.entries) && claim.entries.length === pairs.length);
      const entries = pairs.map((pair, at) => {
        const entry = claim.entries[at];
        need(object(entry) && entry.topic === pair.topic && entry.language === pair.language && CLAIM_STATES.includes(entry.status));
        const cached = entry.items === null || entry.items === undefined ? null : storedItems(entry.items, supplier);
        const cachedAt = cached && typeof entry.fetchedAt === 'string' && Number.isFinite(Date.parse(entry.fetchedAt)) ? new Date(Date.parse(entry.fetchedAt)).toISOString() : null;
        need(!cached || cachedAt);
        if (entry.status === 'fresh') need(cached);
        if (entry.status === 'claimed') need(typeof entry.leaseToken === 'string' && UUID.test(entry.leaseToken));
        return { ...pair, state: entry.status, cached, cachedAt, lease: entry.leaseToken, limit: entry.limit, fresh: null, error: null };
      });

      const jobs = entries.filter(entry => entry.state === 'claimed');
      let next = 0, calls = 0, refusedBySupplier = false;
      const worker = async () => {
        for (;;) {
          const job = jobs[next++]; if (!job) return;
          const remaining = deadline - BUDGET.reserve - now();
          if (refusedBySupplier || remaining < BUDGET.minimumCall || request.signal.aborted) { job.error = 'not_attempted'; continue; }
          calls++;
          try { job.fresh = await upstream(job.topic, job.language, { signal: request.signal, timeout: remaining }); }
          catch (error) {
            job.error = UPSTREAM_ERRORS.includes(error?.code) ? error.code : 'network_error';
            if (SUPPLIER_REFUSALS.includes(job.error)) refusedBySupplier = true; // calls already in flight finish; no new one starts
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(UPSTREAM.concurrency, jobs.length) }, worker));
      tally.upstream = calls;

      if (jobs.length) {
        const results = () => jobs.map(job => ({ topic: job.topic, language: job.language, leaseToken: job.lease,
          items: job.fresh, error: job.fresh ? null : job.error }));
        // Storing is not tied to the caller's connection: an answer already paid for is kept.
        const store = () => rpc('life_news_wide_finish', { p_owner_id: user.id, p_supplier: supplier.id, p_results: results() }, { service: true, detached: true });
        let stored;
        try { stored = await store(); }
        catch (rejected) {
          if (rejected.httpStatus !== 400) throw rejected;
          // The database refused the items (a validated rollback). Exactly one
          // error-only write releases the leases; the refused items are not served.
          for (const job of jobs) if (job.fresh) { job.fresh = null; job.error = 'invalid_response'; }
          stored = await store();
        }
        if (object(stored) && stored.status === 'not_allowed') throw failure('not_enabled_for_account'); // removed from the list meanwhile
        need(object(stored) && stored.status === 'ok' && count(stored.stored) && count(stored.failed) && count(stored.stale) &&
          stored.stored + stored.failed + stored.stale === jobs.length);
      }

      const fetchedNow = new Date(now()).toISOString();
      const groups = entries.map(entry => {
        if (entry.state === 'fresh') return { ...entry, status: 'cached', items: entry.cached, at: entry.cachedAt, reason: null, old: false };
        if (entry.state === 'claimed' && entry.fresh) return { ...entry, status: 'fresh', items: entry.fresh, at: fetchedNow, reason: null, old: false };
        const reason = entry.state === 'limited' ? (entry.limit === 'day' ? 'daily_limit' : 'hourly_limit') : entry.state === 'claimed' ? entry.error : entry.state;
        return { ...entry, status: entry.state === 'limited' ? 'limited' : entry.cached ? 'stale' : 'failed',
          items: entry.cached || [], at: entry.cached ? entry.cachedAt : null, reason, old: !!entry.cached };
      });
      const merged = mergeItems(groups);
      const times = groups.map(group => group.at).filter(Boolean).sort();
      const body = { supplier: supplier.id, items: merged.items, fetchedAt: times[0] || null, stale: groups.some(group => group.old),
        topics: groups.map((group, at) => ({ topic: group.topic, language: group.language, status: group.status, fetchedAt: group.at,
          count: merged.counts[at], ...(group.reason ? { reason: group.reason } : {}) })) };
      const states = status => groups.filter(group => group.status === status).length;
      record({ ...tally, status: 'ok', fresh: states('fresh'), cached: states('cached'), stale: states('stale'), failed: states('failed'),
        limited: states('limited'), items: merged.items.length, ms: now() - started });
      return reply(body);
    } catch (error) {
      return refuse(Object.hasOwn(STATUS, error?.code) ? error.code : 'server_error');
    }
  };
}

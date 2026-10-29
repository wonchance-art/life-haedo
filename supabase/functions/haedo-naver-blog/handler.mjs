import { collect, failure, feedURL, readBounded } from './collector.mjs';
import { createHarvestWorker } from './harvest-worker.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const check = (ok, code = 'invalid_request') => { if (!ok) throw failure(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function secretEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !right.length || left.length !== right.length) return false;
  let different = 0; for (let i = 0; i < right.length; i++) different |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return different === 0;
}
function legacyServiceCandidate(token, hostname) {
  // Unverified claims only bound which credentials may be sent to the current
  // project's service-only RPC. They never establish authentication locally.
  if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return false;
  try {
    const decode = part => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), value => value.charCodeAt(0))));
    const [header, claims] = token.split('.').slice(0, 2).map(decode);
    const ref = /^([a-z0-9-]+)\.supabase\.co$/.exec(hostname)?.[1];
    return object(header) && header.alg === 'HS256' && object(claims) && !!ref &&
      claims.role === 'service_role' && claims.ref === ref && Number.isSafeInteger(claims.exp) && claims.exp > Date.now() / 1000;
  } catch (_) { return false; }
}
const safeCode = error => ['invalid_blog', 'invalid_feed', 'feed_too_large', 'blocked', 'network_error',
  'invalid_response', 'incomplete_response'].includes(error?.code) ? error.code : 'network_error';
/** @param {{fetcher?: typeof fetch, environment?: (name: string) => string | undefined, load?: any, captureModel?: any}} [options] */
export function createHandler({ fetcher = fetch, environment = name => globalThis.Deno?.env.get(name), load, captureModel } = {}) {
  return async request => {
    const deadline = Date.now() + 80000;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
    if (request.method !== 'POST') return response({ error: 'invalid_request' }, 405);
    try {
      const project = new URL(environment('SUPABASE_URL') || '');
      check(project.protocol === 'https:' && !project.username && !project.password && project.pathname === '/' && !project.search && !project.hash, 'setup_required');
      const origin = project.origin; let key = environment('SUPABASE_SERVICE_ROLE_KEY');
      check(typeof key === 'string' && key.length > 0 && !key.startsWith('sb_publishable_') &&
        key !== environment('SUPABASE_ANON_KEY') && key !== environment('SUPABASE_PUBLISHABLE_KEY'), 'setup_required');
      const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') || '')?.[1];
      check(token, 'unauthorized');
      let input;
      try { input = JSON.parse(await readBounded(request, 4096)); } catch (_) { throw failure('invalid_request'); }
      check(object(input));
      const readiness = input.action === 'readiness';
      const harvest = ['inventory','capture','run'].includes(input.action);
      const exactService = secretEqual(token, key);
      const candidate = ['cron','run','readiness'].includes(input.action) && legacyServiceCandidate(token, project.hostname);
      const cron = input.action === 'cron' || input.action === 'run' && (exactService || candidate || Object.keys(input).length === 1);
      let owner = null, verifiedReady;
      if (cron || readiness) {
        check(Object.keys(input).length === 1, 'unauthorized');
        if (!exactService) {
          check(candidate, 'unauthorized');
          // Key rotation can leave two valid service JWTs with different bytes.
          // Authenticate this candidate remotely using ONLY its own credential,
          // never the environment key; do not persist or cache it across requests.
          const endpoint = origin + '/rest/v1/rpc/life_naver_ready';
          const result = await fetcher(endpoint, { method: 'POST', redirect: 'error',
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(Math.min(10000, deadline - Date.now()))]),
            headers: { apikey: token, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}' });
          if (result.redirected || result.url && result.url !== endpoint) {
            await result.body?.cancel(); throw failure('unauthorized');
          }
          if (result.status !== 200) {
            await result.body?.cancel();
            throw failure([401, 403].includes(result.status) ? 'unauthorized' : 'server_error');
          }
          verifiedReady = JSON.parse(await readBounded(result, 1024));
          check(typeof verifiedReady === 'boolean', 'server_error');
          key = token; // Current request only, after remote signature/privilege validation.
        }
      } else {
        check(harvest ? input.action === 'capture' ? Object.keys(input).every(k => ['action','subscriptionId','jobId'].includes(k)) &&
          UUID.test(input.jobId || '') && (input.subscriptionId === undefined || UUID.test(input.subscriptionId)) :
          Object.keys(input).length === 2 && UUID.test(input.subscriptionId || '') :
          Object.keys(input).length === 1 && UUID.test(input.subscriptionId || ''));
        // getUser: validate the JWT with Auth itself, never trust decoded claims.
        const publicKey = environment('SUPABASE_ANON_KEY') || environment('SUPABASE_PUBLISHABLE_KEY');
        check(typeof publicKey === 'string' && publicKey.length > 0, 'setup_required');
        const authenticated = await fetcher(origin + '/auth/v1/user', { method: 'GET', redirect: 'error',
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
          headers: { apikey: publicKey, Authorization: 'Bearer ' + token } });
        if (!authenticated.ok) { await authenticated.body?.cancel(); throw failure('unauthorized'); }
        const user = JSON.parse(await readBounded(authenticated, 16384)); check(object(user) && UUID.test(user.id || ''), 'unauthorized'); owner = user.id;
      }
      const ingestionEnabled = environment('HAEDO_NAVER_INGESTION_ENABLED') === 'true';
      const rpc = async (name, args) => {
        check(deadline > Date.now() + 100, 'server_error');
        const result = await fetcher(origin + '/rest/v1/rpc/' + name, { method: 'POST', redirect: 'error',
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(Math.min(10000, deadline - Date.now()))]),
          headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
        if (!result.ok) { await result.body?.cancel(); throw failure('server_error'); }
        return JSON.parse(await readBounded(result, 4 * 1024 * 1024));
      };
      if (!readiness && !ingestionEnabled) return response({ error: 'setup_required' });
      const ready = verifiedReady === undefined ? await rpc('life_naver_ready', {}) : verifiedReady;
      check(typeof ready === 'boolean', 'server_error');
      // Service-only inspection reads one boolean RPC even while collection is
      // disabled. Never claim work, fetch Naver, or read/write private material.
      if (readiness) return response({ ingestionEnabled, ready });
      if (!ready) return response({ error: 'setup_required' });
      if (harvest) {
        if (typeof load !== 'function' || !captureModel) return response({ error: 'setup_required' });
        const worker = createHarvestWorker({ rpc, fetcher, load, model: captureModel, origin, key, signal: request.signal, deadline });
        return response(await worker.execute({ action: input.action, owner, subscriptionId: input.subscriptionId || null, jobId: input.jobId || null }));
      }
      const claims = await rpc('life_naver_claim', { p_limit: cron ? 2 : 1,
        p_subscription_id: cron ? null : input.subscriptionId, p_owner_id: owner });
      check(Array.isArray(claims) && claims.length <= (cron ? 2 : 1), 'server_error');
      const ids = new Set();
      // Validate the complete claim batch before starting any external request.
      for (const claim of claims) {
        check(object(claim) && UUID.test(claim.subscription_id || '') && UUID.test(claim.owner_id || '') &&
          UUID.test(claim.workspace_id || '') && UUID.test(claim.lease_token || '') &&
          Number.isSafeInteger(claim.revision) && claim.revision > 0 && typeof claim.lease_until === 'string' &&
          Number.isFinite(Date.parse(claim.lease_until)) && Date.parse(claim.lease_until) > Date.now() &&
          !ids.has(claim.subscription_id) && (cron || claim.owner_id === owner && claim.subscription_id === input.subscriptionId), 'server_error');
        feedURL(claim.blog_id); ids.add(claim.subscription_id);
      }
      let stored = 0, failed = 0, stale = 0;
      for (const claim of claims) {
        let items = [], error = null;
        try { items = await collect(claim.blog_id, { fetcher, signal: request.signal }); }
        catch (caught) { error = safeCode(caught); }
        const result = await rpc('life_naver_finish', { p_subscription_id: claim.subscription_id, p_lease_token: claim.lease_token,
          p_revision: claim.revision, p_items: items, p_error: error });
        check(object(result) && ['stored', 'stale', 'already_finished'].includes(result.status) &&
          Number.isSafeInteger(result.inserted) && result.inserted >= 0 && result.inserted <= items.length, 'server_error');
        if (result.status === 'stale') stale++; else if (error) failed++; else stored++;
      }
      // No blog identifier, title, content, lease or upstream error is returned.
      if (!cron) return response(claims.length ? failed ? { error: 'collection_failed' } : { status: stale ? 'busy' : 'checked' } : { status: 'busy' });
      return response({ status: 'checked', checked: claims.length, stored, failed, stale });
    } catch (error) {
      const code = ['invalid_request', 'unauthorized', 'setup_required'].includes(error?.code) ? error.code : 'server_error';
      return response({ error: code }, code === 'unauthorized' ? 401 : code === 'invalid_request' ? 400 : code === 'setup_required' ? 200 : 502);
    }
  };
}

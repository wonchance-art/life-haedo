import { collect, failure, feedURL, readBounded } from './collector.mjs';

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
const safeCode = error => ['invalid_blog', 'invalid_feed', 'feed_too_large', 'blocked', 'network_error',
  'invalid_response', 'incomplete_response'].includes(error?.code) ? error.code : 'network_error';
export function createHandler({ fetcher = fetch, environment = name => globalThis.Deno?.env.get(name) } = {}) {
  return async request => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
    if (request.method !== 'POST') return response({ error: 'invalid_request' }, 405);
    try {
      const project = new URL(environment('SUPABASE_URL') || '');
      check(project.protocol === 'https:' && !project.username && !project.password && project.pathname === '/' && !project.search && !project.hash, 'setup_required');
      const origin = project.origin, key = environment('SUPABASE_SERVICE_ROLE_KEY');
      check(typeof key === 'string' && key.length > 0 && !key.startsWith('sb_publishable_') &&
        key !== environment('SUPABASE_ANON_KEY') && key !== environment('SUPABASE_PUBLISHABLE_KEY'), 'setup_required');
      const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') || '')?.[1];
      check(token, 'unauthorized');
      let input;
      try { input = JSON.parse(await readBounded(request, 4096)); } catch (_) { throw failure('invalid_request'); }
      check(object(input));
      const cron = input.action === 'cron'; let owner = null;
      if (cron) {
        check(Object.keys(input).length === 1 && secretEqual(token, key), 'unauthorized');
      } else {
        check(Object.keys(input).length === 1 && UUID.test(input.subscriptionId || ''));
        // getUser: validate the JWT with Auth itself, never trust decoded claims.
        const publicKey = environment('SUPABASE_ANON_KEY') || environment('SUPABASE_PUBLISHABLE_KEY');
        check(typeof publicKey === 'string' && publicKey.length > 0, 'setup_required');
        const authenticated = await fetcher(origin + '/auth/v1/user', { method: 'GET', redirect: 'error',
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
          headers: { apikey: publicKey, Authorization: 'Bearer ' + token } });
        if (!authenticated.ok) { await authenticated.body?.cancel(); throw failure('unauthorized'); }
        const user = JSON.parse(await readBounded(authenticated, 16384)); check(object(user) && UUID.test(user.id || ''), 'unauthorized'); owner = user.id;
      }
      if (environment('HAEDO_NAVER_INGESTION_ENABLED') !== 'true') return response({ error: 'setup_required' });
      const rpc = async (name, args) => {
        const result = await fetcher(origin + '/rest/v1/rpc/' + name, { method: 'POST', redirect: 'error',
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
          headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
        if (!result.ok) { await result.body?.cancel(); throw failure('server_error'); }
        return JSON.parse(await readBounded(result, 4 * 1024 * 1024));
      };
      const ready = await rpc('life_naver_ready', {}); check(typeof ready === 'boolean', 'server_error');
      if (!ready) return response({ error: 'setup_required' });
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

import { collectArticle, validateArticleInput, validateArticleContent } from './article-intake.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'Vary': 'Authorization',
  'X-Content-Type-Options': 'nosniff' };
const fail = code => Object.assign(new Error(code), { code });
const need = (value, code = 'server_error') => { if (!value) throw fail(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
async function boundedJSON(message, limit) {
  const reader = message.body?.getReader(); need(reader, 'invalid_request');
  let size = 0; const chunks = [];
  try {
    for (;;) { const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength; need(size <= limit, 'invalid_response'); chunks.push(item.value); }
    const data = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function readyResult(value, input) {
  need(object(value) && value.status === 'ready' && value.sourceId === input.sourceId && value.url === input.url &&
    /^[a-f0-9]{64}$/.test(value.contentHash || '') && typeof value.cached === 'boolean' && typeof value.stale === 'boolean');
  const content = validateArticleContent(value.content, input);
  return { status: 'ready', ...input, content, contentHash: value.contentHash, cached: value.cached, stale: value.stale };
}
/** Authenticated, account-wide read-through cache. No client owner or workspace.
 * @param {{fetcher?: typeof fetch, environment?: (name: string) => string | undefined, load?: any, collect?: typeof collectArticle}} [options]
 */
export function createHandler({ fetcher = fetch, environment = name => globalThis.Deno?.env.get(name),
  load, collect = collectArticle } = {}) {
  return async request => {
    const deadline = Date.now() + 30000;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
    if (request.method !== 'POST') return response({ error: 'invalid_request' }, 405);
    try {
      const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') || '')?.[1];
      need(token && token.length <= 8192, 'unauthorized');
      let input;
      try { input = validateArticleInput(await boundedJSON(request, 4096)); }
      catch (_) { throw fail('invalid_request'); }
      let project;
      try { project = new URL(environment('SUPABASE_URL') || ''); } catch (_) { throw fail('setup_required'); }
      need(project.protocol === 'https:' && !project.username && !project.password && project.pathname === '/' && !project.search && !project.hash, 'setup_required');
      const origin = project.origin, publicKey = environment('SUPABASE_ANON_KEY') || environment('SUPABASE_PUBLISHABLE_KEY');
      const serviceKey = environment('SUPABASE_SERVICE_ROLE_KEY');
      need(typeof publicKey === 'string' && publicKey.length > 0 && typeof serviceKey === 'string' && serviceKey.length > 0 &&
        serviceKey !== publicKey && !serviceKey.startsWith('sb_publishable_'), 'setup_required');
      const signal = ms => AbortSignal.any([request.signal, AbortSignal.timeout(Math.max(1, Math.min(ms, deadline - Date.now())))]);
      const authenticated = await fetcher(origin + '/auth/v1/user', { method: 'GET', redirect: 'error', credentials: 'omit',
        signal: signal(5000), headers: { apikey: publicKey, Authorization: 'Bearer ' + token } });
      if (!authenticated.ok) { await authenticated.body?.cancel(); throw fail('unauthorized'); }
      const user = await boundedJSON(authenticated, 16384);
      need(object(user) && UUID.test(user.id || '') && user.is_anonymous !== true, 'unauthorized');
      const rpc = async (name, args, service = false) => {
        need(deadline > Date.now() + 100);
        const result = await fetcher(origin + '/rest/v1/rpc/' + name, { method: 'POST', redirect: 'error', credentials: 'omit',
          signal: signal(5000), headers: { apikey: service ? serviceKey : publicKey,
            Authorization: 'Bearer ' + (service ? serviceKey : token), 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
        if (!result.ok) { await result.body?.cancel(); throw fail(result.status === 404 ? 'setup_required' : !service && [401,403].includes(result.status) ? 'unauthorized' : 'server_error'); }
        return boundedJSON(result, 3 * 1024 * 1024);
      };
      const claim = await rpc('life_discovery_article_claim', { p_source_id: input.sourceId, p_url: input.url });
      need(object(claim));
      if (claim.status === 'ready') return response(readyResult(claim, input));
      if (['busy','rate_limited','unavailable'].includes(claim.status)) return response({ status: claim.status });
      need(claim.status === 'claimed' && UUID.test(claim.leaseToken || ''));
      let content = null, error = null;
      try { content = validateArticleContent(await collect(input, { load, fetcher, signal: request.signal, deadline: deadline - 7000 }), input); }
      catch (caught) { error = ['unavailable','blocked','network_error'].includes(caught?.code) ? caught.code : 'invalid_response'; }
      const result = await rpc('life_discovery_article_finish', { p_owner_id: user.id, p_source_id: input.sourceId,
        p_url: input.url, p_lease_token: claim.leaseToken, p_content: content, p_error: error }, true);
      need(object(result));
      if (result.status === 'ready') return response(readyResult(result, input));
      if (['unavailable','stale'].includes(result.status)) return response({ status: result.status === 'stale' ? 'unavailable' : result.status });
      throw fail('server_error');
    } catch (error) {
      const code = ['invalid_request','unauthorized','setup_required'].includes(error?.code) ? error.code : 'server_error';
      return response({ error: code }, code === 'unauthorized' ? 401 : code === 'invalid_request' ? 400 : code === 'setup_required' ? 200 : 502);
    }
  };
}

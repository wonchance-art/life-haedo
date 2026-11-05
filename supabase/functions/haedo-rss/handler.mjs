import { ALLOWED_HOSTS, collect, createParser, failure, readBounded, safeURL } from './feed.mjs';
import { supabaseKeys, serverHeaders } from '../_shared/supabase-keys.mjs';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const need = (ok, code = 'invalid_request') => { if (!ok) throw failure(code); };
const ERRORS = new Set(['invalid_request','unauthorized','setup_required','server_error','blocked_url','invalid_feed',
  'feed_too_large','item_limit','network_error','rate_limited','revision_conflict','connection_not_found','baseline_required','not_due',
  'rss_conflict','rss_setup_required','rss_connection_exists','rss_baseline_required','rss_not_active','rss_not_paused','rss_retry_unavailable','rss_not_found','rss_auth_required']);
function same(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !right.length || left.length !== right.length) return false;
  let mismatch = 0; for (let i = 0; i < right.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i); return !mismatch;
}
function validate(input) {
  need(object(input));
  const fields = { list: ['workspaceId','before'], register: ['workspaceId','url'], preview: ['workspaceId','connectionId'],
    poll: ['workspaceId','connectionId'], activate: ['workspaceId','connectionId','expectedRevision'],
    pause: ['workspaceId','connectionId','expectedRevision'], resume: ['workspaceId','connectionId','expectedRevision'],
    retry: ['workspaceId','connectionId','expectedRevision'], disconnect: ['workspaceId','connectionId','expectedRevision'], run: [] };
  need(Object.hasOwn(fields, input.action) && Object.keys(input).every(k => k === 'action' || fields[input.action].includes(k)));
  if (input.action === 'run') return;
  need(UUID.test(input.workspaceId || ''));
  if (input.action === 'list') {
    if (input.before !== undefined && input.before !== null) need(object(input.before) && Object.keys(input.before).length === 2 &&
      UUID.test(input.before.id || '') && typeof input.before.fetched_at === 'string' && Number.isFinite(Date.parse(input.before.fetched_at)));
  } else if (input.action === 'register') need(typeof input.url === 'string');
  else need(UUID.test(input.connectionId || ''));
  if (fields[input.action].includes('expectedRevision')) need(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision > 0);
}
/** Defaults never contact a real feed. allowedHosts is trusted construction-time
 * configuration, not a request field. A reviewed source must be added to code
 * and the DB allowlist by the orchestrator before deployment activation.
 * @param {{fetcher?: typeof fetch, environment?: (name: string) => string | undefined,
 * XMLParser?: any, XMLValidator?: any, allowedHosts?: readonly string[]}} [options]
 */
export function createHandler({ fetcher = fetch, environment = name => globalThis.Deno?.env.get(name),
  XMLParser, XMLValidator, allowedHosts = ALLOWED_HOSTS } = {}) {
  return async request => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
    if (request.method !== 'POST') return json({ error: 'invalid_request' }, 405);
    try {
      let input; try { input = JSON.parse(await readBounded(request, 8192)); } catch (_) { throw failure('invalid_request'); }
      validate(input);
      let project; try { project = new URL(environment('SUPABASE_URL')); } catch (_) { throw failure('setup_required'); }
      need(project.protocol === 'https:' && !project.username && !project.password && project.pathname === '/' && !project.search && !project.hash, 'setup_required');
      const { server, publicKey } = supabaseKeys(environment); need(server && publicKey, 'setup_required');
      const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') || '')?.[1];
      const origin = project.origin;
      const call = async (path, headers, body, max = 8 * 1024 * 1024) => {
        const url = origin + path;
        let res; try { res = await fetcher(url, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]), headers: { ...headers, 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); } catch (_) { throw failure('server_error'); }
        if (res.redirected || res.url && res.url !== url) { await res.body?.cancel(); throw failure('server_error'); }
        if (!res.ok) {
          let code = 'server_error';
          if ([401,403].includes(res.status)) code = 'unauthorized';
          else try { const error = JSON.parse(await readBounded(res, 4096)); if (ERRORS.has(error.message)) code = error.message; } catch (_) { /* never expose upstream text */ }
          await res.body?.cancel(); throw failure(code);
        }
        let result; try { result = JSON.parse(await readBounded(res, max)); } catch (_) { throw failure('server_error'); }
        return result;
      };
      const serviceRPC = (name, args) => call('/rest/v1/rpc/' + name, serverHeaders(server), args);
      const runConnection = async (id, owner, workspace) => {
        need(allowedHosts.length && typeof XMLParser === 'function', 'setup_required');
        const claim = await serviceRPC('life_rss_claim', { p_connection_id: id, p_owner_id: owner });
        if (claim === null) return { status: 'not_due' };
        need(object(claim) && claim.connection_id === id && claim.owner_id === owner && claim.workspace_id === workspace &&
          UUID.test(claim.lease_token || '') && Number.isSafeInteger(claim.revision) && claim.revision > 0, 'server_error');
        let collected = { items: [], cursor: claim.cursor, complete: false }, error = null;
        try {
          safeURL(claim.feed_url, allowedHosts);
          collected = await collect({ url: claim.feed_url, cursor: claim.cursor, parse: createParser({ XMLParser, XMLValidator }), fetcher, allowedHosts, signal: request.signal });
          error = collected.error || null;
        } catch (caught) { error = ERRORS.has(caught.code) ? caught.code : 'network_error'; }
        const result = await serviceRPC('life_rss_finish', { p_connection_id: id, p_lease_token: claim.lease_token, p_revision: claim.revision,
          p_items: collected.items, p_next_cursor: collected.cursor, p_complete: collected.complete, p_error: error });
        need(object(result) && ['stored','stale','already_finished','error','partial'].includes(result.status), 'server_error');
        return { status: result.status, inserted: result.inserted || 0, held: result.held || 0, error };
      };
      if (input.action === 'run') {
        // No user JWT can request a batch. New secret keys are never Bearer JWTs.
        const apiKey = request.headers.get('apikey');
        need(same(apiKey, server) || !server.startsWith('sb_') && same(token, server), 'unauthorized');
        need(allowedHosts.length, 'setup_required');
        const due = await serviceRPC('life_rss_due', { p_limit: 2 });
        need(Array.isArray(due) && due.length <= 2, 'server_error');
        for (const row of due) need(object(row) && UUID.test(row.connection_id || '') && UUID.test(row.owner_id || '') && UUID.test(row.workspace_id || ''), 'server_error');
        const results = [];
        for (const row of due) results.push(await runConnection(row.connection_id, row.owner_id, row.workspace_id));
        return json({ checked: results.length, stored: results.filter(r => r.status === 'stored' && !r.error).length,
          failed: results.filter(r => r.error).length, stale: results.filter(r => r.status === 'stale').length });
      }
      need(token && !token.startsWith('sb_'), 'unauthorized');
      const userHeaders = { apikey: publicKey, Authorization: 'Bearer ' + token };
      const user = await call('/auth/v1/user', userHeaders, undefined, 16384);
      need(object(user) && UUID.test(user.id || ''), 'unauthorized');
      const userRPC = (name, args) => call('/rest/v1/rpc/' + name, userHeaders, args);
      const snapshot = async before => {
        const data = await userRPC('life_rss_list', { p_workspace_id: input.workspaceId, ...(before ? { p_before: before } : {}) });
        need(object(data) && Array.isArray(data.connections) && Array.isArray(data.items) && typeof data.ready === 'boolean', 'server_error');
        return { configured: data.ready && allowedHosts.length > 0, connections: data.connections, items: data.items,
          has_more: !!data.has_more, next_cursor: data.next_cursor || null };
      };
      if (input.action === 'list') return json(await snapshot(input.before));
      if (input.action === 'register') {
        safeURL(input.url, allowedHosts);
        await userRPC('life_rss_save', { p_workspace_id: input.workspaceId, p_feed_url: input.url });
      } else {
        // Verify workspace binding via user-owned list before any service RPC.
        const current = await snapshot();
        const connection = current.connections.find(c => c.id === input.connectionId && c.workspace_id === input.workspaceId);
        need(connection, 'connection_not_found');
        if (['preview','poll'].includes(input.action)) {
          need(input.action === 'preview' ? ['preview','draft','pending'].includes(connection.status) : connection.status === 'active', 'invalid_request');
          await runConnection(input.connectionId, user.id, input.workspaceId);
        } else {
          await userRPC('life_rss_control', { p_connection_id: input.connectionId, p_expected_revision: input.expectedRevision, p_action: input.action });
          if (input.action === 'retry') await runConnection(input.connectionId, user.id, input.workspaceId);
        }
      }
      return json(await snapshot());
    } catch (error) {
      const code = ERRORS.has(error?.code) ? error.code : 'server_error';
      return json({ error: code }, code === 'unauthorized' ? 401 : code === 'setup_required' ? 503 : ['invalid_request','blocked_url'].includes(code) ? 400 : code === 'server_error' ? 502 : 409);
    }
  };
}

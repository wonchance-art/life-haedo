import { supabaseKeys, serverHeaders } from '../_shared/supabase-keys.mjs';
import { projectMarkdownOps } from './projection.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const uuid = value => typeof value === 'string' && UUID.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const PHOTO = /^[A-Za-z0-9_-]{1,128}$/;
const INVALID_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u;
export const LIMITS = Object.freeze({ request: 32 * 1024, auth: 16 * 1024, source: 3 * 1024 * 1024, result: 16 * 1024, deadline: 30000 });
export const ALLOWED_ORIGINS = Object.freeze(['https://wonchance-art.github.io', 'http://127.0.0.1:4173', 'http://localhost:4173']);
const BASE_HEADERS = { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin, Authorization' };
const STATUS = { invalid_request: 400, auth_required: 401, permission_denied: 403, remote_missing: 404, blog_conflict: 409,
  operation_mismatch: 409, request_cancelled: 409, blog_update_required: 409, blog_publication_unavailable: 503,
  schema_missing: 503, invalid_remote_data: 502, network_error: 502 };
const fail = code => Object.assign(new Error(code), { code });
const need = (ok, code = 'invalid_request') => { if (!ok) throw fail(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, names) => object(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const integer = (value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const text = (value, max) => typeof value === 'string' && value.length <= max && !INVALID_TEXT.test(value);
const INPUT_FIELDS = ['p_post_id', 'p_expected_revision', 'p_expected_publication_revision', 'p_operation_id', 'p_photo_ids', 'p_author', 'p_copies'];

// This endpoint accepts publication intent only. A caller cannot supply a
// document, ops, title, owner/session, source hash or a prebuilt public snapshot.
export function validateInput(value) {
  need(keys(value, INPUT_FIELDS));
  need(uuid(value.p_post_id) && uuid(value.p_operation_id));
  need(integer(value.p_expected_revision, 1) && integer(value.p_expected_publication_revision, 0, Number.MAX_SAFE_INTEGER - 1));
  need(Array.isArray(value.p_photo_ids) && value.p_photo_ids.length <= 20 && value.p_photo_ids.every(id => typeof id === 'string' && PHOTO.test(id)) &&
    new Set(value.p_photo_ids).size === value.p_photo_ids.length);
  need(keys(value.p_author, ['name', 'intro']) && text(value.p_author.name, 500) && text(value.p_author.intro, 2000));
  need(object(value.p_copies) && Object.keys(value.p_copies).length === value.p_photo_ids.length && value.p_photo_ids.every(id => Object.hasOwn(value.p_copies, id)));
  for (const copy of Object.values(value.p_copies)) {
    need(keys(copy, ['type', 'size', 'digest', 'width', 'height']) && ['image/jpeg', 'image/png'].includes(copy.type) &&
      integer(copy.size, 1, 64 * 1024 * 1024) && integer(copy.width, 1) && integer(copy.height, 1) && digest(copy.digest));
  }
  return structuredClone(value);
}

async function boundedJSON(message, limit, signal, invalidCode) {
  const length = message.headers.get('content-length');
  if (length !== null && /^\d+$/.test(length) && Number(length) > limit) {
    void message.body?.cancel().catch(() => {}); throw fail(invalidCode);
  }
  const reader = message.body?.getReader(); need(reader, invalidCode);
  const cancel = () => { void reader.cancel().catch(() => {}); };
  let size = 0; const chunks = [];
  signal.addEventListener('abort', cancel, { once: true });
  try {
    need(!signal.aborted, 'network_error');
    for (;;) {
      const item = await reader.read();
      need(!signal.aborted, 'network_error');
      if (item.done) break;
      size += item.value.byteLength; need(size <= limit, invalidCode); chunks.push(item.value);
    }
    const data = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
    catch (_) { throw fail(invalidCode); }
  } finally { signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
}

function receipt(value) {
  need(keys(value, ['status', 'token', 'blogToken', 'revision']) && ['stored', 'published'].includes(value.status) &&
    uuid(value.token) && uuid(value.blogToken) && integer(value.revision, 1), 'invalid_remote_data');
  return { status: value.status, token: value.token, blogToken: value.blogToken, revision: value.revision };
}
function terminal(value) {
  need(object(value), 'invalid_remote_data');
  if (value.status === 'missing') { need(keys(value, ['status']), 'invalid_remote_data'); throw fail('remote_missing'); }
  if (value.status === 'conflict') { need(keys(value, ['status', 'revision']) && integer(value.revision), 'invalid_remote_data'); throw fail('blog_conflict'); }
  return receipt(value);
}
function databaseError(value, status) {
  if (status === 401) return 'auth_required';
  if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(value?.code) || status === 404) return 'schema_missing';
  if (['life_auth_required', 'life_blog_auth_required', 'life_blog_markdown_auth_required'].includes(value?.message)) return 'auth_required';
  if (value?.message === 'life_operation_mismatch') return 'operation_mismatch';
  if (value?.message === 'life_blog_update_required') return 'blog_update_required';
  if (value?.message === 'life_blog_markdown_publication_unavailable') return 'blog_publication_unavailable';
  if (status === 403 || value?.code === '42501') return 'permission_denied';
  if (['22023', '22003', '22001'].includes(value?.code)) return 'invalid_request';
  return 'network_error';
}

/** No SDK/session cache: credentials, identity and source stay request-scoped.
 * `project` is the same maintained browser codec/projection, injectable for tests.
 * `origins` lets the isolated browser harness use its own server port; the
 * deployed entrypoint always uses the fixed product allowlist above.
 * @param {{fetcher?: typeof fetch, environment?: (name: string) => string | undefined, project?: typeof projectMarkdownOps, now?: () => number, origins?: ReadonlyArray<string>}} [options]
 */
export function createHandler({ fetcher = fetch, environment = name => globalThis.Deno?.env.get(name), project = projectMarkdownOps, now = Date.now, origins = ALLOWED_ORIGINS } = {}) {
  const allowedOrigins = new Set(origins);
  return async request => {
    const originHeader = request.headers.get('origin'), headers = { ...BASE_HEADERS };
    if (allowedOrigins.has(originHeader)) headers['Access-Control-Allow-Origin'] = originHeader;
    const respond = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
    if (originHeader !== null && !allowedOrigins.has(originHeader)) return respond({ code: 'permission_denied' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return respond({ code: 'invalid_request' }, 405);
    const deadline = now() + LIMITS.deadline;
    const active = () => { need(!request.signal.aborted, 'request_cancelled'); need(now() < deadline, 'network_error'); };
    const signal = ms => { active(); return AbortSignal.any([request.signal, AbortSignal.timeout(Math.max(1, Math.min(ms, deadline - now())))]); };
    try {
      active();
      // Deployment uses verify_jwt=false for signing-key rotation. The shape
      // check is not authentication: Auth verifies this JWT on every call.
      const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(request.headers.get('authorization') || '')?.[1];
      need(token && token.length <= 8192, 'auth_required');
      need(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json');
      const input = validateInput(await boundedJSON(request, LIMITS.request, signal(5000), 'invalid_request'));
      let projectURL;
      try { projectURL = new URL(environment('SUPABASE_URL') || ''); } catch (_) { throw fail('schema_missing'); }
      need(projectURL.protocol === 'https:' && !projectURL.username && !projectURL.password && projectURL.pathname === '/' && !projectURL.search && !projectURL.hash, 'schema_missing');
      const origin = projectURL.origin, { publicKey, server } = supabaseKeys(environment);
      need(publicKey && server, 'schema_missing');
      const authenticate = async () => {
        const authSignal = signal(5000);
        const authenticated = await fetcher(origin + '/auth/v1/user', { method: 'GET', credentials: 'omit', redirect: 'error', signal: authSignal,
          headers: { apikey: publicKey, Authorization: 'Bearer ' + token } });
        if (!authenticated.ok) {
          void authenticated.body?.cancel().catch(() => {});
          const temporary = authenticated.status === 429 || authenticated.status >= 500;
          throw fail(temporary ? 'network_error' : 'auth_required');
        }
        const user = await boundedJSON(authenticated, LIMITS.auth, authSignal, 'invalid_remote_data');
        need(object(user) && uuid(user.id) && user.role === 'authenticated' && user.is_anonymous !== true, 'auth_required');
        return user;
      };
      const user = await authenticate();
      const rpc = async (name, args, service = false) => {
        const rpcSignal = signal(10000);
        const result = await fetcher(origin + '/rest/v1/rpc/' + name, { method: 'POST', credentials: 'omit', redirect: 'error', signal: rpcSignal,
          headers: { ...(service ? serverHeaders(server) : { apikey: publicKey, Authorization: 'Bearer ' + token }), 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
        const data = await boundedJSON(result, result.ok && !service ? LIMITS.source : LIMITS.result, rpcSignal, 'invalid_remote_data');
        if (!result.ok) throw fail(databaseError(data, result.status));
        active(); return data;
      };
      const prepared = await rpc('life_blog_markdown_publish_prepare', input);
      if (prepared?.status !== 'prepared') return respond(terminal(prepared));
      need(keys(prepared, ['status', 'ownerId', 'sessionId', 'revision', 'sourceHash', 'document']) &&
        prepared.ownerId === user.id && uuid(prepared.sessionId) && prepared.revision === input.p_expected_revision &&
        digest(prepared.sourceHash) && prepared.document?.id === input.p_post_id, 'invalid_remote_data');
      let ops;
      try {
        ops = await project(prepared.document, { photoIds: input.p_photo_ids, author: input.p_author,
          copies: Object.entries(input.p_copies).map(([id, copy]) => ({ id, ...copy })) });
      } catch (_) { throw fail('invalid_remote_data'); }
      active();
      // Reverify the same caller immediately before privileged publication.
      // The database also rechecks its live session inside the atomic commit.
      const confirmed = await authenticate();
      need(confirmed.id === user.id, 'auth_required');
      // Identity and source hash come only from the user-scoped database read.
      // The service-only RPC rechecks live session, source/CAS and all copy
      // assets, then writes snapshot/media/receipt in one transaction. A lost
      // response is retried using the same original intent/operation receipt.
      const committed = await rpc('life_blog_markdown_publish_commit', { ...input, p_owner_id: prepared.ownerId,
        p_session_id: prepared.sessionId, p_source_hash: prepared.sourceHash, p_ops: ops }, true);
      return respond(terminal(committed));
    } catch (error) {
      const code = request.signal.aborted ? 'request_cancelled' : Object.hasOwn(STATUS, error?.code) ? error.code : 'network_error';
      // Never echo Auth, PostgREST, projection errors, private source or keys.
      return respond({ code }, STATUS[code]);
    }
  };
}

// Supabase API keys for Edge functions, new format first (2026-11-04).
// Source: https://supabase.com/docs/guides/api/api-keys and
// https://supabase.com/docs/guides/functions/secrets (checked 2026-11-04).
// Legacy anon/service_role keys are retired by the end of 2026. The runtime
// injects SUPABASE_SECRET_KEYS and SUPABASE_PUBLISHABLE_KEYS as JSON objects
// keyed by name; the "default" entry is used for outgoing calls. The legacy
// SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY values are fallbacks only.
// sb_secret_/sb_publishable_ keys are not JWTs: they go only in the apikey
// header, never in Authorization: Bearer. This module never logs or returns
// a key outside the caller's own request.
// haedo-blog-media/index.ts keeps an equivalent TypeScript copy; the shared
// key matrix in tests/supabase-keys.test.cjs checks every function.

// A value with surrounding whitespace is a setup mistake: it is treated as absent,
// never trimmed, so the function sends exactly what the platform holds or nothing.
const text = value => typeof value === 'string' && value.length > 0 && value.trim() === value ? value : null;
function named(raw) {
  if (typeof raw !== 'string' || !raw.length) return null;
  try {
    const value = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) { return null; }
}

/** @param {(name: string) => string | undefined} environment */
export function supabaseKeys(environment) {
  const secrets = named(environment('SUPABASE_SECRET_KEYS'));
  const publishables = named(environment('SUPABASE_PUBLISHABLE_KEYS'));
  const legacyService = text(environment('SUPABASE_SERVICE_ROLE_KEY'));
  const legacyPublic = [text(environment('SUPABASE_ANON_KEY')), text(environment('SUPABASE_PUBLISHABLE_KEY'))];
  const publicKeys = [...Object.values(publishables || {}).map(text), ...legacyPublic].filter(Boolean);
  const serverOnly = key => !!key && !key.startsWith('sb_publishable_') && !publicKeys.includes(key);
  const server = [text(secrets?.default), legacyService].find(serverOnly) || null;
  const publicKey = [text(publishables?.default), ...legacyPublic].find(Boolean) || null;
  // Incoming service calls are compared with `server` only; haedo-naver-blog
  // verifies any other presented server key remotely with that key itself.
  return { server, publicKey };
}

/** Headers for a server-key call to PostgREST or Storage. */
export function serverHeaders(key) {
  return key.startsWith('sb_secret_') ? { apikey: key } : { apikey: key, Authorization: 'Bearer ' + key };
}

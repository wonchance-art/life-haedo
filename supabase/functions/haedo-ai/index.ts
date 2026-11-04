// Thin Deno entry for haedo-ai. Deploy with verify_jwt=false (2026-11-04):
// the handler verifies the Auth user itself through /auth/v1/user and never
// trusts decoded claims, so rotating JWT signing keys cannot break it.
// Reads only SUPABASE_URL, SUPABASE_SECRET_KEYS and SUPABASE_PUBLISHABLE_KEYS
// ("default" entries; legacy SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are
// fallbacks), the ANTHROPIC_API_KEY secret (set by the owner) and the
// HAEDO_AI_OWNER_ID secret (the one allowed account, set by the orchestrator).
// Neither secret is in the repository. Without either one every request is
// refused with ai_not_configured before any provider call. Deploy this file
// with handler.mjs and ../_shared/supabase-keys.mjs.
import { createHandler } from './handler.mjs';
if (typeof Deno !== 'undefined') Deno.serve(createHandler());

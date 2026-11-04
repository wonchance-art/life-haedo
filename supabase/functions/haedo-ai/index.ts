// Thin Deno entry for haedo-ai. Platform JWT verification may stay enabled;
// the handler verifies the Auth user itself and never trusts decoded claims.
// Reads only SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY or
// SUPABASE_PUBLISHABLE_KEY, and the ANTHROPIC_API_KEY secret (set by the owner;
// never in the repository). Without that secret every request is refused
// with ai_not_configured before any provider call.
import { createHandler } from './handler.mjs';
if (typeof Deno !== 'undefined') Deno.serve(createHandler());

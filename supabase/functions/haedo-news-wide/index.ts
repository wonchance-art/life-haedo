// Thin Deno entry for haedo-news-wide. Deploy only after orchestrator review,
// with verify_jwt=false (2026-11-04 decision): the handler refuses every Bearer
// value that is not a JWT-shaped user session before reading the body, checks
// the account with /auth/v1/user and never trusts decoded claims.
// Reads only SUPABASE_URL, SUPABASE_SECRET_KEYS and SUPABASE_PUBLISHABLE_KEYS
// ("default" entries; legacy SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are
// fallbacks). It needs no secret of its own.
// Deploy this file with handler.mjs, topics.mjs, upstream.mjs, items.mjs,
// xml.mjs, suppliers/google-news.mjs, ../_shared/supabase-keys.mjs and the
// XML parser bundle that haedo-rss already vendors (one copy, pinned by hash).
import { createHandler } from './handler.mjs';
import { XMLParser, XMLValidator } from '../haedo-rss/vendor/fast-xml-parser.mjs';
if (typeof Deno !== 'undefined') Deno.serve(createHandler({ XMLParser, XMLValidator }));

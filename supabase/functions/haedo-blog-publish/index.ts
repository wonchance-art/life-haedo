// User-JWT endpoint: deploy with verify_jwt=false, matching the 2026-11-04
// signing-key rotation decision. The handler verifies Auth/user itself before
// prepare and commit; the database also checks the live session. API keys and
// JWT-shaped strings alone never authenticate a user.
// No runtime packages: projection.mjs imports the maintained repository codec.
import { createHandler } from './handler.mjs';
if (typeof Deno !== 'undefined') Deno.serve(createHandler());

// User-JWT endpoint: leave verify_jwt enabled at deployment. The handler still
// verifies Auth/user and the database's live session; an API key is not a user.
// No runtime packages: projection.mjs imports the maintained repository codec.
import { createHandler } from './handler.mjs';
if (typeof Deno !== 'undefined') Deno.serve(createHandler());

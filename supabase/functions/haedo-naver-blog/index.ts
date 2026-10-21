// Platform JWT verification may remain enabled for user requests. The handler
// independently verifies Auth users and exact service-role cron authorization.
import { createHandler } from './handler.mjs';
if (typeof Deno !== 'undefined') Deno.serve(createHandler());

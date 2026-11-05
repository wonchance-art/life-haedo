// User JWT verification remains enabled at the gateway. The handler also checks
// Auth; cache RPCs require the authenticated user's still-live session.
import { createHandler } from './handler.mjs';
import { load } from 'npm:cheerio@1.2.0/slim';
if (typeof Deno !== 'undefined') Deno.serve(createHandler({ load }));

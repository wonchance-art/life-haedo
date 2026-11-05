// Deploy only after orchestrator review. Default ALLOWED_HOSTS is empty.
// User requests verify Auth remotely; scheduler requests use exact server apikey.
import { createHandler } from './handler.mjs';
import { XMLParser, XMLValidator } from './vendor/fast-xml-parser.mjs';
Deno.serve(createHandler({ XMLParser, XMLValidator }));

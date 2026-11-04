// Deployed with verify_jwt=false. The handler independently verifies Auth users
// and exact server-key cron authorization (apikey header; legacy Bearer JWT still
// accepted). Deploy with ../_shared/supabase-keys.mjs (2026-11-04 key migration).
import { createHandler } from './handler.mjs';
import { load } from 'npm:cheerio@1.2.0/slim';
import '../../../assets/life/naver-blog.js';
import '../../../assets/life/naver-capture.js';
const life = (globalThis as typeof globalThis & { HaedoLife: { NaverCapture: unknown } }).HaedoLife;
if (typeof Deno !== 'undefined') Deno.serve(createHandler({ load, captureModel: life.NaverCapture }));

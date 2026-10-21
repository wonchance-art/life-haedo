// Platform JWT verification may remain enabled for user requests. The handler
// independently verifies Auth users and exact service-role cron authorization.
import { createHandler } from './handler.mjs';
import { load } from 'npm:cheerio@1.2.0/slim';
import '../../../assets/life/naver-blog.js';
import '../../../assets/life/naver-capture.js';
const life = (globalThis as typeof globalThis & { HaedoLife: { NaverCapture: unknown } }).HaedoLife;
if (typeof Deno !== 'undefined') Deno.serve(createHandler({ load, captureModel: life.NaverCapture }));

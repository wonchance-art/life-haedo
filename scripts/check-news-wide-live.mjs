// MANUAL check, never part of npm test or CI: it contacts the real supplier.
//   node scripts/check-news-wide-live.mjs
// Sends exactly two requests through the production request code
// (supabase/functions/haedo-news-wide/upstream.mjs): the general word "기후" to
// the Korean edition and "climate" to the US edition. It takes no arguments, so
// no personal topic can be sent by mistake. It prints counts and field
// coverage only; headlines and links are not printed or saved.
// Exit 0: both answers have the layout the fixtures in tests/fixtures/news-wide
// assume. Exit 1: a request failed or the layout differs. Behind a proxy that
// Node's fetch must be told about, run it with NODE_USE_ENV_PROXY=1.
import { createUpstream, upstreamURL, UPSTREAM } from '../supabase/functions/haedo-news-wide/upstream.mjs';
import { googleNews } from '../supabase/functions/haedo-news-wide/suppliers/google-news.mjs';
import { XMLParser, XMLValidator } from '../supabase/functions/haedo-rss/vendor/fast-xml-parser.mjs';

if (process.argv.length !== 2) { console.error('This check takes no arguments.'); process.exit(1); }
const QUERIES = [['기후', 'ko'], ['climate', 'en']];
const seen = [];
const fetcher = async (url, init) => {
  const response = await fetch(url, init);
  seen.push({ status: response.status, type: response.headers.get('content-type'), length: response.headers.get('content-length'), redirected: response.redirected });
  return response;
};
const run = createUpstream({ supplier: googleNews, XMLParser, XMLValidator, fetcher });
let failed = false;
for (const [topic, language] of QUERIES) {
  const address = upstreamURL(googleNews, topic, language), started = Date.now();
  try {
    const items = await run(topic, language, { timeout: UPSTREAM.timeout });
    const share = test => items.filter(test).length + '/' + items.length;
    const report = { request: address, ms: Date.now() - started, http: seen.at(-1), items: items.length,
      dated: share(item => item.publishedAt !== null), outletName: share(item => item.sourceName !== null), outletHttpsAddress: share(item => item.sourceUrl !== null),
      articlePath: share(item => item.link.startsWith('https://news.google.com/rss/articles/')),
      titleStillEndsWithOutlet: share(item => item.sourceName !== null && item.title.endsWith(' - ' + item.sourceName)),
      longestLink: Math.max(0, ...items.map(item => item.link.length)), longestTitle: Math.max(0, ...items.map(item => [...item.title].length)) };
    console.log(JSON.stringify(report));
    const ok = items.length > 0 && items.every(item => item.sourceName !== null) && items.filter(item => item.publishedAt !== null).length >= items.length * 0.9 &&
      items.every(item => item.link.startsWith('https://news.google.com/rss/articles/'));
    if (!ok) { failed = true; console.error('LAYOUT DIFFERS from the fixtures for ' + language); }
  } catch (error) {
    failed = true;
    console.error(JSON.stringify({ request: address, ms: Date.now() - started, http: seen.at(-1) || null, error: error?.code || 'error' }));
  }
}
process.exit(failed ? 1 : 0);

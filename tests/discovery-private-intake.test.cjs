const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { load } = createRequire(require('node:path').join(__dirname, 'fixtures/naver-extractor/package.json'))('cheerio/slim');
const intake = import('../supabase/functions/haedo-discovery-private/article-intake.mjs');
const INPUT = { sourceId: 'frontiers-psychology', url: 'https://www.frontiersin.org/articles/10.3389/fpsyg.2026.12345' };
const MIT = { sourceId: 'mit-linguistics', url: 'https://news.mit.edu/2026/test-language-learning-1029' };
const LLT = { sourceId: 'llt-journal', url: 'https://www.lltjournal.org/item/10125-73714/' };
const NOW = Date.parse('2026-10-29T12:00:00.000Z');
const CC = 'https://creativecommons.org/licenses/by/4.0/';
function xml({ body = '<sec><title>Findings</title><p>Body <bold>text</bold> 😀.</p></sec>', license = true, extra = '', author = 'Min' } = {}) {
  return '<?xml version="1.0" encoding="utf-8"?><article xmlns:xlink="http://www.w3.org/1999/xlink"><front><article-meta>' +
    '<article-id pub-id-type="doi">10.3389/fpsyg.2026.12345</article-id><contrib-group><contrib contrib-type="author"><name><given-names>' + author + '</given-names><surname>Kim</surname></name></contrib><contrib contrib-type="editor"><name><given-names>Wrong</given-names><surname>Editor</surname></name></contrib></contrib-group>' +
    (license ? '<permissions><license xlink:href="' + CC + '"><license-p>CC BY</license-p></license></permissions>' : '') +
    '<abstract><p>Publisher abstract.</p></abstract></article-meta></front><body>' + body + '</body><back><ref-list><ref><label>1</label><element-citation><name><surname>Lee</surname><given-names>A</given-names></name><year>2025</year><article-title>Research note.</article-title></element-citation></ref></ref-list></back>' + extra + '</article>';
}
function figure(number = '001', extra = '') { return '<fig><label>Figure 1</label><caption><p>Research figure.</p></caption><graphic xlink:href="fpsyg-17-12345-g' + number + '.tif"/>' + extra + '</fig>'; }
function rss(url = INPUT.url, description = 'Publisher abstract.') { return '<?xml version="1.0"?><rss><channel><item><link>' + url + '</link><description><![CDATA[' + description + ']]></description></item></channel></rss>'; }
function mit(body = '<p>First paragraph.</p><p>Second <b>paragraph</b>.</p>') { return '<html><head><link rel="canonical" href="' + MIT.url + '"><meta property="og:url" content="' + MIT.url + '"><meta property="og:description" content="Publisher standfirst."></head><body><nav>Other stories</nav><div class="news-article--content--body--inner">' + body + '</div><aside>Newsletter secret</aside></body></html>'; }
function webp(width = 2, height = 2) {
  const bytes = Buffer.alloc(30); bytes.write('RIFF'); bytes.writeUInt32LE(22, 4); bytes.write('WEBPVP8X', 8); bytes.writeUInt32LE(10, 16); bytes.writeUIntLE(width - 1, 24, 3); bytes.writeUIntLE(height - 1, 27, 3); return bytes;
}
function fixture(options = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init }); const path = new URL(url).pathname;
    if (options.inspect) options.inspect(url, init);
    if (path === '/robots.txt') return new Response(options.robots || 'User-agent: *\nAllow: /', { status: options.robotsStatus || 200 });
    if (path.endsWith('/xml')) return options.xmlResponse ? options.xmlResponse() : new Response(options.xml || xml({ body: '<p>Body.</p>' + figure() }), { headers: { 'Content-Type': 'text/xml' } });
    if (path.endsWith('.webp')) return options.imageResponse ? options.imageResponse() : new Response(webp(), { headers: { 'Content-Type': 'image/webp' } });
    if (path.endsWith('/rss') || path.endsWith('rss.xml') || path === '/feedlet/') return new Response(options.rss || rss(options.input?.url || INPUT.url), { headers: { 'Content-Type': 'application/rss+xml' } });
    if (url === MIT.url) return new Response(options.html || mit(), { headers: { 'Content-Type': 'text/html' } });
    throw new Error('unexpected request');
  };
  return { calls, fetcher };
}
test('only reviewed publisher article paths are inputs; URL spelling cannot bypass provider routing', async () => {
  const { validateArticleInput } = await intake;
  for (const input of [INPUT, MIT, LLT]) assert.deepEqual(validateArticleInput(input), input);
  for (const input of [
    { ...INPUT, other: true }, { ...INPUT, sourceId: 'constructor' }, { ...INPUT, sourceId: 'naver-d2' },
    ...['http://www.frontiersin.org/articles/10.3389/fpsyg.2026.12345', INPUT.url + '?x=1', INPUT.url + '#x',
      INPUT.url.replace('www.frontiersin.org', 'www.frontiersin.org.evil.example'), INPUT.url.replace('https://', 'https://user:pass@'),
      INPUT.url.replace('.org/', '.org:443/'), INPUT.url.replace('/articles/', '/secret/../articles/'),
      'https://www.frontiersin.org/files/Articles/12345/xml-images/a.webp'].map(url => ({ ...INPUT, url }))
  ]) assert.throws(() => validateArticleInput(input), { code: 'invalid_article' });
});
test('JATS keeps scoped authors, exact paragraph order, table spans, references, captions and original figure position', async () => {
  const { parseFrontiersXML, validateArticleContent } = await intake;
  const source = xml({ body: '<sec><title>Results</title><p>First sentence.</p><table-wrap><label>Table 1</label><table><tr><th rowspan="2">Group</th><th colspan="2">Score</th></tr><tr><td>A</td><td>B</td></tr></table></table-wrap>' + figure() + '<p>Last sentence.</p></sec>',
    extra: '<sub-article><front><article-meta><contrib-group><contrib contrib-type="author"><name><given-names>Unrelated</given-names><surname>Author</surname></name></contrib></contrib-group></article-meta></front><body><p>Wrong article text</p></body></sub-article>' });
  const { content, candidates } = parseFrontiersXML(source, INPUT.url, { load, now: NOW });
  assert.equal(content.coverage, 'full_text'); assert.equal(content.rights.mode, 'private_reading');
  assert.equal(content.rights.label, 'Min Kim · Frontiers');
  assert.match(content.bodyText, /Results\n\nFirst sentence\.\n\nTable 1\n\nGroup \| Score \| \n\n \| A \| B/);
  assert.match(content.bodyText, /Lee A 2025 Research note\./); assert.doesNotMatch(content.bodyText, /Wrong article|Unrelated|Editor/);
  assert.equal(content.bodyText.split('\n\n')[candidates[0].afterParagraph], 'Figure 1 Research figure.');
  assert.equal(content.acquisition.sourceUrl, 'https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.12345/xml');
  assert.deepEqual(validateArticleContent(content, INPUT), content);
});
test('private retrieval records source conditions without requiring a public reuse licence', async () => {
  const { parseFrontiersXML } = await intake;
  const result = parseFrontiersXML(xml({ license: false, body: '<p>Private reading.</p>' + figure('001', '<attrib>Other contributor credit</attrib>') }), INPUT.url, { load });
  assert.equal(result.content.coverage, 'full_text'); assert.equal(result.content.acquisition.license.url, null);
  assert.equal(result.candidates.length, 1); assert.match(result.candidates[0].credit, /Other contributor credit/);
});
test('XML rejects mismatched identity, malformed structure, external entities and unbounded trees', async () => {
  const { parseFrontiersXML } = await intake;
  for (const source of [xml().replace('fpsyg.2026.12345</article-id>', 'fpsyg.2026.67890</article-id>'), xml().replace('</p>', '</title>'),
    xml().replace('<article xmlns', '<!DOCTYPE article [<!ENTITY x SYSTEM "file:///etc/passwd">]><article xmlns'),
    xml().replace('Publisher abstract.', '&unknown;'), xml().replace('Publisher abstract.', '&#0;'),
    xml().replace('<body>', '<body x="1" x="2">'), xml().replace('<body>', '<body>' + '<sec>'.repeat(50)), xml() + xml()])
    assert.throws(() => parseFrontiersXML(source, INPUT.url, { load }), { code: 'invalid_article' });
  const known = '<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Publishing DTD v1.3 20210610//EN" "JATS-journalpublishing1-3-mathml3.dtd">';
  assert.equal(parseFrontiersXML(xml().replace('<article ', known + '<article '), INPUT.url, { load }).content.coverage, 'full_text');
});
test('unrepresentable mathematics, malformed tables and oversized full text preserve a labelled publisher abstract', async () => {
  const { parseFrontiersXML } = await intake;
  for (const body of ['<p>Formula <inline-formula><math>x+1</math></inline-formula></p>', '<table><tr><td rowspan="8">Broken</td></tr></table>', '<p>' + 'x'.repeat(200001) + '</p>']) {
    const { content, candidates } = parseFrontiersXML(xml({ body }), INPUT.url, { load });
    assert.equal(content.coverage, 'summary'); assert.equal(content.summary, 'Publisher abstract.'); assert.equal(Object.hasOwn(content, 'bodyText'), false); assert.deepEqual(candidates, []);
  }
});
test('RSS uses exactly one matching item, excludes active HTML and never marks description as full body', async () => {
  const { parsePublisherRSS } = await intake;
  const content = parsePublisherRSS(rss(LLT.url, '<p>Abstract one.</p><script>secret()</script><div hidden>Hidden</div><p>Abstract two.</p>'), LLT, { load });
  assert.equal(content.summary, 'Abstract one.\n\nAbstract two.'); assert.equal(content.coverage, 'summary'); assert.equal(content.acquisition.method, 'publisher_rss');
  assert.throws(() => parsePublisherRSS(rss(INPUT.url), LLT, { load }), { code: 'unavailable' });
  assert.throws(() => parsePublisherRSS(rss(LLT.url).replace('</channel>', '<item><link>' + LLT.url + '</link><description>Duplicate</description></item></channel>'), LLT, { load }), { code: 'unavailable' });
});
test('MIT HTML requires exact publisher identity and one source-specific body root', async () => {
  const { parseMITHTML, validateArticleContent } = await intake;
  const content = parseMITHTML(mit('<p>First.</p><iframe src="https://evil.invalid"></iframe><p>Second.</p><div hidden>Invisible</div>'), MIT, { load });
  assert.equal(content.coverage, 'full_text'); assert.equal(content.bodyText, 'First.\n\nSecond.'); assert.equal(content.acquisition.method, 'publisher_html');
  assert.deepEqual(validateArticleContent(content, MIT), content);
  assert.throws(() => parseMITHTML(mit().replaceAll(MIT.url, MIT.url + '-different'), MIT, { load }), { code: 'invalid_article' });
  assert.throws(() => parseMITHTML(mit().replace('news-article--content--body--inner', 'generic-main'), MIT, { load }), { code: 'unavailable' });
  assert.throws(() => parseMITHTML(mit('<table><tr><td>Unsupported</td></tr></table>'), MIT, { load }), { code: 'unavailable' });
});
test('intake checks robots for its own UA, follows no redirects and sends no account headers', async () => {
  const { collectArticle } = await intake;
  const ok = fixture(); const content = await collectArticle(INPUT, { load, fetcher: ok.fetcher });
  assert.equal(content.coverage, 'full_text'); assert.equal(content.images.length, 1); assert.equal(ok.calls.length, 3);
  for (const { init } of ok.calls) { assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.headers.Authorization, undefined); assert.equal(init.headers.Cookie, undefined); }
  const blocked = fixture({ robots: 'User-agent: *\nAllow: /\nUser-agent: HaedoDiscoveryReader\nDisallow: /' });
  await assert.rejects(collectArticle(INPUT, { load, fetcher: blocked.fetcher }), { code: 'blocked' }); assert.equal(blocked.calls.length, 1);
  const delay = fixture({ robots: 'User-agent: *\nCrawl-delay: 2\nAllow: /' });
  await assert.rejects(collectArticle(INPUT, { load, fetcher: delay.fetcher }), { code: 'blocked' });
  const redirect = fixture({ xmlResponse: () => { const response = new Response('x'); Object.defineProperty(response, 'url', { value: 'https://other.invalid/x' }); return response; } });
  await assert.rejects(collectArticle(INPUT, { load, fetcher: redirect.fetcher }), { code: 'blocked' }); assert.equal(redirect.calls.length, 2);
});
test('missing body falls back to matching official RSS; blocked access never retries through a different endpoint', async () => {
  const { collectArticle } = await intake;
  const missing = fixture({ xmlResponse: () => new Response('gone', { status: 404 }) });
  assert.equal((await collectArticle(INPUT, { load, fetcher: missing.fetcher })).coverage, 'summary'); assert.equal(missing.calls.length, 3);
  const denied = fixture({ xmlResponse: () => new Response('no', { status: 403 }) });
  await assert.rejects(collectArticle(INPUT, { load, fetcher: denied.fetcher }), { code: 'blocked' }); assert.equal(denied.calls.length, 2);
  const notInFeed = fixture({ xmlResponse: () => new Response('gone', { status: 404 }), rss: rss(INPUT.url.replace('12345', '67890')) });
  await assert.rejects(collectArticle(INPUT, { load, fetcher: notInFeed.fetcher }), { code: 'unavailable' });
  const mitFallback = fixture({ html: mit().replace('news-article--content--body--inner', 'gone'), input: MIT });
  assert.equal((await collectArticle(MIT, { load, fetcher: mitFallback.fetcher })).coverage, 'summary');
});
test('LLT permits only its observed same-origin robots trailing-slash redirect and then reads the exact RSS item', async () => {
  const { collectArticle } = await intake; const calls = [];
  const fetcher = async (url, init) => {
    calls.push(url);
    if (url.endsWith('/robots.txt')) { assert.equal(init.redirect, 'manual'); return new Response(null, { status: 301, headers: { Location: '/robots.txt/' } }); }
    if (url.endsWith('/robots.txt/')) { assert.equal(init.redirect, 'error'); return new Response('missing', { status: 404 }); }
    return new Response(rss(LLT.url), { headers: { 'Content-Type': 'application/rss+xml' } });
  };
  const content = await collectArticle(LLT, { load, fetcher }); assert.equal(content.coverage, 'summary'); assert.equal(calls.length, 3);
  for (const location of ['https://evil.invalid/robots.txt/', '/feedlet/', '//evil.invalid/robots.txt/']) {
    const seen = []; await assert.rejects(collectArticle(LLT, { load, fetcher: async url => { seen.push(url); return new Response(null, { status: 301, headers: { Location: location } }); } }), { code: 'blocked' }); assert.equal(seen.length, 1);
  }
});
test('images require matching signature, bounded bytes/dimensions and the same DOI source path', async () => {
  const { collectArticle, imagePayload, validateArticleContent } = await intake;
  const source = fixture(); const content = await collectArticle(INPUT, { load, fetcher: source.fetcher });
  const pic = content.images[0]; assert.deepEqual(Buffer.from(pic.dataBase64, 'base64'), webp());
  assert.throws(() => imagePayload(webp(), 'image/png', pic)); assert.throws(() => imagePayload(webp(4097), 'image/webp', pic));
  assert.throws(() => imagePayload(Buffer.alloc(256 * 1024 + 1), 'image/webp', pic));
  const wrong = structuredClone(content); wrong.images[0].sourceUrl = pic.sourceUrl.replaceAll('12345', '67890');
  assert.throws(() => validateArticleContent(wrong, INPUT));
  const bad = fixture({ imageResponse: () => new Response('<svg></svg>', { headers: { 'Content-Type': 'image/svg+xml' } }) });
  const textOnly = await collectArticle(INPUT, { load, fetcher: bad.fetcher }); assert.equal(textOnly.coverage, 'full_text'); assert.equal(textOnly.images, undefined); assert.match(textOnly.bodyText, /Research figure/);
});
test('bounded stream, invalid transfer, expired deadline and cancellation do not produce invented content', async () => {
  const { collectArticle } = await intake;
  const oversized = fixture({ xmlResponse: () => new Response('x', { headers: { 'Content-Type': 'text/xml', 'Content-Length': String(2 * 1024 * 1024 + 1) } }) });
  assert.equal((await collectArticle(INPUT, { load, fetcher: oversized.fetcher })).coverage, 'summary');
  const compressed = fixture({ xmlResponse: () => new Response('x', { headers: { 'Content-Type': 'text/xml', 'Content-Encoding': 'gzip' } }) });
  assert.equal((await collectArticle(INPUT, { load, fetcher: compressed.fetcher })).coverage, 'summary');
  const expired = fixture(); await assert.rejects(collectArticle(INPUT, { load, fetcher: expired.fetcher, deadline: Date.now() - 1 }), { code: 'network_error' }); assert.equal(expired.calls.length, 0);
  const aborted = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(collectArticle(INPUT, { load, fetcher: aborted.fetcher, signal: controller.signal }), { code: 'network_error' }); assert.equal(aborted.calls.length, 0);
});
test('cached content must retain scope, exact acquisition and original byte validation', async () => {
  const { parseFrontiersXML, validateArticleContent } = await intake;
  const { content } = parseFrontiersXML(xml(), INPUT.url, { load, now: NOW });
  for (const alter of [c => { c.acquisition.scope = 'public'; }, c => { c.acquisition.fetchedAt = '2026-99-99T00:00:00.000Z'; }, c => { c.acquisition.sourceUrl = c.acquisition.sourceUrl.replace('12345', '67890'); }, c => { c.extra = 'ignored?'; }, c => { c.rights.mode = 'full_text_allowed'; }]) {
    const copy = structuredClone(content); alter(copy); assert.throws(() => validateArticleContent(copy, INPUT), { code: 'invalid_article' });
  }
});

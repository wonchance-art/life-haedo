const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const modules = Promise.all([
  import('../supabase/functions/haedo-naver-blog/collector.mjs'),
  import('../supabase/functions/haedo-naver-blog/handler.mjs'),
]);
const BLOG = 'fixture_blog';
const ids = { user: '11111111-1111-4111-8111-111111111111', other: '22222222-2222-4222-8222-222222222222',
  subscription: '33333333-3333-4333-8333-333333333333', workspace: '44444444-4444-4444-8444-444444444444',
  lease: '55555555-5555-4555-8555-555555555555' };
const item = (description = '<p>첫 문장 😀 &amp; 다음</p>', more = '') => '<item><title>합성 글</title><link>https://blog.naver.com/' + BLOG + '/123</link><description><![CDATA[' + description + ']]></description>' + more + '</item>';
const feed = (items = item()) => '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>' + items + '</channel></rss>';
function fixture(overrides = {}) {
  const env = { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-secret-fixture',
    SUPABASE_ANON_KEY: 'public-fixture', HAEDO_NAVER_INGESTION_ENABLED: 'true', ...overrides.env };
  const calls = [], finishes = [], prior = ['existing-body'];
  const claim = { subscription_id: ids.subscription, owner_id: ids.user, workspace_id: ids.workspace,
    blog_id: BLOG, revision: 7, lease_token: ids.lease, lease_until: new Date(Date.now() + 300000).toISOString(), ...overrides.claim };
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options }); const args = options.body ? JSON.parse(options.body) : null;
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: ids.user }, { status: overrides.authStatus || 200 });
    if (url.endsWith('/life_naver_ready')) return Response.json(overrides.ready !== false);
    if (url.endsWith('/life_naver_claim')) return Response.json(overrides.claims || [claim]);
    if (url.endsWith('/life_naver_finish')) {
      finishes.push(args); if (!args.p_error) prior.push(...args.p_items.map(v => v.content_text));
      return Response.json({ status: overrides.finishStatus || 'stored', inserted: args.p_error ? 0 : args.p_items.length });
    }
    if (url === 'https://rss.blog.naver.com/robots.txt') return new Response(overrides.robots ?? 'User-agent: *\nAllow: /');
    if (url === 'https://rss.blog.naver.com/' + BLOG + '.xml') {
      if (overrides.throwFeed) throw new Error('private-upstream-response-never-leak');
      return overrides.feedResponse ? overrides.feedResponse() : new Response(overrides.feed ?? feed());
    }
    throw new Error('unexpected fixture URL');
  };
  const request = (body = { subscriptionId: ids.subscription }, bearer = 'user-token-fixture') => new Request('https://fixture.supabase.co/functions/v1/haedo-naver-blog',
    { method: 'POST', headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { env, fetcher, calls, finishes, prior, request };
}
test('RSS description becomes only partial safe text; exact UTF-8 SHA, dates and empty links remain honest', async () => {
  const [{ parseFeed }] = await modules;
  const rows = await parseFeed(feed(item('<p>첫 문장 😀 &amp; 다음</p><script>private()</script><img src="https://evil.invalid/pixel">', '<pubDate>Tue, 20 Oct 2026 12:00:00 GMT</pubDate>')), BLOG);
  assert.equal(rows[0].content_text, '첫 문장 😀 & 다음');
  assert.equal(rows[0].content_hash, createHash('sha256').update('첫 문장 😀 & 다음').digest('hex'));
  assert.equal(rows[0].coverage, 'partial'); assert.equal(rows[0].published_at, '2026-10-20T12:00:00.000Z');
  assert.deepEqual(Object.keys(rows[0]).sort(), ['log_no','title','url','content_text','content_hash','published_at','coverage'].sort());
  const [empty] = await parseFeed(feed(item('<img src="https://evil.invalid/pixel"><script>secret</script>')), BLOG);
  assert.equal(empty.coverage, 'link_only'); assert.equal(empty.content_text, null); assert.equal(empty.content_hash, null);
});
test('strict XML rejects DTD/entity tricks, broken/incomplete structures and duplicate fields', async () => {
  const [{ parseFeed }] = await modules;
  for (const invalid of [
    '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + feed(),
    feed().replace('합성 글', '&custom;'), feed().replace('합성 글', '&#xD800;'),
    feed().slice(0, -6), feed().replace('</item>', '</wrong>'), feed().replace('<title>', '<title bad="x" bad="y">'),
    feed().replace('</title>', '</title><title>duplicate</title>'), feed().replace('UTF-8', 'UTF-16'),
    feed(''), feed(item() + item()), '<feed><entry/></feed>', feed().replace('<title>', '<title><b/>'),
    feed().replace('version="2.0"', 'version="1.0"'), feed().replace('합성 글', ']]>'),
    '<rss ' + ' '.repeat(10000),
  ]) await assert.rejects(parseFeed(invalid, BLOG), { code: 'invalid_feed' });
  // DTD-looking text inside CDATA is inert text and never expanded.
  const safe = await parseFeed(feed(item('literal &lt;!DOCTYPE rss&gt; &amp;')), BLOG);
  assert.equal(safe[0].content_hash.length, 64);
});
test('cross-blog, SSRF, encoded identity and ambiguous URL aliases fail closed', async () => {
  const [{ parseFeed, feedURL, postIdentity }] = await modules;
  for (const input of ['../private', 'x/y', 'x%2fy', 'https://host', 'x?y', 'x\\y', '']) assert.throws(() => feedURL(input));
  const invalid = ['http://127.0.0.1/123', 'https://blog.naver.com.evil.invalid/' + BLOG + '/123',
    'https://blog.naver.com/other/123', 'https://blog.naver.com/' + BLOG + '/%31',
    'https://blog.naver.com/' + BLOG + '/123#x', 'https://blog.naver.com:443/' + BLOG + '/123',
    'https://blog.naver.com/PostView.naver?blogId=' + BLOG + '&logNo=123&logNo=456',
    'https://blog.naver.com/PostView.naver?BlogId=' + BLOG + '&logNo=123',
    'https://blog.naver.com/PostView.naver?blogId=%66ixture_blog&logNo=123'];
  for (const url of invalid) assert.throws(() => postIdentity(url, BLOG));
  const alias = 'https://m.blog.naver.com/PostView.naver?blogId=' + BLOG + '&amp;logNo=123';
  assert.equal((await parseFeed(feed().replace('https://blog.naver.com/' + BLOG + '/123', alias), BLOG))[0].url, 'https://blog.naver.com/' + BLOG + '/123');
  const mixed = 'FiXture_Blog';
  assert.equal(feedURL(mixed), 'https://rss.blog.naver.com/' + mixed + '.xml');
  assert.equal(postIdentity('https://blog.naver.com/' + mixed + '/123', mixed).url, 'https://blog.naver.com/' + mixed + '/123');
  assert.throws(() => postIdentity('https://blog.naver.com/' + mixed.toLowerCase() + '/123', mixed));
});
test('bounded counts/text reject entire feed rather than silently truncating', async () => {
  const [{ parseFeed, LIMITS }] = await modules;
  await assert.rejects(parseFeed(feed(item('x'.repeat(LIMITS.content + 1))), BLOG));
  await assert.rejects(parseFeed(feed().replace('합성 글', 'x'.repeat(LIMITS.title + 1)), BLOG));
  await assert.rejects(parseFeed(feed(Array.from({ length: 101 }, (_, i) => item().replace('/123<', '/' + (i + 1) + '<')).join('')), BLOG));
  await assert.rejects(parseFeed(' '.repeat(LIMITS.feed + 1), BLOG));
});
test('robots longest-match, user agent, deny and malformed page boundaries', async () => {
  const [{ robotsAllowed }] = await modules;
  assert.equal(robotsAllowed('User-agent: *\nDisallow: /\nAllow: /fixture_blog.xml$', '/fixture_blog.xml'), true);
  assert.equal(robotsAllowed('User-agent: *\nAllow: /\nUser-agent: HaedoNaverCollector\nDisallow: /*.xml$', '/fixture_blog.xml'), false);
  assert.equal(robotsAllowed('User-agent: *\nDisallow: /fixture\nAllow: /fixture', '/fixture_blog.xml'), true);
  assert.throws(() => robotsAllowed('<html>error</html>', '/fixture_blog.xml'));
  assert.throws(() => robotsAllowed('User-agent: *\nCrawl-delay: 1\nAllow: /', '/fixture_blog.xml'));
  assert.equal(robotsAllowed('User-agent: *\nDisallow: /*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*b$', '/aaaaaaaaaaaaaaaaaaaaaaaaaaaa.xml'), true);
});
test('fixed two URLs only; robots block or redirect means zero feed request', async () => {
  const [{ collect }] = await modules;
  const normal = fixture(); await collect(BLOG, { fetcher: normal.fetcher });
  assert.deepEqual(normal.calls.map(v => v.url), ['https://rss.blog.naver.com/robots.txt', 'https://rss.blog.naver.com/' + BLOG + '.xml']);
  for (const call of normal.calls) { assert.equal(call.options.redirect, 'error'); assert.ok(call.options.signal instanceof AbortSignal); }
  const blocked = fixture({ robots: 'User-agent: *\nDisallow: /' }); await assert.rejects(collect(BLOG, { fetcher: blocked.fetcher }), { code: 'blocked' });
  assert.equal(blocked.calls.length, 1);
  let redirects = 0;
  await assert.rejects(collect(BLOG, { fetcher: async () => { redirects++; return new Response('', { status: 302, headers: { Location: 'https://evil.invalid' } }); } }));
  assert.equal(redirects, 1);
});
test('stream bounds, Content-Length truncation, UTF-8 and transport failures reject', async () => {
  const [{ readBounded }] = await modules;
  await assert.rejects(readBounded(new Response('valid', { headers: { 'Content-Length': '100' } }), 100), { code: 'incomplete_response' });
  await assert.rejects(readBounded(new Response('x'.repeat(10)), 9), { code: 'feed_too_large' });
  await assert.rejects(readBounded(new Response('x', { headers: { 'Content-Encoding': 'gzip' } }), 9));
  await assert.rejects(readBounded(new Response(new Uint8Array([255])), 9), { code: 'invalid_feed' });
  await assert.rejects(readBounded(new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.error(new Error('incomplete')); } })), 9));
});
test('manual getUser auth then env+DB dual gate: no Naver request or claim while unready', async () => {
  const [, { createHandler }] = await modules;
  for (const options of [{ env: { HAEDO_NAVER_INGESTION_ENABLED: 'false' } }, { env: { HAEDO_NAVER_INGESTION_ENABLED: undefined } }, { ready: false }]) {
    const f = fixture(options), result = await createHandler({ fetcher: f.fetcher, environment: key => f.env[key] })(f.request());
    assert.deepEqual(await result.json(), { error: 'setup_required' });
    assert.equal(f.calls[0].url, 'https://fixture.supabase.co/auth/v1/user');
    assert.equal(f.calls.some(v => v.url.includes('rss.blog.naver.com') || v.url.endsWith('life_naver_claim')), false);
  }
  const bad = fixture({ authStatus: 401 }); const denied = await createHandler({ fetcher: bad.fetcher, environment: key => bad.env[key] })(bad.request());
  assert.equal(denied.status, 401); assert.equal(bad.calls.length, 1);
});
test('cron requires exact secret, publishable/forged role cannot claim or fetch', async () => {
  const [, { createHandler, secretEqual }] = await modules;
  assert.equal(secretEqual('', ''), false); assert.equal(secretEqual('abc', 'abd'), false); assert.equal(secretEqual('abc', 'abc'), true);
  for (const token of ['public-fixture', 'ey.fake.service_role', 'server-secret-fixtureX']) {
    const f = fixture(); const result = await createHandler({ fetcher: f.fetcher, environment: key => f.env[key] })(f.request({ action: 'cron' }, token));
    assert.equal(result.status, 401); assert.equal(f.calls.length, 0);
  }
  const misconfigured = fixture({ env: { SUPABASE_SERVICE_ROLE_KEY: 'public-fixture' } });
  const misconfiguredResponse = await createHandler({ fetcher: misconfigured.fetcher, environment: key => misconfigured.env[key] })(misconfigured.request({ action: 'cron' }, 'public-fixture'));
  assert.equal((await misconfiguredResponse.json()).error, 'setup_required'); assert.equal(misconfigured.calls.length, 0);
  const f = fixture({ claims: [] }); const result = await createHandler({ fetcher: f.fetcher, environment: key => f.env[key] })(f.request({ action: 'cron' }, f.env.SUPABASE_SERVICE_ROLE_KEY));
  assert.equal((await result.json()).checked, 0); assert.equal(f.calls.some(v => v.url.endsWith('/auth/v1/user')), false);
  assert.deepEqual(JSON.parse(f.calls.find(v => v.url.endsWith('/life_naver_claim')).options.body),
    { p_limit: 2, p_subscription_id: null, p_owner_id: null });
});
test('verified owner pins manual lease; foreign or malformed batch never fetches or finishes', async () => {
  const [, { createHandler }] = await modules;
  for (const claim of [{ owner_id: ids.other }, { subscription_id: ids.other }, { blog_id: '../private' }, { lease_until: '2000-01-01T00:00:00Z' }]) {
    const f = fixture({ claim }); const result = await createHandler({ fetcher: f.fetcher, environment: key => f.env[key] })(f.request());
    assert.equal(result.status, 502); assert.equal(f.calls.some(v => v.url.includes('rss.blog.naver.com')), false); assert.equal(f.finishes.length, 0);
  }
});
test('successful manual finish has only seven safe fields and DB-fenced identity', async () => {
  const [, { createHandler }] = await modules; const f = fixture();
  const result = await createHandler({ fetcher: f.fetcher, environment: key => f.env[key] })(f.request());
  assert.deepEqual(await result.json(), { status: 'checked' });
  const args = JSON.parse(f.calls.find(v => v.url.endsWith('life_naver_claim')).options.body);
  assert.deepEqual(args, { p_limit: 1, p_subscription_id: ids.subscription, p_owner_id: ids.user });
  const finish = f.finishes[0]; assert.equal(finish.p_error, null); assert.equal(finish.p_revision, 7); assert.equal(finish.p_lease_token, ids.lease);
  assert.equal(finish.p_items[0].coverage, 'partial'); assert.equal(JSON.stringify(finish).includes('<p>'), false);
  assert.equal(f.calls.some(v => /storage|public|publish/.test(new URL(v.url).pathname)), false);
});
test('blank/error/truncated feeds finish only sanitized error, preserving prior bodies', async () => {
  const [, { createHandler }] = await modules;
  for (const options of [{ feed: feed('') }, { throwFeed: true }, { feedResponse: () => new Response(feed(), { headers: { 'Content-Length': String(Buffer.byteLength(feed()) + 9) } }) }]) {
    const f = fixture(options); const result = await createHandler({ fetcher: f.fetcher, environment: key => f.env[key] })(f.request());
    assert.deepEqual(await result.json(), { error: 'collection_failed' }); assert.deepEqual(f.prior, ['existing-body']);
    assert.deepEqual(f.finishes[0].p_items, []); assert.match(f.finishes[0].p_error, /^[a-z_]{1,80}$/);
    assert.equal(JSON.stringify(f.finishes).includes('private-upstream'), false);
  }
});
test('stale finish never reports successful collected state', async () => {
  const [, { createHandler }] = await modules; const f = fixture({ finishStatus: 'stale' });
  const result = await createHandler({ fetcher: f.fetcher, environment: key => f.env[key] })(f.request());
  assert.deepEqual(await result.json(), { status: 'busy' });
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const { load } = createRequire(path.join(__dirname, 'fixtures/naver-extractor/package.json'))('cheerio/slim');
const moduleReady = import('../scripts/check-naver-live-readiness.mjs');
const NOW = Date.parse('2026-10-29T03:30:00Z'), BLOG = 'Synthetic_public_probe';
const coreHosts = ['blog.naver.com', 'rss.blog.naver.com'];
function policies(hosts = coreHosts) { return { snapshot: { version: 1, http_network_policy: { type: 'restricted', egress_rules: hosts.map(host => ({ host })) } }, observation: { observations_current: true, observed_at: new Date(NOW).toISOString(), spec_revision: '1', observed_spec_revision: '1', network_policy: { state: 'enforced', mode: 'restricted', effective_allowed_hosts: hosts } } }; }
function fixture(options = {}) {
  const calls = [];
  const fetcher = async (raw, init) => {
    calls.push({ url: raw, init }); const url = new URL(raw);
    assert.equal(init.redirect, 'error'); assert.equal(init.method || 'GET', 'GET');
    assert(!new Headers(init.headers).has('authorization')); assert(!new Headers(init.headers).has('apikey')); assert.equal(init.body, undefined);
    if (options.throwNetwork) throw Error('Do not emit a private upstream body, title, URL or token');
    if (url.pathname === '/robots.txt') return new Response(options.blockRobots ? 'User-agent: *\nDisallow: /' : 'User-agent: *\nAllow: /');
    if (url.hostname === 'rss.blog.naver.com') return new Response('<rss version="2.0"><channel><item><title>Private fixture title</title><link>https://blog.naver.com/' + BLOG + '/123</link><description><![CDATA[private fixture text]]></description></item></channel></rss>');
    if (url.pathname === '/PostTitleListAsync.naver') return Response.json(options.inventory || { totalCount: '1', countPerPage: '30', postList: [{ logNo: '123', title: 'Private+fixture+title' }] });
    if (url.pathname === '/PostView.naver') return new Response('<h1 class="se-title-text">Private fixture title</h1><div class="se-main-container"><p>private fixture text 🌱</p><img src="https://blogfiles.pstatic.net/first.png"><img src="https://postfiles.pstatic.net/second.png"></div>');
    if (url.hostname.endsWith('.pstatic.net')) { const bytes = new Uint8Array(45), view = new DataView(bytes.buffer); bytes.set([137,80,78,71,13,10,26,10]); view.setUint32(8, 13); bytes.set(new TextEncoder().encode('IHDR'), 12); view.setUint32(16, 64); view.setUint32(20, 48); bytes.set(new TextEncoder().encode('IEND'), 37); return new Response(bytes, { headers: { 'content-type': 'image/png' } }); }
    throw Error('Unexpected public test URL');
  };
  return { calls, fetcher };
}
test('default diagnostics never fetch, load a parser, or emit target IDs', async () => {
  const { probeNaver } = await moduleReady; let calls = 0;
  const report = await probeNaver({ blogId: BLOG, postNo: '123', snapshot: policies().snapshot, fetcher: () => { calls++; throw Error('No default networking'); } });
  assert.equal(calls, 0); assert.equal(report.mode, 'diagnostic'); assert.equal(report.status, 'planned'); assert.deepEqual(report.requests, []); assert(!JSON.stringify(report).includes(BLOG));
});
test('missing, stale, unenforced, mismatched or incomplete policy blocks every request', async () => {
  const { probeNaver } = await moduleReady;
  for (const mutate of [value => { delete value.observation; }, value => { value.observation.observations_current = false; }, value => { value.observation.network_policy.state = 'pending'; }, value => { value.observation.observed_at = new Date(NOW - 300001).toISOString(); }, value => { value.observation.observed_spec_revision = '0'; }, value => { value.snapshot.http_network_policy.egress_rules.pop(); }, value => { value.observation.network_policy.effective_allowed_hosts = []; }]) {
    const policy = policies(); mutate(policy); const f = fixture();
    const report = await probeNaver({ blogId: BLOG, probe: true, ...policy, now: NOW, fetcher: f.fetcher, load });
    assert.equal(report.status, 'blocked'); assert.equal(f.calls.length, 0); assert.equal(report.requests.length, 0);
  }
});
test('robots disallow stops before fetching RSS, body, inventory or images', async () => {
  const { probeNaver } = await moduleReady, f = fixture({ blockRobots: true });
  const report = await probeNaver({ blogId: BLOG, probe: true, ...policies(), now: NOW, fetcher: f.fetcher, load });
  assert.equal(report.status, 'blocked'); assert.equal(report.code, 'blocked'); assert.equal(f.calls.length, 1); assert.equal(new URL(f.calls[0].url).pathname, '/robots.txt');
});
test('bounded public metadata reuses collector and extractor, selects first listed post and enumerates CDNs without loading pictures', async () => {
  const { probeNaver } = await moduleReady, f = fixture();
  const report = await probeNaver({ blogId: BLOG, probe: true, ...policies(), now: NOW, fetcher: f.fetcher, load });
  assert.equal(report.status, 'checked'); assert.equal(report.postSelection, 'first_inventory_entry'); assert.equal(report.feed.entries, 1); assert.equal(report.inventory.entries, 1); assert.equal(report.post.coverage, 'partial'); assert.equal(report.post.photos, 2);
  assert.deepEqual(report.post.photoHosts.map(value => value.host), ['blogfiles.pstatic.net', 'postfiles.pstatic.net']);
  assert(f.calls.every(value => coreHosts.includes(new URL(value.url).hostname))); assert(report.requests.every(row => row.bytes > 0 && /^[a-f\d]{64}$/.test(row.sha256)));
  const serialized = JSON.stringify(report); for (const content of [BLOG, 'Private fixture title', 'private fixture text', '/PostView.naver', 'first.png', 'second.png']) assert(!serialized.includes(content), content + ' must not be emitted');
});
test('explicit representative post remains pinned and photo probing checks exact CDN policy before even its robots request', async () => {
  const { probeNaver } = await moduleReady, f = fixture();
  const report = await probeNaver({ blogId: BLOG, postNo: '456', probe: true, photos: 1, ...policies(), now: NOW, fetcher: f.fetcher, load });
  assert.equal(report.status, 'blocked'); assert.equal(report.blockedStage, 'photo'); assert.equal(report.code, 'required_host_not_allowed'); assert(f.calls.every(value => coreHosts.includes(new URL(value.url).hostname)));
  assert.equal(new URL(f.calls.find(value => new URL(value.url).pathname === '/PostView.naver').url).searchParams.get('logNo'), '456');
});
test('photo option checks one allowed image and host robots, records header dimensions without claiming actual decode or uploaded-original identity', async () => {
  const { probeNaver } = await moduleReady, f = fixture();
  const report = await probeNaver({ blogId: BLOG, probe: true, photos: 1, ...policies([...coreHosts, 'blogfiles.pstatic.net']), now: NOW, fetcher: f.fetcher, load });
  assert.equal(report.status, 'checked'); assert.equal(report.photo.width, 64); assert.equal(report.photo.height, 48); assert.equal(report.photo.decodeVerified, false); assert.equal(report.photo.originalStatus, 'unverified');
  const images = f.calls.filter(value => new URL(value.url).hostname.endsWith('.pstatic.net')); assert.equal(images.length, 2); assert.equal(new URL(images[0].url).pathname, '/robots.txt'); assert.equal(new URL(images[1].url).pathname, '/first.png');
});
test('upstream failure reports a bounded code and never exposes original error strings', async () => {
  const { probeNaver } = await moduleReady, f = fixture({ throwNetwork: true });
  const report = await probeNaver({ blogId: BLOG, probe: true, ...policies(), now: NOW, fetcher: f.fetcher, load });
  assert.equal(report.status, 'blocked'); assert.equal(report.code, 'request_failed'); assert(!JSON.stringify(report).includes('Do not emit'));
});
test('redirected and oversized robots responses fail before fetching target content', async () => {
  const { probeNaver } = await moduleReady;
  for (const response of [() => { const value = new Response('User-agent: *\nAllow: /'); Object.defineProperty(value, 'redirected', { value: true }); return value; }, () => new Response('small', { headers: { 'content-length': String(128 * 1024 + 1) } })]) {
    let calls = 0;
    const report = await probeNaver({ blogId: BLOG, probe: true, ...policies(), now: NOW, load, fetcher: async () => { calls++; return response(); } });
    assert.equal(report.status, 'blocked'); assert.equal(calls, 1); assert.equal(report.requests.length, 1); assert.equal(report.feed, undefined);
  }
});
test('CLI parser accepts only deliberate probe, target, representative and single-photo options', async () => {
  const { parseArguments, probeNaver } = await moduleReady;
  assert.deepEqual(parseArguments(['--blog', BLOG, '--probe', '--photos', '1', '--post', '123', '--policy-status', '.local/observation.json']), { probe: true, photos: 1, blogId: BLOG, postNo: '123', policyStatus: '.local/observation.json' });
  for (const args of [['--probe', '--probe'], ['--photos', '20'], ['--blog'], ['--url', 'https://arbitrary.invalid'], ['--headers', 'secret']]) assert.throws(() => parseArguments(args), /invalid_arguments/);
  const report = await probeNaver({ probe: true, ...policies(), now: NOW }); assert.equal(report.status, 'blocked'); assert.equal(report.code, 'blog_required'); assert.deepEqual(report.requests, []);
});

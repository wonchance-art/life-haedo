const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
function harness({ failInstall = false, failInstallAsset, fetchResult } = {}) {
  const handlers = {}, removed = [], writes = [], entries = new Map(), requests = []; let skipped = false, claimed = false, resources, fetches = 0;
  const cache = { addAll: async urls => { resources = urls; if (failInstall || (failInstallAsset && urls.some(r => r.url.endsWith(failInstallAsset)))) throw new Error('offline'); },
    match: async key => entries.get(key), put: async (key, response) => writes.push([key, response]) };
  class WorkerRequest { constructor(input, options) { this.url = typeof input === 'string' ? new URL(input, 'https://test.invalid/life-haedo/').href : input.url; Object.assign(this, options); } }
  const context = { URL, Request: WorkerRequest, Response,
    self: { registration: { scope: 'https://test.invalid/life-haedo/' }, location: { origin: 'https://test.invalid' },
      addEventListener: (type, fn) => handlers[type] = fn,
      skipWaiting: async () => skipped = true, clients: { claim: async () => claimed = true } },
    caches: { open: async () => cache, keys: async () => ['haedo-v1', context.currentCache, 'unrelated-app'], delete: async name => removed.push(name) },
    fetch: async request => { fetches++; requests.push(request); if (fetchResult instanceof Error) throw fetchResult; return fetchResult || new Response('OK'); }
  };
  vm.runInNewContext(readFileSync(require.resolve('../sw.js'), 'utf8') + '\nthis.currentCache = CACHE;', context);
  async function run(type, request) {
    const waits = []; let response;
    handlers[type]({ request, waitUntil: p => waits.push(p), respondWith: p => { response = p; } });
    const result = await response; await Promise.all(waits); return result;
  }
  return { run, entries, removed, writes, requests, state: () => ({ skipped, claimed, resources, fetches }) };
}
const request = (path, mode = 'cors') => ({ url: 'https://test.invalid/life-haedo/' + path, method: 'GET', mode });
test('complete offline shell includes every runtime module', async () => {
  const h = harness(); await h.run('install');
  assert.equal(h.state().skipped, true);
  for (const name of ['assets/app.js', 'assets/data.js', 'assets/sync.js', 'assets/workspace.js', 'assets/app.css',
    'index.html', 'login.html', 'workspace.html', 'timeline.html', 'goals.html', 'habits.html', 'privacy.html',
    'assets/platform-config.js', 'assets/platform-auth.js', 'assets/platform-store.js', 'assets/platform-data.js',
    'assets/platform-ui.js', 'assets/platform.css', 'assets/platform-life-remote.js', 'assets/timeline-entry.js',
    'life.html', 'vendor/idb/idb.js', 'vendor/supabase/supabase.js', 'assets/life/core.js', 'assets/life/storage.js', 'assets/life/legacy.js',
    'assets/life/remote.js', 'assets/life/sync.js',
    'assets/life/ui.js', 'assets/life/ui.css', 'assets/life/shell.js'])
    assert.ok(h.state().resources.some(r => r.url.endsWith(name)), name);
});
test('failed installation does not activate a partial shell', async () => {
  const h = harness({ failInstall: true }); await assert.rejects(h.run('install'));
  assert.equal(h.state().skipped, false);
});
test('activation removes old app caches but preserves unrelated caches', async () => {
  const h = harness(); await h.run('activate');
  assert.deepEqual(h.removed, ['haedo-v1']); assert.equal(h.state().claimed, true);
});
test('HTTP errors never replace a usable offline asset', async () => {
  const h = harness({ fetchResult: new Response('Not found', { status: 404 }) });
  h.entries.set(request('assets/app.js').url, new Response('cached JS'));
  assert.equal(await (await h.run('fetch', request('assets/app.js'))).text(), 'cached JS');
  assert.equal(h.writes.length, 0);
});
test('a missing script never falls back to HTML', async () => {
  const h = harness({ fetchResult: new Error('offline') });
  h.entries.set(request('index.html').url, new Response('<html>cached</html>'));
  const response = await h.run('fetch', request('assets/app.js'));
  assert.equal(response.type, 'error');
  assert.equal(await h.run('fetch', request('missing.js')), undefined);
});
test('offline public home uses its exact installed document, without another-page fallback', async () => {
  const h = harness({ fetchResult: new Error('offline') });
  h.entries.set(request('index.html').url, new Response('<html>cached</html>'));
  assert.equal((await h.run('fetch', request('', 'navigate'))).type,'error');
  h.entries.set(request('').url,new Response('installed public home'));
  assert.equal(await (await h.run('fetch', request('', 'navigate'))).text(), 'installed public home');
});
test('a failed life runtime asset installation keeps the old worker active', async () => {
  const h = harness({ failInstallAsset: 'assets/life/storage.js' });
  await assert.rejects(h.run('install'));
  assert.equal(h.state().skipped, false);
  assert.equal(h.state().claimed, false);
});
test('life navigation returns its own installed HTML while offline', async () => {
  const h = harness({ fetchResult: new Error('offline') });
  h.entries.set(request('index.html').url, new Response('old timeline'));
  h.entries.set(request('life.html').url, new Response('life shell'));
  assert.equal(await (await h.run('fetch', request('life.html?view-only=1', 'navigate'))).text(), 'life shell');
  assert.equal(h.state().fetches, 0);
});
test('platform Auth and life modules use one installed bundle without online replacement', async () => {
  const h = harness({ fetchResult: new Response('different online version') });
  for (const path of ['assets/platform-auth.js', 'assets/platform-config.js', 'assets/platform-ui.js', 'assets/app.js', 'timeline.html', 'index.html', 'assets/life/core.js', 'assets/life/ui.css', 'assets/life/remote.js', 'assets/life/sync.js', 'vendor/supabase/supabase.js', 'vendor/idb/idb.js', 'vendor/daisyui.css']) {
    h.entries.set(request(path).url, new Response('installed ' + path));
    assert.equal(await (await h.run('fetch', request(path + '?v=new'))).text(), 'installed ' + path);
  }
  assert.equal(h.state().fetches, 0);
  assert.equal(h.writes.length, 0);
});
test('a missing life shell never serves the timeline HTML or a mixed online module', async () => {
  const h = harness({ fetchResult: new Response('different online version') });
  h.entries.set(request('index.html').url, new Response('timeline'));
  assert.equal((await h.run('fetch', request('life.html', 'navigate'))).type, 'error');
  assert.equal((await h.run('fetch', request('assets/life/storage.js'))).type, 'error');
  assert.equal(h.state().fetches, 0);
});
test('private requests and non-shell resources are not intercepted', async () => {
  const h = harness();
  assert.equal(await h.run('fetch', { ...request('life.html'), method: 'POST' }), undefined);
  assert.equal(await h.run('fetch', { ...request('life.html'), url: 'https://remote.invalid/private' }), undefined);
  assert.equal(await h.run('fetch', request('personal-notes.json')), undefined);
  assert.equal(await h.run('fetch', { ...request('index.html'),headers:new Headers({authorization:'Bearer anonymous-test'}) }),undefined);
  assert.equal(await h.run('fetch', { ...request('life.html'),cache:'no-store' }),undefined);
  assert.equal(await h.run('fetch', request('life.html?unknown-private-field=test')),undefined);
  assert.equal(h.writes.length, 0);
  assert.equal(h.state().fetches, 0);
});
test('OAuth callbacks never read/write cache or forward code/token/error query to static host', async () => {
  const h=harness();
  h.entries.set(request('login.html').url,new Response('cached login'));
  for(const query of ['code=anonymous-code&next=life.html','access_token=anonymous-token','error_description=anonymous-error']){
    assert.equal(await (await h.run('fetch',request('login.html?'+query,'navigate'))).text(),'OK');
    const outgoing=h.requests.at(-1);
    assert.equal(outgoing.url,request('login.html').url);
    assert.equal(outgoing.cache,'no-store');
    assert.equal(outgoing.referrerPolicy,'no-referrer');
  }
  assert.equal(h.writes.length,0);
});
test('offline OAuth callback fails closed instead of reusing a cached login response', async () => {
  const h=harness({fetchResult:new Error('offline')});
  h.entries.set(request('login.html').url,new Response('cached login'));
  assert.equal((await h.run('fetch',request('login.html?code=anonymous-code','navigate'))).type,'error');
  assert.equal(h.writes.length,0);
});
test('failed platform Auth installation cannot activate a mixed life/platform release', async () => {
  const h=harness({failInstallAsset:'assets/platform-auth.js'});
  await assert.rejects(h.run('install'));
  assert.equal(h.state().skipped,false);
});

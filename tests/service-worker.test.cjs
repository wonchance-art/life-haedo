const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
function harness({ failInstall = false, fetchResult } = {}) {
  const handlers = {}, removed = [], writes = [], entries = new Map(); let skipped = false, claimed = false, resources;
  const cache = { addAll: async urls => { resources = urls; if (failInstall) throw new Error('offline'); },
    match: async key => entries.get(key), put: async (key, response) => writes.push([key, response]) };
  class WorkerRequest { constructor(input, options) { this.url = typeof input === 'string' ? new URL(input, 'https://test.invalid/life-haedo/').href : input.url; Object.assign(this, options); } }
  const context = { URL, Request: WorkerRequest, Response,
    self: { registration: { scope: 'https://test.invalid/life-haedo/' }, location: { origin: 'https://test.invalid' },
      addEventListener: (type, fn) => handlers[type] = fn,
      skipWaiting: async () => skipped = true, clients: { claim: async () => claimed = true } },
    caches: { open: async () => cache, keys: async () => ['haedo-v1', context.currentCache, 'unrelated-app'], delete: async name => removed.push(name) },
    fetch: async () => { if (fetchResult instanceof Error) throw fetchResult; return fetchResult || new Response('OK'); }
  };
  vm.runInNewContext(readFileSync(require.resolve('../sw.js'), 'utf8') + '\nthis.currentCache = CACHE;', context);
  async function run(type, request) {
    const waits = []; let response;
    handlers[type]({ request, waitUntil: p => waits.push(p), respondWith: p => { response = p; } });
    const result = await response; await Promise.all(waits); return result;
  }
  return { run, entries, removed, writes, state: () => ({ skipped, claimed, resources }) };
}
const request = (path, mode = 'cors') => ({ url: 'https://test.invalid/life-haedo/' + path, method: 'GET', mode });
test('complete offline shell includes every runtime module', async () => {
  const h = harness(); await h.run('install');
  assert.equal(h.state().skipped, true);
  for (const name of ['assets/app.js', 'assets/data.js', 'assets/sync.js', 'assets/workspace.js', 'assets/app.css',
    'login.html', 'workspace.html', 'timeline.html', 'goals.html', 'habits.html', 'vendor/supabase.js',
    'assets/platform-auth.js', 'assets/platform-store.js', 'assets/timeline-entry.js'])
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
test('personal APIs and OAuth responses are never handled or cached by the worker', async () => {
  const h = harness();
  for (const path of ['rest/v1/haedo_documents', 'auth/v1/token', 'fixture/continue'])
    assert.equal(await h.run('fetch', request(path)), undefined);
  assert.equal(h.writes.length, 0);
});
test('offline navigation can use the cached index document', async () => {
  const h = harness({ fetchResult: new Error('offline') });
  h.entries.set(request('index.html').url, new Response('<html>cached</html>'));
  assert.equal(await (await h.run('fetch', request('', 'navigate'))).text(), '<html>cached</html>');
});

/* Actual SW update with pinned prior resources; anonymous fixtures only. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), { execFileSync } = require('node:child_process'), { createHash } = require('node:crypto');
const { playwright } = require('./unified-home-browser.cjs');
const { FakeCloud, platformContext, accounts, cloud, base } = require('./life-sync-browser.cjs');
const project = path.resolve(__dirname, '..'), out = path.join(project, '.local/blog-completion'), oldRef = '9479866';
const sha = data => createHash('sha256').update(data).digest('hex');
const mime = { '.js': 'application/javascript', '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
async function wait(page, predicate, input) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { if (await page.evaluate(predicate, input)) return; await new Promise(done => setTimeout(done, 80)); }
  throw Error('Service worker lifecycle did not settle');
}
async function main() {
  const oldFiles = new Map();
  const oldFile = name => { if (!oldFiles.has(name)) oldFiles.set(name, execFileSync('git', ['show', oldRef + ':' + name], { cwd: project, maxBuffer: 16 * 1024 * 1024, stdio: 'pipe' })); return oldFiles.get(name); };
  const oldSw = oldFile('sw.js'), newSw = await fs.readFile(path.join(project, 'sw.js'));
  try { assert.deepEqual(await fs.readFile(path.join(out, 'sw-before.js')), oldSw, 'Preserved fixture must equal the actual previous release.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const cacheName = source => source.toString().match(/const CACHE\s*=\s*['"]([^'"]+)/)[1], oldName = cacheName(oldSw), newName = cacheName(newSw);
  assert.equal(oldName, 'haedo-v119'); assert.notEqual(newName, oldName);
  const report = { oldCache: oldName, newCache: newName, checks: [], errors: [], consoleErrors: [], expectedTransportErrors: [], scope: 'Real Chromium/SW and IndexedDB, synthetic Auth and public RPC. No production, Apple device or deployment proof.' };
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); const contexts = [], server = new FakeCloud(); let old = true, offline = false;
  async function context(device, seed) {
    const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 820, height: 1000 } }); contexts.push(context);
    await platformContext(context, server, device, seed);
    await context.addInitScript(() => { window.__releaseDbOpens = []; const open = IDBFactory.prototype.open; IDBFactory.prototype.open = function (...args) { __releaseDbOpens.push(args[0]); return open.apply(this, args); }; });
    await context.route(base + '/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/assets/platform-config.js') return route.fallback();
      if (offline) return route.abort('internetdisconnected');
      const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      if (name.split('/').includes('..')) return route.fulfill({ status: 404, body: '' });
      try {
        const bytes = name === 'sw.js' ? (old ? oldSw : newSw) : old ? oldFile(name) : await fs.readFile(path.join(project, name));
        return route.fulfill({ status: 200, headers: { 'content-type': mime[path.extname(name)] || 'application/octet-stream', 'cache-control': 'no-store', 'service-worker-allowed': '/' }, body: bytes });
      } catch (_) { return route.fulfill({ status: 404, body: '' }); }
    });
    return context;
  }
  const observe = page => {
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() !== 'error') return; if (offline && /^Failed to load resource:/.test(message.text())) report.expectedTransportErrors.push(message.text()); else report.consoleErrors.push(message.text()); });
  };
  const ready = async page => { await page.waitForFunction(() => globalThis.HaedoLife?.Shell?.storage && !document.querySelector('#lifeApp').hidden); await page.evaluate(() => HaedoLife.Shell.ready); };
  const check = async (name, action) => { await action(); report.checks.push(name); console.log('PASS ' + name); };
  try {
    const privateContext = await context('blog-release', accounts.a), page = await privateContext.newPage(); page.setDefaultTimeout(45000); observe(page);
    await page.goto(base + '/index.html'); await ready(page);
    await check('actual v119 installs before a synthetic private original photo post is saved', async () => {
      await wait(page, async name => { const registration = await navigator.serviceWorker.getRegistration(); return !!navigator.serviceWorker.controller && registration?.active?.state === 'activated' && (await caches.keys()).includes(name); }, oldName);
    });
    const previous = await page.evaluate(async () => {
      const storage = HaedoLife.Shell.storage, core = HaedoLife.Core, model = HaedoLife.PhotoPost, ws = await storage.getActive();
      const binary = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='), blob = new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], { type: 'image/png' });
      const doc = model.create(core.id), photo = { id: core.id(), name: '익명 원본.png', type: blob.type, width: 1, height: 1, size: blob.size, digest: await model.digest(blob), blob };
      doc.title = '갱신 뒤 다시 읽을 여행 글'; doc.status = 'saved'; doc.photos = [photo]; doc.ops = [{ insert: '원래 한글 문장 🌿\n' }, { insert: { photo: { id: photo.id, caption: '사진 설명 보존', alt: '익명 사진' } } }, { insert: '\n' }];
      const saved = await storage.savePhotoPost(ws, doc, 0);
      return { workspaceId: ws, postId: saved.id, manifest: { ...saved, photos: saved.photos.map(({ blob, ...metadata }) => metadata) }, digest: photo.digest, bundle: await storage.read(ws) };
    });
    await check('v119 updates to the complete new release without deleting local originals', async () => {
      old = false; await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
      await wait(page, async names => { const keys = await caches.keys(), r = await navigator.serviceWorker.getRegistration(); return keys.includes(names.newName) && !keys.includes(names.oldName) && r?.active?.state === 'activated' && navigator.serviceWorker.controller === r.active; }, { newName, oldName });
      await page.reload(); await ready(page);
      const after = await page.evaluate(async previous => { const s = HaedoLife.Shell.storage, post = await s.readPhotoPost(previous.workspaceId, previous.postId); return { manifest: { ...post, photos: post.photos.map(({ blob, ...metadata }) => metadata) }, digest: await HaedoLife.PhotoPost.digest(post.photos[0].blob), bundle: await s.read(previous.workspaceId) }; }, previous);
      assert.deepEqual(after, { manifest: previous.manifest, digest: previous.digest, bundle: previous.bundle });
      const modules = ['assets/life/blog.js', 'assets/life/blog-remote.js', 'assets/life/blog-sync.js', 'assets/life/blog-manager.js', 'assets/life/blog-public.js', 'assets/life/blog-public-ui.js', 'assets/life/source-reference.js', 'assets/life/blog-evidence.js', 'assets/life/storage.js', 'assets/life/ui.js'];
      const installed = await page.evaluate(async ({ name, modules }) => { const cache = await caches.open(name); return Promise.all(modules.map(async file => { const response = await cache.match(new URL(file, location.href)); return { file, digest: response ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer())), n => n.toString(16).padStart(2, '0')).join('') : null }; })); }, { name: newName, modules });
      assert.deepEqual(installed, await Promise.all(modules.map(async file => ({ file, digest: sha(await fs.readFile(path.join(project, file))) })))); report.installedModules = modules.length;
    });
    await check('warm offline session reopens the saved local photo post and obtains new modules from SW cache', async () => {
      offline = true; server.offline.add('blog-release'); await privateContext.setOffline(true);
      try {
        const entry = page.locator('#homePosts [data-photo-post-id="' + previous.postId + '"] .home-post-open'); await entry.click(); await page.locator('.photo-article').waitFor();
        assert.match(await page.locator('.photo-article').innerText(), /원래 한글 문장/);
        const digest = await page.evaluate(async previous => { const post = await HaedoLife.Shell.storage.readPhotoPost(previous.workspaceId, previous.postId); return HaedoLife.PhotoPost.digest(post.photos[0].blob); }, previous); assert.equal(digest, previous.digest);
        const fetched = await page.evaluate(async () => { const response = await fetch('assets/life/blog-sync.js'); return response.ok && (await response.text()).includes('BlogSync'); }); assert.equal(fetched, true);
      } finally { offline = false; server.offline.delete('blog-release'); await privateContext.setOffline(false); }
    });
    await check('anonymous public reading opens no personal IDB and never caches public content, RPC or media URLs', async () => {
      const anon = await context('blog-release-public', null), publicPage = await anon.newPage(); observe(publicPage);
      const token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', blogToken = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', time = '2026-10-17T00:00:00.000Z';
      await anon.route(cloud + '/rest/v1/rpc/life_blog_public_read', route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, body: JSON.stringify({ token, blogToken, revision: 1, createdAt: time, updatedAt: time, snapshot: { format: 'life-blog-public-v1', title: '공개한 익명 글', ops: [{ insert: '공개 범위 본문\n' }], photos: [], attachments: [], author: { name: '익명', intro: '' } } }) }));
      await publicPage.goto(base + '/blog.html?post=' + token); await publicPage.getByRole('heading', { name: '공개한 익명 글', exact: true }).waitFor();
      await publicPage.evaluate(() => navigator.serviceWorker.register('sw.js')); await wait(publicPage, async name => (await caches.keys()).includes(name) && !!navigator.serviceWorker.controller, newName);
      assert.deepEqual(await publicPage.evaluate(() => __releaseDbOpens), []); assert.equal(await publicPage.evaluate(() => !!globalThis.HaedoAuth || !!globalThis.HaedoLife?.Shell), false);
      const keys = await publicPage.evaluate(async () => { const urls = []; for (const name of await caches.keys()) for (const item of await (await caches.open(name)).keys()) urls.push(item.url); return urls; });
      assert(keys.length > 20); assert(keys.every(value => new URL(value).origin === new URL(base).origin && !new URL(value).search));
      assert(!keys.some(value => /rest\/v1|storage\/v1|functions\/v1|[?&](post|blog|token)=/.test(value))); report.publicCachedAssets = keys.length;
    });
    assert.deepEqual(report.errors, []); assert.deepEqual(report.consoleErrors, []); report.pass = true;
  } finally {
    await fs.mkdir(out, { recursive: true }); await fs.writeFile(path.join(out, 'release-report.json'), JSON.stringify(report, null, 2));
    await Promise.all(contexts.map(context => context.close())); await browser.close();
  }
  console.log('Blog release: ' + report.checks.length + ' passed; real ' + oldName + ' → ' + newName + ' SW lifecycle.');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

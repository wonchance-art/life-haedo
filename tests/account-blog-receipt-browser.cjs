/* Actual SDK + account-scoped IndexedDB boundaries of automatic account post
 * receipt (2026-11-01: every post reaches every device without a button).
 * Auth and private blog HTTP are strict synthetic fixtures; no hosted SQL/RLS or Apple claim. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4262';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, session, base, cloud } = require('./life-sync-browser.cjs');
const output = path.resolve('.local/account-blog-receipt'), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function entered(gate) {
  let timer;
  try { await Promise.race([gate.entered.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Expected synthetic original download did not start')), 20000); })]); }
  finally { clearTimeout(timer); }
}
class ReceiptCloud extends FakeCloud {
  constructor() { super(); this.downloadGate = null; }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url()), gate = this.downloadGate;
    if (gate && device === gate.device && request.method() === 'GET' && url.pathname.startsWith('/storage/v1/object/')) {
      this.downloadGate = null; gate.entered.resolve(); await gate.release.promise;
    }
    try { return await super.handle(route, device); }
    catch (error) { if (!/closed|disposed|handled|Target page/i.test(error.message)) throw error; }
  }
}
async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  await fs.mkdir(output, { recursive: true });
  const report = { checks: [], visual: [], pageErrors: [], consoleErrors: [], external: [],
    scope: 'Actual bundled SDK, image decoding and account-scoped IndexedDB. Synthetic Auth/CAS/original Storage HTTP only; no live account, hosted SQL/RLS, native IME or Apple hardware.' };
  report.sources = await Promise.all(['assets/platform-auth.js','assets/life/ui.js','assets/life/storage.js','assets/life/blog-sync.js','assets/life/account-blog-ui.js','assets/life/photo-post-ui.js'].map(async file => {
    const response = await fetch(base + '/' + file); assert(response.ok); const served = Buffer.from(await response.arrayBuffer()), disk = await fs.readFile(file);
    assert.equal(sha(served), sha(disk), 'Serve this exact checkout: ' + file); return { file, sha256: sha(disk) };
  }));
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); report.node = process.version;
  let active, number = 0;
  // The application's own background sync runs freely on the sender. On the
  // receiver it is parked behind its cross-tab lock so each check drives the
  // same BlogSync code deterministically through a lock-free test instance.
  async function device(server, name, account = accounts.a, existing = null, { parked = false } = {}) {
    const context = existing || await makeContext(browser, server, name, account, { viewport: { width: 1440, height: 1000 } });
    if (!existing) {
      await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin) || ['blob:', 'data:'].includes(u.protocol)) return route.fallback(); report.external.push(u.origin); return route.abort(); });
      if (parked) await context.addInitScript(() => {
        const request = LockManager.prototype.request;
        LockManager.prototype.request = function (name, ...rest) { if (String(name).startsWith('haedo-blog-sync:')) return Promise.resolve(rest.at(-1)(null)); return request.call(this, name, ...rest); };
      });
    }
    const page = await context.newPage(); page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
    page.on('console', event => { if (event.type() === 'error' && !(server.expectedFailures && /Failed to load resource/.test(event.text()))) report.consoleErrors.push({ name, message: event.text() }); });
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await ready(page);
    await page.evaluate(() => { window.__receiptStorage = HaedoLife.Shell.storage; window.__receiptSync = HaedoLife.BlogSync.create({ storage: __receiptStorage, auth: HaedoAuth, locks: null }); });
    return { page, context, name };
  }
  async function fixture() {
    const server = new ReceiptCloud(), name = 'receipt-' + number++, sender = await device(server, name + '-sender');
    const original = await sender.page.evaluate(async () => {
      const L = HaedoLife, s = __receiptStorage, ws = await s.getActive(), P = L.PhotoPost, photos = [];
      for (const [width, height, type, color] of [[4032,3024,'image/png','#345f42'],[1200,1800,'image/jpeg','#886b39']]) {
        const c = document.createElement('canvas'); c.width = width; c.height = height; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0,0,width,height);
        const blob = await new Promise(resolve => c.toBlob(resolve, type));
        photos.push(await P.readPhoto(new File([blob], type === 'image/png' ? 'exact-original.png' : 'exact-original.jpg', { type }), L.Core.id));
      }
      photos.splice(1, 0, { ...photos[0], id: L.Core.id(), name: 'same-bytes-another-photo.png' });
      const d = P.create(L.Core.id); Object.assign(d, { title: '두 기기의 정확한 여행 글', status: 'saved', photos,
        attachments: [{ type: 'book', title: '명시한 책', creator: '익명', url: 'https://example.org/book' }],
        ops: [{ insert: '한글과 emoji 🌱\n기억한 본문\n' }, ...photos.flatMap((photo, i) => [{ insert: { photo: { id: photo.id, caption: '서로 다른 설명 ' + i, alt: '원본 색면 ' + i } } }, { insert: '\n' }])] });
      const saved = await s.savePhotoPost(ws, d, 0); await __receiptSync.saveDefault(ws, saved.id, { expectedLocalRevision: saved.revision });
      return { workspaceId: ws, id: saved.id, format: saved.format, ops: saved.ops, attachments: saved.attachments,
        photos: saved.photos.map(({ blob, ...photo }) => photo), state: await __receiptSync.getState(ws, saved.id) };
    });
    assert.equal(original.state.status, 'synced'); await sender.context.close();
    const target = await device(server, name + '-receiver', accounts.a, null, { parked: true });
    const seed = await target.page.evaluate(async () => {
      const s = __receiptStorage, ws = await s.getActive(), d = HaedoLife.PhotoPost.create(HaedoLife.Core.id); d.title = '보존할 미완성 입력'; d.ops = [{ insert: 'PRIVATE_DRAFT_UNCHANGED\n' }];
      const saved = await s.savePhotoPost(ws, d, 0); return { workspaceId: ws, draftId: saved.id };
    });
    const f = { ...target, server, original, seed, contexts: [target.context], gates: [] }; active = f; return f;
  }
  async function call(page, method, args = []) {
    // Playwright serializes Error name/message/stack but omits custom codes.
    const result = await page.evaluate(async ({ method, args }) => {
      try { return { ok: true, value: await __receiptSync[method](...args) }; }
      catch (error) { return { ok: false, error: { code: error.code, message: error.message } }; }
    }, { method, args });
    if (!result.ok) throw Object.assign(Error(result.error.message), { code: result.error.code });
    return result.value;
  }
  const sync = (f, page = f.page, options = {}) => call(page, 'syncNow', [options]);
  // The receiver's own private draft may sync during a check; it is compared
  // separately, so its binding is not part of the receipt audit.
  async function audit(page, workspaceId, exclude = active?.seed?.draftId || null) {
    return page.evaluate(async ({ ws, exclude }) => {
      const s = __receiptStorage, rows = await s.listPhotoPosts(ws), docs = [];
      for (const row of rows) { const d = await s.readPhotoPost(ws, row.id); docs.push({ ...d, photos: await Promise.all(d.photos.map(async ({ blob, ...p }) => ({ ...p, actual: await HaedoLife.PhotoPost.digest(blob) }))) }); }
      const states = await s.listBlogSyncStates(ws);
      return { docs, rows, bindings: states.states.filter(item => item.localPostId !== exclude).map(item => ({ localPostId: item.localPostId, remoteId: item.state.remoteId, remoteRevision: item.state.remoteRevision })), bundle: await s.read(ws) };
    }, { ws: workspaceId, exclude });
  }
  async function photoProof(page, ws, id) {
    return page.evaluate(async ({ ws, id }) => { const d = await __receiptStorage.readPhotoPost(ws,id); return Promise.all(d.photos.map(async p => { const image = await createImageBitmap(p.blob), c = document.createElement('canvas'); c.width = image.width; c.height = image.height; const g = c.getContext('2d'); g.drawImage(image,0,0); const pixel = [...g.getImageData(0,0,1,1).data]; image.close(); return { id: p.id, digest: await HaedoLife.PhotoPost.digest(p.blob), width: c.width, height: c.height, pixel }; })); }, { ws, id });
  }
  // The receiver never re-sends the received post or publishes; it may only
  // store its own private draft.
  function receiverBoundary(f) {
    const calls = f.server.blogCalls.filter(c => c.device.startsWith(f.name));
    assert(calls.every(c => ['life_blog_sync_list','life_blog_read','life_blog_prepare_asset','life_blog_save'].includes(c.rpc)), 'Receiving must not publish or delete');
    assert(calls.filter(c => ['life_blog_save','life_blog_prepare_asset'].includes(c.rpc)).every(c => c.body.p_post_id === f.seed.draftId), 'The received post is never sent back');
    assert(f.server.assetCalls.filter(c => c.device.startsWith(f.name) && c.method !== 'GET').every(c => c.key.includes('/' + f.seed.draftId + '/')));
    assert.equal(f.server.writes().length, 0);
  }
  async function check(name, run) {
    if (process.env.ACCOUNT_BLOG_RECEIPT_MATCH && !new RegExp(process.env.ACCOUNT_BLOG_RECEIPT_MATCH).test(name)) return;
    console.log('START ' + name); const f = await fixture();
    try { await run(f); receiverBoundary(f); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.failure = { name, message: error.message, stack: error.stack }; await f.page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error; }
    finally { for (const gate of f.gates) gate.release.resolve(); for (const context of new Set(f.contexts)) await context.close(); active = null; }
  }
  const downloads = f => f.server.assetCalls.filter(c => c.method === 'GET' && c.device.startsWith(f.name)).length;
  try {
    await check('Repeated cycles and two tabs install one exact post in place; the overview opens it without another download', async f => {
      const baseline = await audit(f.page, f.seed.workspaceId);
      const tab = await device(f.server, f.name, accounts.a, f.context);
      await Promise.all([sync(f), sync(f, tab.page)]);
      const current = await audit(f.page, f.seed.workspaceId);
      assert.equal(current.docs.length, baseline.docs.length + 1);
      const received = current.docs.find(d => d.id === f.original.id); assert(received, 'received post keeps the server identity');
      assert.deepEqual(received.photos.map(p => p.actual), f.original.photos.map(p => p.digest)); assert.deepEqual(received.attachments, f.original.attachments);
      assert.equal(current.bindings.filter(b => b.remoteId === f.original.id).length, 1);
      assert.deepEqual(current.docs.find(d => d.id === f.seed.draftId), baseline.docs.find(d => d.id === f.seed.draftId), 'private draft input is untouched');
      const count = downloads(f); await sync(f); await sync(f, tab.page);
      assert.equal(downloads(f), count, 'Repeated cycles never download or install again'); assert.deepEqual(await audit(f.page, f.seed.workspaceId), current);
      await f.page.evaluate(async ws => {
        const host = document.createElement('section'); host.id = 'receiptAccountHost'; document.querySelector('#lifeApp').append(host);
        window.__receiptOpenCalls = [];
        window.__receiptUI = HaedoLife.AccountBlogUI.create({ storage: __receiptStorage, workspaceId: ws, blogSync: __receiptSync, isCurrent: () => true,
          async onOpenPost(id, options) { __receiptOpenCalls.push({ id, options }); if (__receiptOpenCalls.length === 1) throw Error('Synthetic display failure after automatic receipt'); } });
        await __receiptUI.mount(host);
      }, f.seed.workspaceId);
      const row = f.page.locator('#receiptAccountHost .ab-post[data-remote-id="' + f.original.id + '"]');
      await row.locator('button[data-action="open"]').waitFor();
      assert.equal(await f.page.locator('#receiptAccountHost button[data-action="receive"]').count(), 0, 'no per-device receive choice remains');
      assert.match(await row.innerText(), /계정에 올림/);
      await row.locator('button[data-action="open"]').click();
      const error = f.page.locator('#receiptAccountHost #accountBlogError'); await error.waitFor(); assert.match(await error.innerText(), /Synthetic display failure/);
      await f.page.setViewportSize({ width: 390, height: 844 });
      await f.page.locator('#receiptAccountHost').screenshot({ path: path.join(output, 'received-open-failed-390.png') });
      report.visual.push({ scene: 'received-post-display-failure', width: 390, file: 'received-open-failed-390.png' });
      await f.page.setViewportSize({ width: 1440, height: 1000 });
      await row.locator('button[data-action="open"]').click();
      assert.deepEqual(await f.page.evaluate(() => __receiptOpenCalls.map(v => v.id)), [f.original.id, f.original.id]);
      assert.equal(downloads(f), count, 'Retrying a display failure must not download/install again');
      await f.page.reload({ waitUntil: 'domcontentloaded' }); await ready(f.page);
      await f.page.evaluate(() => { window.__receiptStorage = HaedoLife.Shell.storage; window.__receiptSync = HaedoLife.BlogSync.create({ storage: __receiptStorage, auth: HaedoAuth, locks: null }); });
      await sync(f); assert.deepEqual(await audit(f.page, f.seed.workspaceId), current);
    });
    await check('Aborting the final binding write rolls back the post, its index and binding; the next cycle installs one copy', async f => {
      const before = await audit(f.page, f.seed.workspaceId);
      await f.page.evaluate(() => { window.__receiptPut = IDBObjectStore.prototype.put; window.__receiptAborts = 0; IDBObjectStore.prototype.put = function (...args) { const request = __receiptPut.apply(this, args); if (this.name === 'meta' && args[0]?.key?.startsWith('blog-sync:') && !__receiptAborts) { __receiptAborts++; this.transaction.abort(); } return request; }; });
      const status = await sync(f); assert.equal(status.state, 'error');
      assert.equal(await f.page.evaluate(() => __receiptAborts), 1); assert.deepEqual(await audit(f.page, f.seed.workspaceId), before);
      await f.page.evaluate(() => IDBObjectStore.prototype.put = __receiptPut);
      await sync(f, f.page, { force: true }); const after = await audit(f.page, f.seed.workspaceId);
      assert.equal(after.docs.length, before.docs.length + 1); assert.equal(after.bindings.filter(b => b.remoteId === f.original.id).length, 1);
      await sync(f); assert.deepEqual(await audit(f.page, f.seed.workspaceId), after);
    });
    await check('A newer server head during a held download is applied in place by the next cycle', async f => {
      const gate = { device: f.name, entered: deferred(), release: deferred() }; f.gates.push(gate); f.server.downloadGate = gate;
      const pending = sync(f); await entered(gate);
      const row = f.server.posts.get(accounts.a.id + ':' + f.original.id); row.revision++; row.data = { ...row.data, title: '받는 동안 다른 기기에서 바뀐 글', updatedAt: new Date(Date.parse(row.data.updatedAt) + 1000).toISOString() };
      gate.release.resolve(); await pending;
      let current = await audit(f.page, f.seed.workspaceId);
      assert.equal(current.docs.find(d => d.id === f.original.id).title, '두 기기의 정확한 여행 글', 'the exact revision read before the download is installed');
      await sync(f); current = await audit(f.page, f.seed.workspaceId);
      const updated = current.docs.find(d => d.id === f.original.id);
      assert.equal(updated.title, '받는 동안 다른 기기에서 바뀐 글'); assert.equal(current.docs.filter(d => d.status === 'saved').length, 1);
      assert.equal(current.bindings.find(b => b.remoteId === f.original.id).remoteRevision, row.revision);
    });
    await check('Corrupt bytes and an account change install nothing; a valid receipt preserves 4032px pixels, duplicate-photo identity and private drafts', async f => {
      const baseline = await audit(f.page, f.seed.workspaceId), [key, original] = [...f.server.originals.entries()][0];
      f.server.originals.set(key, { ...original, bytes: Buffer.from('not the original image') });
      assert.equal((await sync(f)).state, 'error'); assert.deepEqual(await audit(f.page, f.seed.workspaceId), baseline);
      f.server.originals.set(key, original);
      await sync(f, f.page, { force: true });
      const proof = await photoProof(f.page, f.seed.workspaceId, f.original.id);
      assert.deepEqual(proof.map(p => p.digest), f.original.photos.map(p => p.digest)); assert.deepEqual(proof.map(p => [p.width, p.height]), [[4032,3024],[4032,3024],[1200,1800]]);
      assert.deepEqual(proof[0].pixel, [52,95,66,255]); assert.notEqual(proof[0].id, proof[1].id); assert.equal(proof[0].digest, proof[1].digest);
      const current = await audit(f.page, f.seed.workspaceId); assert.deepEqual(current.docs.find(d => d.id === f.seed.draftId), baseline.docs.find(d => d.id === f.seed.draftId));
      const other = await device(f.server, f.name + '-late', accounts.a, null, { parked: true }); f.contexts.push(other.context);
      const ws = await other.page.evaluate(() => __receiptStorage.getActive()), gate = { device: other.name, entered: deferred(), release: deferred() }; f.gates.push(gate); f.server.downloadGate = gate;
      await other.page.evaluate(() => { window.__oldReceiptStorage = __receiptStorage; window.__lateReceipt = __receiptSync.syncNow().then(v => ({ ok: true, state: v.state }), e => ({ ok: false, code: e.code })); });
      await entered(gate);
      await other.page.evaluate(async value => { const result = await HaedoAuth.client.auth.setSession(value); if (result.error) throw result.error; await HaedoAuth.verify(); }, session(accounts.b));
      await other.page.waitForFunction(id => HaedoAuth.user?.id === id, accounts.b.id); gate.release.resolve();
      await other.page.evaluate(() => __lateReceipt);
      assert.equal((await other.page.evaluate(() => __lateReceipt)).ok, true);
      assert(['closed', 0].includes(await other.page.evaluate(async ws => { try { return (await __oldReceiptStorage.listPhotoPosts(ws)).length; } catch (_) { return 'closed'; } }, ws)), 'the cancelled receipt installed nothing');
      await other.page.evaluate(() => HaedoLife.Shell.start()); await ready(other.page);
      assert.equal(await other.page.evaluate(async () => { const s = HaedoLife.Shell.storage; return (await s.listPhotoPosts(await s.getActive())).length; }), 0);
      const foreign = await other.page.evaluate(async () => { const s = HaedoLife.Shell.storage, service = HaedoLife.BlogSync.create({ storage: s, auth: HaedoAuth, locks: null }), ws = await s.getActive(); try { await service.syncNow(); return { rows: await service.catalog(ws), posts: await s.listPhotoPosts(ws) }; } finally { service.dispose(); } });
      assert.deepEqual(foreign.rows, []); assert.deepEqual(foreign.posts, [], 'another account sees and receives nothing');
    });
    report.finalSources = await Promise.all(report.sources.map(async ({ file }) => {
      const response = await fetch(base + '/' + file); assert(response.ok); const served = Buffer.from(await response.arrayBuffer()), disk = await fs.readFile(file);
      assert.equal(sha(served), sha(disk), file); return { file, sha256: sha(disk) };
    }));
    assert.deepEqual(report.finalSources, report.sources, 'Frozen served runtime must remain unchanged throughout the regression');
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } catch (error) { report.pass = false; report.error = error.stack; throw error; }
  finally { if (active) { for (const gate of active.gates) gate.release.resolve(); for (const context of new Set(active.contexts)) await context.close(); } await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

/* Actual UI + bundled Auth/Storage SDK + IndexedDB; intercepted anonymous HTTP.
 * This checks default-save behavior, not hosted SQL/RLS or Apple hardware. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4246';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready, nav } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, session, cloud, base } = require('./life-sync-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const output = path.resolve(__dirname, '../.local/blog-default-server');
const copy = value => structuredClone(value), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const report = { checks: [], visual: [], pageErrors: [], consoleErrors: [], expectedTransportErrors: [], external: [],
  scope: 'Actual local app, bundled SDK and account-scoped IndexedDB; synthetic Auth/blog CAS/Storage HTTP. No production account, hosted SQL/RLS, Google or Apple-device claim.' };
class BlogCloud extends FakeCloud {}

async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); report.node = process.version;
  let activePage;
  async function fixture(name) {
    const server = new BlogCloud(), context = await makeContext(browser, server, name, accounts.a, { viewport: { width: 1440, height: 1000 } });
    const watch = page => {
      page.setDefaultTimeout(15000); page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
      page.on('console', event => {
        if (event.type() !== 'error') return;
        if (server.expectedFailures && /Failed to load resource:.*(?:ERR_INTERNET_DISCONNECTED|ERR_FAILED|ERR_ABORTED)|TypeError: Failed to fetch/.test(event.text())) report.expectedTransportErrors.push({ name, message: event.text() });
        else report.consoleErrors.push({ name, message: event.text() });
      });
    };
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if ([new URL(base).origin, cloud].includes(url.origin) || ['blob:', 'data:'].includes(url.protocol)) return route.fallback();
      report.external.push({ name, origin: url.origin }); return route.abort();
    });
    const page = await context.newPage(); watch(page); activePage = page;
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await ready(page); await page.locator('#homePosts[aria-busy="false"]').waitFor();
    return { page, context, server, name, watch };
  }
  async function state(page) {
    return page.evaluate(async () => {
      const storage = HaedoLife.Shell.storage, ws = await storage.getActive(), index = await storage.listPhotoPosts(ws), docs = [];
      for (const item of index) {
        const doc = await storage.readPhotoPost(ws, item.id), photos = [];
        for (const photo of doc.photos) photos.push({ id: photo.id, digest: await HaedoLife.PhotoPost.digest(photo.blob), width: photo.width, height: photo.height, size: photo.blob.size, type: photo.type });
        docs.push({ id: doc.id, replaces: doc.replaces, revision: doc.revision, status: doc.status, title: doc.title, ops: doc.ops, photos, sync: await storage.readBlogSyncState(ws, doc.id) });
      }
      return { ws, docs };
    });
  }
  async function draft(f, title) {
    const { page } = f;
    const previousSaves = f.server.saves().length, previousAssets = f.server.assetCalls.length;
    await page.locator('[data-home-destination="write"]:visible, #homeFirstWrite').click(); await page.locator('.ql-editor').waitFor();
    await page.locator('#photoTitle').fill(title); await page.locator('.ql-editor').fill('익명 여행의 본문 🌱\n원본 사진을 유지합니다.');
    const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 257; canvas.height = 193; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#385941'; ctx.fillRect(0, 0, 257, 193); return canvas.toDataURL('image/png').split(',')[1]; });
    f.original = Buffer.from(png, 'base64');
    await page.locator('#photoFiles').setInputFiles({ name: 'anonymous-original.png', mimeType: 'image/png', buffer: f.original });
    await page.waitForFunction(async title => { const s = HaedoLife.Shell.storage, ws = await s.getActive(), rows = await s.listPhotoPosts(ws); const row = rows.find(row => row.title === title); return row && (await s.readPhotoPost(ws, row.id)).photos.length === 1; }, title);
    assert.equal(f.server.saves().length, previousSaves); assert.equal(f.server.assetCalls.length, previousAssets, 'Draft autosave must stay entirely local');
  }
  async function save(f, expected = 'synced') {
    await f.page.getByRole('button', { name: '글 저장', exact: true }).click(); await f.page.locator('.photo-article').waitFor();
    await f.page.locator('.photo-server-status[data-state="' + expected + '"]').waitFor();
    const id = await f.page.locator('#photoServerStatus').getAttribute('data-post-id');
    const current = await state(f.page), doc = current.docs.find(doc => doc.id === id && doc.status === 'saved'); assert(doc); return { ...current, doc };
  }
  async function edit(f, title) {
    await f.page.getByRole('button', { name: '글 수정', exact: true }).click(); await f.page.locator('#photoTitle').fill(title);
    await f.page.locator('.ql-editor').press('End'); await f.page.locator('.ql-editor').pressSequentially(' 수정한 여행 문장');
  }
  async function check(name, action) {
    console.log('START ' + name); const f = await fixture(name);
    try { await action(f); assert(f.server.blogCalls.every(call => !/publish/.test(call.rpc))); report.checks.push({ name, pass: true, privateSaves: f.server.saves().length, originalUploads: f.server.assetCalls.filter(call => call.method === 'POST').length, publications: 0 }); console.log('PASS ' + name); }
    catch (error) { await f.page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error; }
    finally { f.server.hold?.release.resolve(); await f.context.close(); }
  }
  async function capture(page, scene) {
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready);
      const metrics = await page.evaluate(inspect);
      const geometry = await page.evaluate(() => {
        const bar = document.querySelector('.photo-commandbar')?.getBoundingClientRect();
        const scope = document.querySelector('.photo-server-scope')?.getBoundingClientRect();
        return { commandbarHeight: bar?.height || 0, commandbarBottom: bar?.bottom || 0, scopeHeight: scope?.height || 0 };
      });
      report.visual.push({ scene, width, metrics, geometry });
      assert.equal(metrics.horizontalOverflow, false, scene + ' ' + width);
      await page.screenshot({ path: path.join(output, scene + '-' + width + '.png') });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  try {
    await check('Draft stays local; explicit save stores the whole post and exact original privately', async f => {
      await draft(f, '기본 서버 보관'); await capture(f.page, 'writing');
      assert.equal(f.server.saves().length, 0); const saved = await save(f), row = [...f.server.posts.values()][0];
      assert.equal(saved.doc.photos[0].digest, sha(f.original)); assert.equal(saved.doc.photos[0].width, 257); assert.equal(saved.doc.photos[0].height, 193);
      assert.equal(row.data.photos[0].digest, sha(f.original)); assert.equal(row.data.photos[0].width, 257); assert.equal(row.data.photos[0].height, 193);
      assert.deepEqual(f.server.originals.get(row.assets[row.data.photos[0].id].path).bytes, f.original);
      assert.equal(saved.doc.sync.status, 'synced'); assert.equal(row.publication, null);
      await capture(f.page, 'private-server-success');
    });
    await check('Reopening is read-only; a saved edit keeps one remote identity and the original photo', async f => {
      await draft(f, '다시 여는 여행'); const first = await save(f), remoteId = first.doc.sync.remoteId, writes = f.server.saves().length;
      await nav(f.page, 'home'); await f.page.locator('#homePosts[aria-busy="false"]').waitFor();
      await f.page.getByRole('button', { name: '다시 여는 여행', exact: true }).click(); await f.page.locator('.photo-article').waitFor();
      await f.page.locator('.photo-server-status[data-state="synced"]').waitFor(); assert.equal(f.server.saves().length, writes);
      await edit(f, '수정한 여행'); const second = await save(f);
      assert.notEqual(second.doc.id, first.doc.id); assert.equal(second.doc.sync.remoteId, remoteId); assert.equal(f.server.posts.size, 1);
      assert.equal(second.doc.photos[0].digest, sha(f.original)); assert.equal([...f.server.posts.values()][0].revision, 2);
    });
    await check('Offline verification cannot undo local saving; explicit retry stores that same post', async f => {
      await draft(f, '오프라인 여행'); f.server.offline.add(f.name);
      await f.page.getByRole('button', { name: '글 저장', exact: true }).click();
      await f.page.locator('#photoServerRetry').waitFor(); const local = await state(f.page), saved = local.docs.find(doc => doc.status === 'saved');
      assert(saved); assert.equal(saved.photos[0].digest, sha(f.original)); assert.equal(f.server.posts.size, 0); assert(saved.sync, 'Failed default saving needs durable local state');
      await capture(f.page, 'offline-local-retained');
      f.server.offline.delete(f.name); await f.page.getByRole('button', { name: '서버 보관 다시 시도', exact: true }).click();
      await f.page.locator('.photo-server-status[data-state="synced"]').waitFor();
      assert.equal((await state(f.page)).docs.find(doc => doc.status === 'saved').id, saved.id); assert.equal(f.server.posts.size, 1);
    });
    await check('Remote CAS conflict preserves both saved bodies and never overwrites the server', async f => {
      await draft(f, '경합 여행'); const initial = await save(f), row = [...f.server.posts.values()][0];
      row.revision++; row.data.title = '다른 기기에서 쓴 제목'; row.data.ops.unshift({ insert: 'REMOTE_BODY_SENTINEL\n' });
      const remoteBefore = copy(row); await edit(f, '현재 기기의 새 제목'); const saved = await save(f, 'conflict');
      assert.equal(saved.doc.title, '현재 기기의 새 제목'); assert.equal(saved.doc.photos[0].digest, initial.doc.photos[0].digest);
      assert.deepEqual([...f.server.posts.values()][0], remoteBefore); assert.equal(saved.doc.sync.status, 'conflict');
      await f.page.getByRole('button', { name: '글 관리에서 서버 내용 확인', exact: true }).waitFor();
    });
    await check('Paused post remains paused after editing and saving; it is never silently enabled', async f => {
      await draft(f, '중지한 여행'); const first = await save(f), writes = f.server.saves().length;
      await f.page.evaluate(async id => { const storage = HaedoLife.Shell.storage, ws = await storage.getActive(), sync = HaedoLife.BlogSync.create({ storage, auth: HaedoAuth }); try { await sync.pause(ws, id); } finally { sync.dispose(); } }, first.doc.id);
      await edit(f, '중지 상태로 수정'); const saved = await save(f, 'paused');
      assert.equal(saved.doc.sync.enabled, false); assert.equal(saved.doc.sync.remoteId, first.doc.sync.remoteId); assert.equal(f.server.saves().length, writes);
      assert.equal(await f.page.locator('#photoServerRetry').count(), 0);
    });
    await check('A late private ACK cannot attach the old post or success UI to another account', async f => {
      await draft(f, 'A 계정의 여행'); const hold = { device: f.name, entered: deferred(), release: deferred() }; f.server.hold = hold;
      try {
        await f.page.getByRole('button', { name: '글 저장', exact: true }).click(); await hold.entered.promise;
        await f.page.evaluate(async value => { const result = await HaedoAuth.client.auth.setSession(value); if (result.error) throw result.error; await HaedoAuth.verify(); }, session(accounts.b));
        await f.page.waitForFunction(id => HaedoLife.Shell.storage?.account?.userId === id && HaedoAuth.user?.id === id && !document.querySelector('#lifeApp').hidden, accounts.b.id);
        hold.release.resolve(); await ready(f.page); const current = await state(f.page);
        assert.equal(current.docs.length, 0); assert.equal(await f.page.locator('.photo-server-status[data-state="synced"]').count(), 0);
        assert(f.server.saves().every(call => call.owner === accounts.a.id)); assert([...f.server.posts.values()].every(row => row.owner === accounts.a.id));
      } finally { hold.release.resolve(); }
    });
    await check('A pending server reply permits a second local post without blocking or overwriting its server state', async f => {
      await draft(f, '응답 대기 중인 첫 여행'); const hold = { device: f.name, entered: deferred(), release: deferred() }; f.server.hold = hold;
      try {
        await f.page.getByRole('button', { name: '글 저장', exact: true }).click(); await hold.entered.promise;
        await nav(f.page, 'home'); await f.page.locator('#homePosts[aria-busy="false"]').waitFor();
        await draft(f, '기다리지 않고 쓴 두 번째 여행'); const second = await save(f);
        assert.equal(second.doc.title, '기다리지 않고 쓴 두 번째 여행'); assert.equal(f.server.posts.size, 2);
        hold.release.resolve(); await f.page.locator('.photo-server-status[data-state="synced"][data-post-id="' + second.doc.id + '"]').waitFor();
        assert.equal((await state(f.page)).docs.filter(doc => doc.status === 'saved').length, 2);
      } finally { hold.release.resolve(); }
    });
    await check('A pending reply permits normal workspace selection without leaking its old success status', async f => {
      const next = await f.page.evaluate(async () => { const storage = HaedoLife.Shell.storage, previous = await storage.getActive(), value = await storage.createWorkspace('독립 새 공간'); await storage.setActive(previous); return value.workspaceId; });
      await f.page.reload({ waitUntil: 'domcontentloaded' }); await ready(f.page); await f.page.locator('#homePosts[aria-busy="false"]').waitFor();
      await draft(f, '이전 공간의 여행'); const hold = { device: f.name, entered: deferred(), release: deferred() }; f.server.hold = hold;
      try {
        await f.page.getByRole('button', { name: '글 저장', exact: true }).click(); await hold.entered.promise;
        await nav(f.page, 'manage'); await f.page.locator('#lifeCurrentWorkspace').click(); await f.page.locator('#lifeWorkspace').selectOption(next);
        await f.page.waitForFunction(async expected => await HaedoLife.Shell.storage.getActive() === expected && !document.querySelector('.life-app[aria-busy="true"]'), next);
        hold.release.resolve();
        const current = await state(f.page); assert.equal(current.ws, next); assert.deepEqual(current.docs, []);
        assert(f.server.saves().every(call => call.body.p_workspace_id !== next)); assert.equal(await f.page.locator('#photoServerStatus').count(), 0);
      } finally { hold.release.resolve(); }
    });
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } catch (error) {
    report.pass = false; report.error = error.stack;
    await activePage?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); throw error;
  } finally {
    await browser.close(); report.browserClosed = true;
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

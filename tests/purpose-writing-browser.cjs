/* Purpose workflow: real local app, bundled SDK and scoped IndexedDB. Only
 * synthetic Auth/blog/library HTTP and native IO fault gates are intercepted.
 * This does not verify hosted RLS, Google OAuth or physical Apple devices. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4198';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready, settle, nav } = require('./unified-home-browser.cjs');
const { accounts, base, cloud } = require('./life-sync-browser.cjs');
const { CompositionCloud } = require('./composition-sync-browser.cjs');
const { openBlogMenu } = require('./helpers/feature-menus.cjs');
const Z = require('../vendor/fflate/fflate.js');
const output = path.resolve(process.env.PURPOSE_WRITING_OUTPUT || '.local/purpose-writing');
const digest = value => createHash('sha256').update(value).digest('hex');
const sources = ['home.js', 'photo-post-ui.js', 'blog-manager.js', 'account-blog-ui.js', 'workbench-ui.js', 'ui.js', 'preservation-ui.js', 'preservation.js'];
async function hashes() { return Object.fromEntries(await Promise.all(sources.map(async name => [name, digest(await fs.readFile(path.join(__dirname, '../assets/life', name)))]))); }
async function poll(read, accept, label, timeout = 15000) {
  const start = Date.now(); let value;
  do { value = await read(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 75)); } while (Date.now() - start < timeout);
  throw Error(label + ': ' + JSON.stringify(value));
}
async function seed(page) {
  const fixture = await page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, C = HaedoLife.Core, P = HaedoLife.PhotoPost, workspaceId = await s.getActive();
    const raw = '\ufeff정확한 원문\r\ne\u0301와 🌱 원래 문장\r\n마지막 줄', quote = 'e\u0301와 🌱 원래 문장';
    const initial = await s.read(workspaceId), old = await C.prepareImport({ origin: 'obsidian', title: '정확 판 근거', text: raw, authorRelation: 'self' }, initial);
    let next = C.applyChanges(initial, C.buildImportChanges(initial, old));
    const newer = await C.prepareImport({ origin: 'obsidian', title: '정확 판 근거', text: 'UNSELECTED_NEW_VERSION', existingSourceId: old.source.id, authorRelation: 'self' }, next);
    next = C.applyChanges(next, C.buildImportChanges(next, newer));
    const result = await s.commitLocal({ workspaceId, baseRevision: initial.revision, operationId: C.id(), changes: { put: { sources: next.sources, sourceVersions: next.sourceVersions, records: next.records } } });
    if (result.status !== 'stored') throw Error('Synthetic source fixture not stored');
    const bundle = await s.read(workspaceId), sourceRef = await HaedoLife.SourceReference.build({ bundle, sourceId: old.source.id, versionId: old.version.id, locator: { start: raw.indexOf(quote), end: raw.indexOf(quote) + quote.length } });
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 72;
    const g = canvas.getContext('2d'); g.fillStyle = '#354958'; g.fillRect(0, 0, 96, 72); g.fillStyle = '#eee'; g.fillRect(9, 11, 31, 19);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const photo = await P.readPhoto(new File([blob], '합성 원본.png', { type: 'image/png' }), C.id);
    const doc = P.create(C.id); doc.title = '정확한 글의 여정'; doc.status = 'saved'; doc.photos = [photo];
    doc.ops = [{ insert: '내 문장 e\u0301와 🌱\n' }, { insert: { photo: { id: photo.id, caption: '원본 사진 설명', alt: '합성 풍경' } } }, { insert: '\n' }];
    const post = await s.savePhotoPostWithEvidence(workspaceId, doc, 0, [sourceRef], 0);
    const other = P.create(C.id); other.title = 'UNSELECTED_POST'; other.status = 'saved'; other.ops = [{ insert: 'UNSELECTED_BODY\n' }];
    await s.savePhotoPost(workspaceId, other, 0);
    return { workspaceId, postId: post.id, revision: post.revision, title: post.title, raw, oldVersionId: old.version.id, otherId: other.id, sourceRef, photo: { id: photo.id, digest: photo.digest, size: photo.size } };
  });
  await poll(() => page.evaluate(() => HaedoLife.Shell.accountLibrary.getState()), value => value.status === 'synced', 'source fixture sync');
  // Fixture writes happen outside the mounted home controller. Reopen the app
  // before testing user actions, just as a new document reads existing data.
  await page.reload(); await ready(page);
  return fixture;
}
const postState = (page, fixture) => page.evaluate(async f => {
  const s = HaedoLife.Shell.storage, doc = await s.readPhotoPost(f.workspaceId, f.postId);
  return { doc: { ...doc, photos: await Promise.all(doc.photos.map(async p => { const { blob, ...meta } = p; return { ...meta, bytes: await HaedoLife.PhotoPost.digest(blob) }; })) }, evidence: await s.readPostEvidence(f.workspaceId, f.postId) };
}, fixture);
async function openReader(page, f, search = false) {
  await nav(page, 'home'); await page.locator('#homePosts[aria-busy="false"]').waitFor();
  if (search) { await page.locator('.home-search-toggle').click(); await page.locator('#homePostSearch').fill('정확한 글'); }
  await page.getByRole('button', { name: f.title, exact: true }).click(); await page.locator('.photo-article').waitFor();
  await page.locator('#photoServerStatus:not([data-state="checking"])').waitFor();
}
async function more(page, action) {
  const menu = page.locator('details.photo-more'); if (!await menu.evaluate(node => node.open)) await menu.locator(':scope > summary').click();
  await menu.locator('[data-post-action="' + action + '"]').click(); await settle(page);
  if (action === 'manage') await page.locator('.blog-manager-list[data-state="ready"]').waitFor();
  else await page.locator('#preservationPostSelection').waitFor();
}
async function changePost(page, f, suffix) {
  return page.evaluate(async ({ f, suffix }) => {
    const s = HaedoLife.Shell.storage, doc = await s.readPhotoPost(f.workspaceId, f.postId);
    doc.title += suffix; return s.savePhotoPost(f.workspaceId, doc, doc.revision).then(value => ({ ...f, title: value.title, revision: value.revision }));
  }, { f, suffix });
}
async function manager(page) {
  await openBlogMenu(page); await page.getByRole('button', { name: '글 공개·보관', exact: true }).click(); await page.locator('.blog-manager-list[data-state="ready"]').waitFor();
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const report = { scope: 'Actual local product modules/SDK/IDB; synthetic HTTP and native IO gates only. Source may be changing until root freeze.', before: await hashes(), after: null, checks: [], consoleErrors: [], pageErrors: [], external: [], served: {} };
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  async function check(name, run, width = 1440) {
    if (process.env.PURPOSE_WRITING_MATCH && !new RegExp(process.env.PURPOSE_WRITING_MATCH).test(name)) return;
    const server = new CompositionCloud().enableAccountLibrary(), contexts = [], pages = [];
    async function device(label) {
      const context = await makeContext(browser, server, label, accounts.a, { viewport: { width, height: 1000 } }); contexts.push(context);
      await context.route('**/*', route => { if ([new URL(base).origin, cloud].includes(new URL(route.request().url()).origin)) return route.fallback(); report.external.push(route.request().url()); return route.abort(); });
      const page = await context.newPage(); pages.push(page); page.setDefaultTimeout(15000);
      page.on('pageerror', error => report.pageErrors.push({ name, error: error.message }));
      page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ name, text: event.text() }); });
      page.on('response', async response => { const match = new URL(response.url()).pathname.match(/^\/assets\/life\/([^/]+\.js)$/); if (match && sources.includes(match[1])) { try { report.served[name + ':' + label + ':' + match[1]] = digest(await response.body()); } catch (_) {} } });
      await page.goto(base + '/index.html'); await ready(page); return { page, context };
    }
    try { await run({ server, device }); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: path.join(output, 'failure-' + report.checks.length + '-' + i + '.png'), fullPage: true }).catch(() => {}); }
    finally { for (const context of contexts) await context.close(); }
  }
  try {
    for (const width of [1440, 390]) await check('exact reader manager file return ' + width, async ({ server, device }) => {
      const { page } = await device('exact-' + width), f = await seed(page);
      await poll(() => page.evaluate(() => HaedoLife.Shell.accountLibrary.getState()), value => value.status === 'synced', 'source fixture sync');
      const original = await postState(page, f), writes = server.saves().length, assets = server.assetCalls.filter(c => c.method === 'POST').length;
      await openReader(page, f, true); await more(page, 'manage');
      assert.deepEqual(await page.locator('.blog-post').evaluateAll(rows => rows.map(row => row.dataset.postId)), [f.postId]);
      assert.equal(await page.locator('#blogAccountList,.blog-manager-copy-tools').count(), 0);
      assert.equal(await page.locator('#lifeSubviewReturn').getAttribute('aria-label'), '읽던 글로 돌아가기');
      await page.screenshot({ path: path.join(output, 'manager-' + width + '.png'), fullPage: true });
      await page.locator('#lifeSubviewReturn').click(); await page.locator('.photo-article').waitFor();
      await page.waitForFunction(id => document.activeElement?.dataset.focusKey === 'photo:manage:' + id, f.postId);
      await more(page, 'preserve'); await page.locator('#preservationPostSelection').waitFor();
      assert.deepEqual(await page.locator('#preservationPostSelection input:checked').evaluateAll(inputs => inputs.map(input => input.dataset.postId)), [f.postId]);
      await page.locator('#preservationPrepareExport').click(); await page.locator('#preservationExportReview[data-state="ready"]').waitFor();
      const event = page.waitForEvent('download'); await page.locator('#preservationDownload').click();
      const bytes = await fs.readFile(await (await event).path()), files = Z.unzipSync(bytes), manifest = JSON.parse(Z.strFromU8(files['manifest.json']));
      assert.deepEqual(manifest.posts.map(p => p.doc.id), [f.postId]); assert.equal(manifest.posts[0].doc.revision, f.revision);
      assert.deepEqual(manifest.posts[0].evidence, original.evidence);
      assert.deepEqual(manifest.posts[0].doc.ops, original.doc.ops);
      assert.equal(manifest.bundle.sourceVersions.length, 1); assert.equal(manifest.bundle.sourceVersions[0].id, f.oldVersionId); assert.equal(manifest.bundle.sourceVersions[0].contentText, f.raw);
      assert.equal(digest(files['photos/' + f.postId + '/' + f.photo.id]), f.photo.digest);
      assert.equal(files['photos/' + f.postId + '/' + f.photo.id].length, f.photo.size);
      assert(!JSON.stringify(manifest).includes('UNSELECTED_')); assert.deepEqual(manifest.bundle.records, []);
      await fs.writeFile(path.join(output, 'exact-' + width + '.zip'), bytes);
      await page.locator('#lifeSubviewReturn').click(); await page.locator('.photo-article').waitFor();
      await page.waitForFunction(id => document.activeElement?.dataset.focusKey === 'photo:preserve:' + id, f.postId);
      assert.deepEqual(await postState(page, f), original);
      await page.getByRole('button', { name: '내 글로 돌아가기', exact: true }).click(); await page.locator('#homePostSearch').waitFor();
      assert.equal(await page.locator('#homePostSearch').inputValue(), '정확한 글');
      assert.equal(server.saves().length, writes); assert.equal(server.assetCalls.filter(c => c.method === 'POST').length, assets);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    }, width);

    await check('stale expected manager rejects retained rows after fresh IDB failure', async ({ device }) => {
      const { page } = await device('fresh-read'), f = await seed(page);
      const result = await page.evaluate(async f => {
        const s = HaedoLife.Shell.storage, host = document.createElement('div'); document.body.append(host);
        const instance = HaedoLife.BlogManager.create({ storage: s, workspaceId: f.workspaceId, auth: HaedoAuth, isCurrent: () => true });
        await instance.mount(host); const before = host.querySelectorAll('.blog-post').length;
        const get = IDBObjectStore.prototype.get; let failures = 0, rejected = false, message = '';
        IDBObjectStore.prototype.get = function(key) { const request = get.call(this, key); if (this.name === 'meta' && key === 'photo-posts:' + f.workspaceId) { IDBObjectStore.prototype.get = get; failures++; this.transaction.abort(); } return request; };
        try { await instance.mount(host, { postId: f.postId, expectedRevision: f.revision }); } catch (error) { rejected = true; message = error.message; }
        finally { IDBObjectStore.prototype.get = get; }
        const state = host.querySelector('.blog-manager-list')?.dataset.state, visibleRows = host.querySelectorAll('.blog-post').length;
        instance.dispose(); host.remove(); return { before, failures, rejected, message, state, visibleRows };
      }, f);
      assert(result.before >= 2); assert.equal(result.failures, 1); assert.equal(result.rejected, true); assert.equal(result.state, 'error'); assert.equal(result.visibleRows, 0); assert.match(result.message, /선택한 글이 바뀌었습니다/);
    });

    await check('exact file stale selection and in-flight native photo read block ZIP; explicit current recovery', async ({ device }) => {
      const { page } = await device('file-race'); let f = await seed(page), downloads = 0; page.on('download', () => downloads++);
      await openReader(page, f); await more(page, 'preserve'); await page.locator('#preservationPostSelection').waitFor();
      f = await changePost(page, f, ' 수정');
      await page.locator('#preservationPrepareExport').click(); await page.locator('#preservationError:not([hidden])').waitFor();
      assert.match(await page.locator('#preservationError').innerText(), /읽던 글이 바뀌었습니다/); assert.equal(await page.locator('#preservationExportReview').count(), 0);
      const selected = page.locator('#preservationPostSelection input[data-post-id="' + f.postId + '"]'); await selected.uncheck(); await selected.check();
      await page.locator('#preservationPrepareExport').click(); await page.locator('#preservationError:not([hidden])').waitFor(); assert.equal(await page.locator('#preservationExportReview').count(), 0);
      await page.locator('#lifeSubviewReturn').click(); await settle(page); assert.equal(await page.locator('#lifePreservation').count(), 1);
      await page.getByRole('button', { name: '현재 글 확인', exact: true }).click(); await page.locator('.photo-article').waitFor(); assert.equal(await page.locator('.photo-article h2').innerText(), f.title);
      await more(page, 'preserve'); await page.locator('#preservationPostSelection').waitFor();
      // Hold native SHA-256 while the actual service resolves the selected
      // exact source; changing the saved post must invalidate this review.
      await page.evaluate(raw => {
        const hash = SubtleCrypto.prototype.digest; window.__nativeHashGate = { entered: false };
        SubtleCrypto.prototype.digest = function(algorithm, bytes) {
          if (new TextDecoder().decode(bytes) !== raw.replace(/^\ufeff/, '')) return hash.call(this, algorithm, bytes);
          SubtleCrypto.prototype.digest = hash; __nativeHashGate.entered = true;
          return new Promise(resolve => { __nativeHashGate.release = () => resolve(hash.call(this, algorithm, bytes)); });
        };
      }, f.raw);
      await page.locator('#preservationPrepareExport').click(); await page.waitForFunction(() => window.__nativeHashGate?.entered);
      f = await changePost(page, f, ' 준비 중 수정'); await page.evaluate(() => __nativeHashGate.release());
      await page.locator('#preservationError:not([hidden])').waitFor(); assert.match(await page.locator('#preservationError').innerText(), /읽던 글이 바뀌었습니다/);
      assert.equal(await page.locator('#preservationExportReview').count(), 0); assert.equal(downloads, 0);
      await page.locator('#lifeSubviewReturn').click(); await settle(page); await page.getByRole('button', { name: '현재 글 확인', exact: true }).click(); await page.locator('.photo-article').waitFor();
      await more(page, 'preserve'); await page.locator('#preservationPostSelection').waitFor();
      await page.locator('#preservationPrepareExport').click(); await page.locator('#preservationExportReview').waitFor();
      await page.evaluate(size => {
        const read = Blob.prototype.arrayBuffer; window.__nativePhotoGate = { entered: false };
        Blob.prototype.arrayBuffer = function(...args) { if (this.size !== size) return read.apply(this, args); Blob.prototype.arrayBuffer = read; __nativePhotoGate.entered = true; return new Promise(resolve => { __nativePhotoGate.release = () => resolve(read.apply(this, args)); }); };
      }, f.photo.size);
      await page.locator('#preservationDownload').click(); await page.waitForFunction(() => window.__nativePhotoGate?.entered);
      f = await changePost(page, f, ' 또 수정'); await page.evaluate(() => __nativePhotoGate.release());
      await page.locator('#preservationError:not([hidden])').waitFor(); assert.match(await page.locator('#preservationError').innerText(), /바뀌었습니다/); assert.equal(downloads, 0);
      await page.locator('#lifeSubviewReturn').click(); await settle(page); assert.equal(await page.locator('#lifePreservation').count(), 1);
      await page.getByRole('button', { name: '현재 글 확인', exact: true }).click(); await page.locator('.photo-article').waitFor(); assert.equal(await page.locator('.photo-article h2').innerText(), f.title);
      await page.getByRole('button', { name: '내 글로 돌아가기', exact: true }).click(); await page.locator('#homePosts').waitFor();
      assert.equal((await postState(page, f)).doc.revision, f.revision); assert.equal(downloads, 0);
    });

    await check('reader action read failure stays readable; duplicate pending action and late navigation are suppressed', async ({ device, server }) => {
      const { page } = await device('navigation-race'), f = await seed(page);
      await openReader(page, f);
      await page.evaluate(f => {
        const get = IDBObjectStore.prototype.get; window.__actionFaults = 0;
        IDBObjectStore.prototype.get = function(key) {
          const request = get.call(this, key);
          if (this.name === 'meta' && key === 'photo-post:' + f.workspaceId + ':' + f.postId) {
            IDBObjectStore.prototype.get = get; __actionFaults++; this.transaction.abort();
          }
          return request;
        };
      }, f);
      await page.locator('details.photo-more > summary').click(); await page.locator('[data-post-action="manage"]').click();
      await page.waitForFunction(() => document.querySelector('.photo-status-text')?.textContent.includes('중단'));
      assert.equal(await page.evaluate(() => __actionFaults), 1); assert.equal(await page.locator('.photo-article').count(), 1); assert.equal(await page.locator('.blog-manager').count(), 0);
      await page.evaluate(f => {
        const get = IDBObjectStore.prototype.get; window.__actionGate = { entered: false, reads: 0 };
        IDBObjectStore.prototype.get = function(key) {
          const request = get.call(this, key);
          if (this.name !== 'meta' || key !== 'photo-post:' + f.workspaceId + ':' + f.postId) return request;
          __actionGate.reads++;
          if (__actionGate.reads === 1) {
            const add = request.addEventListener;
            request.addEventListener = function(type, listener, options) {
              if (type !== 'success') return add.call(this, type, listener, options);
              return add.call(this, type, event => { __actionGate.entered = true; __actionGate.release = () => listener.call(request, event); }, options);
            };
          }
          return request;
        };
        __actionGate.restore = () => { IDBObjectStore.prototype.get = get; };
        const control = document.querySelector('[data-post-action="manage"]'); control.click(); control.click();
      }, f);
      await page.waitForFunction(() => window.__actionGate?.entered);
      assert.equal(await page.evaluate(() => __actionGate.reads), 1, 'duplicate action must not start a second exact-post read');
      await nav(page, 'news');
      await page.evaluate(() => { __actionGate.restore(); __actionGate.release(); });
      // Await a same-page IO turn after release; no fixed sleep or Promise predicate.
      await page.evaluate(async () => { await HaedoLife.Shell.storage.getActive(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      assert.equal(await page.locator('[data-haedo-navigation] [data-haedo-section="news"]').getAttribute('aria-current'), 'page'); assert.equal(await page.locator('.blog-manager').count(), 0);
      assert.equal(server.saves().length, 0); assert.equal(server.assetCalls.filter(call => call.method === 'POST').length, 0);
    });

    await check('representative account catalog receives once; explicit independent copy remains available', async ({ server, device }) => {
      const { page: owner } = await device('catalog-owner'), f = await seed(owner);
      await openReader(owner, f); await more(owner, 'manage'); await owner.locator('.blog-manager-server > summary').click();
      await owner.getByRole('button', { name: '이 글 서버에 보관', exact: true }).click();
      await poll(() => owner.evaluate(async f => HaedoLife.Shell.storage.readBlogSyncState(f.workspaceId, f.postId), f), value => value?.status === 'synced', 'explicit fixture blog sync');
      const original = await postState(owner, f), writes = server.saves().length, uploadCount = server.assetCalls.filter(c => c.method === 'POST').length;
      const { page } = await device('catalog-receiver'); await manager(page); await page.locator('#blogAccountList').click(); await page.locator('#accountBlogList[data-state="ready"]').waitFor();
      assert.equal(await page.locator('.ab-post').count(), 1); await page.getByRole('button', { name: '이 기기에 받기', exact: true }).click(); await page.locator('.photo-article').waitFor();
      const readCopies = () => page.evaluate(async () => { const s = HaedoLife.Shell.storage, id = await s.getActive(); return { workspaceId: id, rows: await s.listPhotoPosts(id) }; });
      const first = await readCopies(); assert.equal(first.rows.length, 1); const localId = first.rows[0].id;
      await manager(page); await page.locator('#blogAccountList').click(); await page.locator('#accountBlogList[data-state="ready"]').waitFor();
      await page.getByRole('button', { name: '이 기기의 글 열기', exact: true }).click(); await page.locator('.photo-article').waitFor();
      assert.equal((await readCopies()).rows.length, 1); assert.equal((await readCopies()).rows[0].id, localId);
      const received = await postState(page, { workspaceId: first.workspaceId, postId: localId });
      const photoMap = new Map(original.doc.photos.map((photo, index) => [photo.id, received.doc.photos[index].id]));
      const expectedOps = structuredClone(original.doc.ops); for (const op of expectedOps) if (op.insert?.photo) op.insert.photo.id = photoMap.get(op.insert.photo.id);
      assert.deepEqual(received.doc.ops, expectedOps);
      const photoBytes = doc => doc.photos.map(({ id, ...photo }) => photo); assert.deepEqual(photoBytes(received.doc), photoBytes(original.doc));
      await manager(page); await page.locator('.blog-manager-copy-tools > summary').click(); await page.getByRole('button', { name: '서버 글에서 새 사본 선택', exact: true }).click();
      await page.getByRole('button', { name: '이 글을 새 사본으로 받기', exact: true }).click();
      await poll(readCopies, value => value.rows.length === 2, 'explicit copy receipt');
      const copies = await readCopies(); assert.equal(new Set(copies.rows.map(row => row.id)).size, 2); assert(copies.rows.some(row => row.id === localId));
      assert.equal(server.saves().length, writes); assert.equal(server.assetCalls.filter(c => c.method === 'POST').length, uploadCount);
    });
  } finally { await browser.close(); report.after = await hashes(); report.sourceStable = JSON.stringify(report.before) === JSON.stringify(report.after); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
  assert(report.checks.length > 0); assert.equal(report.checks.some(check => !check.pass), false, 'purpose writing checks failed');
  assert.equal(report.sourceStable, true, 'product sources changed during verification');
  assert(Object.keys(report.served).length > 0, 'record the actual product responses used by Chromium');
  for (const [key, hash] of Object.entries(report.served)) assert.equal(hash, report.before[key.split(':').at(-1)], 'served product source differs: ' + key);
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.external, []);
  console.log('PASS purpose writing: ' + report.checks.length + ' journeys; source stable=' + report.sourceStable);
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { seed, postState };

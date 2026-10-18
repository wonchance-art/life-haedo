'use strict';
// Actual owner UI/SDK/IndexedDB and downloaded bytes; synthetic Auth only.
process.env.BASE_URL ||= 'http://127.0.0.1:4212';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, ready, makeContext } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, session, base, cloud } = require('./life-sync-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const Z = require('../vendor/fflate/fflate.js');
const output = path.resolve(__dirname, '../.local/blog-series');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], remoteWrites: [],
  scope: 'Actual local owner UI/SDK/IndexedDB, original PNG decoding and downloaded ZIP bytes. Synthetic Auth, Chromium viewports; no production, Google OAuth, Apple hardware, publication or deployment claims.' };

async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Use an explicit loopback test server');
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); report.node = process.version;
  let active = null, lastPage = null, archive, exportedSnapshot, photoEvidence;
  async function fixture() {
    const server = new FakeCloud(), context = await makeContext(browser, server, 'series-' + report.checks.length, accounts.a, { viewport: { width: 1440, height: 1000 } });
    active = context;
    // Hold a real completed account-scoped read, rather than replacing storage.
    await context.route(base + '/assets/life/storage.js', async route => {
      const response = await route.fetch(), source = await response.text();
      const hook = ';(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async readBlogSeries(...values){const result=await actual.readBlogSeries(...values);if(window.__seriesHoldRead&&actual.account.userId===window.__seriesReadOwner){window.__seriesReadHeld=true;await new Promise(resolve=>window.__seriesReleaseRead=resolve);}window.__seriesReadFinished=(window.__seriesReadFinished||0)+1;return result;}});}});})();';
      await route.fulfill({ response, body: source + hook });
    });
    context.on('request', request => {
      const u = new URL(request.url());
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
        (/\/storage\/v1\/object/.test(u.pathname) || /\/functions\/v1\//.test(u.pathname) ||
          /\/rest\/v1\/rpc\/(?:life_blog_(?:save|publish|unpublish|prepare_asset)|life_page_publish|life_sync_put)/.test(u.pathname))) report.remoteWrites.push(u.pathname);
    });
    await context.route('**/*', route => {
      const origin = new URL(route.request().url()).origin;
      if ([new URL(base).origin, cloud].includes(origin)) return route.fallback();
      report.external.push(origin); return route.abort();
    });
    const observe = page => {
      page.setDefaultTimeout(20000);
      page.on('pageerror', e => report.pageErrors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
    };
    const page = await context.newPage(); lastPage = page; observe(page);
    await page.goto(base + '/index.html'); await ready(page);
    const seed = await page.evaluate(async () => {
      const s = HaedoLife.Shell.storage, C = HaedoLife.Core, P = HaedoLife.PhotoPost, workspaceId = await s.getActive();
      const canvas = document.createElement('canvas'); canvas.width = 4032; canvas.height = 3024;
      const g = canvas.getContext('2d'); g.fillStyle = '#e7eedc'; g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = '#18443a'; g.fillRect(60, 80, 1200, 600); g.font = '60px sans-serif'; g.fillText('합성 여행 원본 🌱', 80, 850);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const photo = await P.readPhoto(new File([blob], '합성-바다.png', { type: 'image/png' }), C.id);
      const hex = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
      const pixels = await hex(g.getImageData(0, 0, canvas.width, canvas.height).data);
      const titles = ['첫날 산책의 기록', '둘째 날 바다와 사진', '돌아오는 길의 긴 한글 제목과 정확한 출처 '.repeat(5) + '끝🌱'];
      const url = 'https://example.org/series/original?edition=old&source=' + 'a'.repeat(300) + '&tail=KEEP_SOURCE_TAIL';
      const ids = [];
      for (let i = 0; i < titles.length; i++) {
        const doc = P.create(C.id); doc.title = titles[i]; doc.status = 'saved';
        doc.ops = [{ insert: '합성 여행 본문 ' + (i + 1) + ' 🌱\r\n' + (i === 2 ? url : '그날 직접 적은 생각') + '\n' }];
        if (i === 1) { doc.photos = [photo]; doc.ops.push({ insert: { photo: { id: photo.id, caption: '바다 사진 설명\n둘째 줄', alt: '합성 바다의 짙은 초록 사각형' } } }, { insert: '\n' }); }
        const saved = await s.savePhotoPost(workspaceId, doc, 0); ids.push(saved.id);
      }
      const draft = P.create(C.id); draft.title = 'UNSELECTED_DRAFT_SENTINEL'; await s.savePhotoPost(workspaceId, draft, 0);
      const hidden = P.create(C.id); hidden.status = 'saved'; hidden.archived = true; hidden.title = 'UNSELECTED_ARCHIVE_SENTINEL'; hidden.ops = [{ insert: 'UNSELECTED_BODY_SENTINEL\n' }]; await s.savePhotoPost(workspaceId, hidden, 0);
      return { workspaceId, ids, titles, url, photo: { digest: photo.digest, pixels, width: photo.width, height: photo.height, size: photo.size } };
    });
    async function go() {
      await page.goto(base + '/index.html?section=records&view=page'); await ready(page);
      await page.locator('#wbPageSeries').click(); await page.locator('#bsNew').waitFor();
    }
    await go();
    return { page, context, server, seed, go, observe };
  }
  async function state(page, requested) {
    return page.evaluate(async requested => {
      const s = HaedoLife.Shell.storage, w = requested || await s.getActive();
      async function portable(value) {
        if (value instanceof Blob) return { type: value.type, size: value.size, actualDigest: await HaedoLife.PhotoPost.digest(value) };
        if (Array.isArray(value)) return Promise.all(value.map(portable));
        if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await portable(v)])));
        return value;
      }
      const docs = [];
      for (const row of await s.listPhotoPosts(w)) docs.push(await s.readPhotoPost(w, row.id));
      const series = await s.readBlogSeries(w), snapshots = [];
      for (const value of series.series) snapshots.push(await s.readBlogSeriesSnapshot(w, value.id));
      const seriesKeys = await new Promise((resolve, reject) => {
        const request = indexedDB.open('life-tools-v1'); request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('meta', 'readonly'), get = tx.objectStore('meta').getAllKeys();
          get.onsuccess = () => { const keys = get.result.filter(k => k === 'blog-series:' + w || k.startsWith('blog-series-post:' + w + ':')).sort(); tx.oncomplete = () => { db.close(); resolve(keys); }; };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
      });
      return portable({ workspaceId: w, bundle: await s.read(w), workbench: await s.readWorkbench(w), nine: await s.readNineBoard(w),
        collection: await s.readCollection(w), stages: await s.listStages(w), drafts: await s.readPageDrafts(w), docs, series, snapshots, seriesKeys });
    }, requested);
  }
  function originals(after, before) {
    for (const key of ['workspaceId', 'bundle', 'workbench', 'nine', 'collection', 'stages', 'drafts', 'docs']) assert.deepEqual(after[key], before[key], 'Original changed: ' + key);
  }
  async function saved(page) { await page.locator('.bs-status[data-state=saved]').waitFor(); }
  async function createSeries(f) {
    await f.page.locator('#bsNew').click(); await f.page.locator('#bsTitle').fill('제주에서 천천히 걸은 사흘');
    await f.page.locator('#bsIntro').fill('세 편의 글과 사진으로 남긴 비공개 여행 모음 🌱'); await saved(f.page);
    await f.page.locator('.bs-picker > summary').click(); await f.page.locator('#bsCandidates [data-post-id]').first().waitFor();
    assert.equal(await f.page.locator('#bsCandidates [data-post-id]').count(), 3, 'Drafts and archived posts are not candidates');
    for (const id of f.seed.ids) {
      await f.page.locator('#bsPostSearch').fill(f.seed.titles[f.seed.ids.indexOf(id)]);
      await f.page.locator('#bsCandidates [data-post-id="' + id + '"] button').click();
      await f.page.waitForFunction(n => document.querySelectorAll('#bsEntries li[data-entry-id]').length === n, f.seed.ids.indexOf(id) + 1);
      await saved(f.page);
    }
    return f.page.locator('#bsSelect').inputValue();
  }
  async function capture(page, scene) {
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => scrollTo({ top: 0, left: 0, behavior: 'instant' }));
      const metrics = await page.evaluate(inspect);
      assert.equal(metrics.horizontalOverflow, false, scene + ' overflow');
      for (const key of ['unnamed', 'contrastFailures', 'smallTargets', 'smallInputs']) assert.deepEqual(metrics[key], [], scene + ' ' + key);
      const file = scene + '-' + width + '.png'; await page.screenshot({ path: path.join(output, file), fullPage: true });
      report.visual.push({ scene, width, file, metrics });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  async function files(page) { if (!await page.locator('.bs-files').evaluate(n => n.open)) await page.locator('.bs-files > summary').click(); }
  async function importArchive(page, bytes) {
    await page.locator('#bsImport').setInputFiles({ name: 'travel-series.zip', mimeType: 'application/zip', buffer: bytes });
    await page.getByRole('button', { name: '새 모음으로 불러오기', exact: true }).waitFor();
  }
  function content(snapshot) {
    return { title: snapshot.series.title, intro: snapshot.series.intro, posts: snapshot.posts.map(({ doc }) => ({
      title: doc.title, ops: doc.ops.map(op => typeof op.insert === 'string' ? op : { ...op, insert: { photo: { ...op.insert.photo, id: doc.photos.findIndex(p => p.id === op.insert.photo.id) } } }),
      attachments: doc.attachments || [], photos: doc.photos.map(({ id, ...photo }) => photo),
    })) };
  }
  async function check(name, run) {
    if (process.env.BLOG_SERIES_MATCH && !new RegExp(process.env.BLOG_SERIES_MATCH).test(name)) return;
    console.log('START ' + name);
    try { await run(); report.checks.push(name); console.log('PASS ' + name); }
    catch (error) {
      await lastPage?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
      const dom = await lastPage?.evaluate(() => ({ title: document.title, text: document.body.innerText, seriesStatus: document.querySelector('.bs-status')?.outerHTML })).catch(() => null);
      if (dom) await fs.writeFile(path.join(output, 'failure-dom.json'), JSON.stringify(dom, null, 2));
      throw error;
    }
    finally { await active?.close(); active = null; }
  }
  try {
    await check('Saved travel posts become ordered private snapshots with original-safe editing and accessible sequential reading', async () => {
      const f = await fixture(), before = await state(f.page); const id = await createSeries(f);
      const rows = f.page.locator('#bsEntries li[data-entry-id]'), entryIds = await rows.evaluateAll(nodes => nodes.map(n => n.dataset.entryId));
      await rows.nth(2).locator('[data-action=up]').click(); await saved(f.page);
      assert.deepEqual(await rows.evaluateAll(nodes => nodes.map(n => n.dataset.entryId)), [entryIds[0], entryIds[2], entryIds[1]]);
      const after = await state(f.page); originals(after, before); assert.equal(after.series.series.length, 1);
      const ordered = after.snapshots[0]; assert.deepEqual(ordered.posts.map(p => p.doc.id), [f.seed.ids[0], f.seed.ids[2], f.seed.ids[1]]);
      await capture(f.page, 'editor');
      assert.equal(await f.page.locator('#bsPublish').count(), 1, 'Public dialog is verified in its separate suite');
      await f.page.locator('#bsRead').click(); await f.page.locator('.blog-series-reader[data-view=contents]').waitFor();
      await capture(f.page, 'contents');
      const toc = f.page.locator('.blog-series-toc button[data-entry-id]'); assert.equal(await toc.count(), 3);
      await toc.nth(0).click(); await f.page.locator('.blog-series-reader-body[aria-busy=false]').waitFor();
      assert.equal(await f.page.locator('#blogSeriesReaderPrevious').isDisabled(), true);
      assert((await f.page.locator('.blog-series-reader-body').innerText()).includes(f.seed.titles[0]));
      await f.page.locator('#blogSeriesReaderNext').click(); await f.page.locator('.blog-series-reader-body[aria-busy=false]').waitFor();
      assert((await f.page.locator('.blog-series-reader-body').innerText()).includes(f.seed.url));
      await f.page.locator('#blogSeriesReaderContents').click(); await toc.nth(1).waitFor();
      await f.page.waitForFunction(id => document.activeElement?.dataset.entryId === id, entryIds[0]);
      await toc.nth(1).click(); await f.page.locator('.blog-series-reader-body[aria-busy=false]').waitFor();
      await f.page.locator('#blogSeriesReaderContents').click();
      await f.page.waitForFunction(id => document.activeElement?.dataset.entryId === id, entryIds[2]);
      await toc.nth(2).click(); await f.page.locator('.blog-series-reader-body[aria-busy=false]').waitFor();
      assert.equal(await f.page.locator('#blogSeriesReaderNext').isDisabled(), true);
      await f.page.waitForFunction(() => [...document.querySelectorAll('.blog-series-reader-body img')].some(img => img.complete && img.naturalWidth === 4032 && img.naturalHeight === 3024));
      await f.page.getByRole('button', { name: '사진 원본 크기로 보기', exact: true }).click();
      const zoom = await f.page.locator('.blog-photo-frame').evaluate(frame => ({ imageWidth: frame.querySelector('img').getBoundingClientRect().width, naturalWidth: frame.querySelector('img').naturalWidth, width: frame.clientWidth, scroll: frame.scrollWidth }));
      assert.equal(zoom.imageWidth, 4032); assert.equal(zoom.imageWidth, zoom.naturalWidth); assert(zoom.scroll > zoom.width);
      await f.page.getByRole('button', { name: '사진 화면에 맞추기', exact: true }).click();
      await capture(f.page, 'photo-reading');
      await f.page.locator('#blogSeriesReaderContents').click();
      await f.page.locator('#blogSeriesReaderEdit').click(); await f.page.locator('#bsTitle').waitFor();
      // Mutate real ordinary posts after capture. Reading/export must retain
      // the selected old versions instead of looking up their newer IDs.
      await f.page.evaluate(async ids => {
        const s = HaedoLife.Shell.storage, w = await s.getActive(), old = await s.readPhotoPost(w, ids[0]);
        old.title = '원래 글에서 나중에 고친 제목'; await s.savePhotoPost(w, old, old.revision);
        const prior = await s.readPhotoPost(w, ids[2]), replacement = HaedoLife.PhotoPost.create(HaedoLife.Core.id);
        replacement.status = 'saved'; replacement.title = '다른 ID로 저장한 원래 글'; replacement.replaces = { id: prior.id, revision: prior.revision };
        replacement.ops = [{ insert: 'REPLACED_SOURCE_MUST_NOT_REPLACE_SNAPSHOT\n' }]; await s.savePhotoPost(w, replacement, 0);
        try { await s.readPhotoPost(w, prior.id); throw Error('Expected the replaced original ID to be absent'); }
        catch (error) { if (error.code !== 'photo_post_missing') throw error; }
      }, f.seed.ids);
      const mutated = await state(f.page); assert.deepEqual(mutated.snapshots[0], ordered);
      await files(f.page); const download = f.page.waitForEvent('download'); await f.page.locator('#bsExport').click();
      archive = Buffer.from(await fs.readFile(await (await download).path())); exportedSnapshot = ordered; photoEvidence = f.seed.photo;
      const outer = Z.unzipSync(archive), manifest = JSON.parse(Z.strFromU8(outer['series.json']));
      assert.equal(manifest.format, 'life-blog-series-package-v1'); assert.equal(manifest.posts.length, 3);
      assert.deepEqual(manifest.series.items.map(x => x.id), ordered.series.items.map(x => x.id));
      assert.equal(Object.keys(outer).length, 4);
      const json = JSON.stringify(manifest);
      for (const sentinel of ['UNSELECTED_DRAFT_SENTINEL', 'UNSELECTED_ARCHIVE_SENTINEL', 'UNSELECTED_BODY_SENTINEL', 'REPLACED_SOURCE_MUST_NOT_REPLACE_SNAPSHOT']) assert(!json.includes(sentinel));
      const row = manifest.posts.find(x => x.doc.photos.length);
      const inner = Z.unzipSync(outer['posts/' + row.itemId + '.zip']);
      assert.equal(sha(inner['photos/' + row.doc.photos[0].id]), photoEvidence.digest);
      await f.go(); assert.equal(await f.page.locator('#bsSelect').inputValue(), id);
      assert.equal(await f.page.locator('#bsTitle').inputValue(), ordered.series.title); originals(await state(f.page), mutated);
      assert.equal(f.server.writes().length, 0);
    });
    await check('The actual downloaded file restores complete text and full-resolution photos into a fresh workspace under new IDs', async () => {
      assert(archive, 'Run the preceding real-download journey');
      const f = await fixture(), before = await state(f.page);
      const workspaceId = await f.page.evaluate(() => HaedoLife.Shell.storage.createWorkspace('모음 파일만으로 새 공간'));
      const freshId = typeof workspaceId === 'string' ? workspaceId : workspaceId.workspaceId;
      await f.page.evaluate(id => HaedoLife.Shell.storage.setActive(id), freshId); await f.go();
      const empty = await state(f.page); assert.equal(empty.docs.length, 0); assert.equal(empty.series.series.length, 0);
      await importArchive(f.page, archive); await f.page.getByRole('button', { name: '새 모음으로 불러오기', exact: true }).click(); await f.page.locator('#bsImportReview').waitFor({ state: 'detached' }); await saved(f.page);
      const restored = await state(f.page); originals(restored, empty); assert.equal(restored.snapshots.length, 1);
      const copy = restored.snapshots[0]; assert.notEqual(copy.series.id, exportedSnapshot.series.id);
      assert.deepEqual(content(copy), content(exportedSnapshot));
      for (let i = 0; i < copy.posts.length; i++) {
        assert.notEqual(copy.series.items[i].id, exportedSnapshot.series.items[i].id);
        assert.notEqual(copy.posts[i].doc.id, exportedSnapshot.posts[i].doc.id);
        for (let j = 0; j < copy.posts[i].doc.photos.length; j++) assert.notEqual(copy.posts[i].doc.photos[j].id, exportedSnapshot.posts[i].doc.photos[j].id);
      }
      const pixels = await f.page.evaluate(async ({ workspaceId, seriesId }) => {
        const snapshot = await HaedoLife.Shell.storage.readBlogSeriesSnapshot(workspaceId, seriesId);
        const photo = snapshot.posts.flatMap(x => x.doc.photos)[0], image = await createImageBitmap(photo.blob);
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const g = canvas.getContext('2d'); g.drawImage(image, 0, 0); image.close();
        return { digest: await HaedoLife.PhotoPost.digest(photo.blob), width: canvas.width, height: canvas.height,
          pixels: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', g.getImageData(0, 0, canvas.width, canvas.height).data)), x => x.toString(16).padStart(2, '0')).join('') };
      }, { workspaceId: freshId, seriesId: copy.series.id });
      assert.deepEqual(pixels, { digest: photoEvidence.digest, width: 4032, height: 3024, pixels: photoEvidence.pixels });
      report.photo = { ...pixels, originalSize: photoEvidence.size };
      assert.deepEqual(await state(f.page, f.seed.workspaceId), before);
      assert.equal(f.server.writes().length, 0);
    });
    await check('A real import transaction abort leaves no partial snapshot keys and the same file can be retried safely', async () => {
      assert(archive, 'Run the real-download journey'); const f = await fixture(), before = await state(f.page);
      await importArchive(f.page, archive);
      await f.page.evaluate(() => { window.__seriesPut = IDBObjectStore.prototype.put; window.__seriesAborts = 0; window.__seriesSnapshotWrites = 0;
        IDBObjectStore.prototype.put = function (...args) { const result = __seriesPut.apply(this, args);
          if (this.name === 'meta' && args[0]?.key?.startsWith('blog-series-post:')) __seriesSnapshotWrites++;
          if (this.name === 'meta' && args[0]?.key?.startsWith('blog-series:')) { __seriesAborts++; this.transaction.abort(); } return result; }; });
      await f.page.getByRole('button', { name: '새 모음으로 불러오기', exact: true }).click(); await f.page.locator('.bs-error:not([hidden])').waitFor();
      assert(await f.page.evaluate(() => __seriesAborts > 0 && __seriesSnapshotWrites === 3)); assert.deepEqual(await state(f.page), before);
      await f.page.evaluate(() => { IDBObjectStore.prototype.put = __seriesPut; });
      await f.page.getByRole('button', { name: '새 모음으로 불러오기', exact: true }).click(); await f.page.locator('#bsImportReview').waitFor({ state: 'detached' }); await saved(f.page);
      const after = await state(f.page); originals(after, before); assert.equal(after.snapshots.length, 1);
      assert.deepEqual(content(after.snapshots[0]), content(exportedSnapshot));
      const changed = Z.unzipSync(archive); changed['extra-private.txt'] = Z.strToU8('MUST_NOT_INSTALL');
      const accepted = await state(f.page);
      await f.page.locator('#bsImport').setInputFiles({ name: 'changed.zip', mimeType: 'application/zip', buffer: Buffer.from(Z.zipSync(changed, { level: 0 })) });
      await f.page.locator('.bs-error:not([hidden])').waitFor(); assert.deepEqual(await state(f.page), accepted);
    });
    await check('Two real tabs preserve the competing saved series and recover unsaved local changes as a separate exact-snapshot series', async () => {
      const f = await fixture(); const id = await createSeries(f); const before = await state(f.page);
      const other = await f.context.newPage(); f.observe(other);
      try {
        await other.goto(base + '/index.html'); await ready(other);
        await other.evaluate(async id => { const s = HaedoLife.Shell.storage, w = await s.getActive(), state = await s.readBlogSeries(w);
          state.series.find(x => x.id === id).intro = '다른 탭에서 먼저 보관한 모음'; await s.saveBlogSeries(w, state, state.revision); }, id);
        const remote = await state(f.page);
        await f.page.locator('#bsIntro').fill('현재 탭에서 지켜야 할 미보관 한글 생각 🌱');
        await f.page.locator('.bs-error:not([hidden])').waitFor();
        assert.equal(await f.page.locator('#bsIntro').inputValue(), '현재 탭에서 지켜야 할 미보관 한글 생각 🌱');
        assert.deepEqual(await state(f.page), remote);
        await f.page.locator('#bsRecover').click(); await saved(f.page);
        const recovered = await state(f.page); originals(recovered, before); assert.equal(recovered.series.series.length, 2);
        assert.equal(recovered.series.series.find(x => x.id === id).intro, '다른 탭에서 먼저 보관한 모음');
        const local = recovered.snapshots.find(x => x.series.id !== id); assert.equal(local.series.intro, '현재 탭에서 지켜야 할 미보관 한글 생각 🌱');
        assert.deepEqual(local.posts.map(x => x.doc), before.snapshots[0].posts.map(x => x.doc));
      } finally { await other.close(); }
    });
    await check('An old-account completed series read cannot render private contents after the verified account changes', async () => {
      const f = await fixture(); await createSeries(f); const before = await state(f.page);
      await f.page.goto(base + '/index.html?section=records&view=page'); await ready(f.page);
      await f.page.evaluate(() => { window.__seriesHoldRead = true; window.__seriesReadOwner = HaedoLife.Shell.storage.account.userId; window.__seriesReadHeld = false; });
      await f.page.locator('#wbPageSeries').click(); await f.page.waitForFunction(() => __seriesReadHeld === true);
      await f.page.evaluate(async value => { await HaedoAuth.client.auth.setSession({ access_token: value.access_token, refresh_token: value.refresh_token }); await HaedoAuth.verify(); }, session(accounts.b));
      await f.page.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell.storage?.account?.userId === id, accounts.b.id);
      const accountB = await state(f.page);
      const completed = await f.page.evaluate(() => __seriesReadFinished || 0);
      await f.page.evaluate(() => { __seriesHoldRead = false; __seriesReleaseRead(); });
      await f.page.waitForFunction(n => __seriesReadFinished > n, completed);
      assert.deepEqual(await state(f.page), accountB);
      assert(!(await f.page.locator('body').innerText()).includes('제주에서 천천히 걸은 사흘'));
      await f.page.evaluate(async value => { await HaedoAuth.client.auth.setSession({ access_token: value.access_token, refresh_token: value.refresh_token }); await HaedoAuth.verify(); }, session(accounts.a));
      await f.page.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell.storage?.account?.userId === id, accounts.a.id);
      assert.deepEqual(await state(f.page), before); assert.equal(f.server.writes().length, 0);
    });
    await check('Navigation waits for the actual owned import hydration and then preserves the committed series in its original workspace', async () => {
      assert(archive, 'Run the real-download journey'); const f = await fixture(), before = await state(f.page);
      await importArchive(f.page, archive);
      await f.page.evaluate(() => {
        const original = HaedoLife.Blog; window.__seriesHydrateHeld = false; window.__seriesHoldHydrate = true;
        HaedoLife.Blog = Object.freeze({ ...original, async hydrate(...args) {
          const result = await original.hydrate(...args);
          if (window.__seriesHoldHydrate) { window.__seriesHydrateHeld = true; await new Promise(resolve => window.__seriesHydrateRelease = resolve); }
          return result;
        } });
      });
      await f.page.locator('#bsImportConfirm').click(); await f.page.waitForFunction(() => __seriesHydrateHeld === true);
      await f.page.locator('[data-haedo-navigation] [data-haedo-section="home"]').click();
      await f.page.getByText('모음 처리 결과를 확인한 뒤 이동해 주세요. 입력한 내용은 유지됩니다.', { exact: true }).waitFor();
      assert.equal(await f.page.locator('#bsNew').count(), 1); assert.equal(await f.page.locator('#bsImportConfirm').isDisabled(), true);
      assert.equal(await f.page.evaluate(() => HaedoLife.Shell.storage.getActive()), f.seed.workspaceId);
      assert.deepEqual(await state(f.page), before, 'Navigation during hydrate cannot commit or leave the owner workspace');
      await f.page.evaluate(() => { __seriesHoldHydrate = false; __seriesHydrateRelease(); });
      await f.page.locator('#bsImportReview').waitFor({ state: 'detached' }); await saved(f.page);
      const committed = await state(f.page); originals(committed, before); assert.equal(committed.snapshots.length, 1);
      assert.deepEqual(content(committed.snapshots[0]), content(exportedSnapshot));
      await f.page.locator('[data-haedo-navigation] [data-haedo-section="home"]').click();
      await f.page.locator('#bsNew').waitFor({ state: 'detached' }); assert.deepEqual(await state(f.page), committed);
      assert.equal(f.server.writes().length, 0);
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []); assert.deepEqual(report.remoteWrites, []); report.pass = true;
  } catch (error) {
    report.pass = false; report.failure = error.stack;
    await lastPage?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await active?.close(); await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

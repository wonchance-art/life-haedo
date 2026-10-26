/* Read-only local post discovery: synthetic HTTP Auth, real SDK and IndexedDB.
 * No personal browser profile, production API, recovery writes or Apple claims.
 * BASE_URL=http://127.0.0.1:4233 PW_MODULE_PATH=<installed playwright> node tests/local-post-finder-browser.cjs
 */
'use strict';
const { openBlogMenu } = require('./helpers/feature-menus.cjs');
const { isLegacyLibraryCapabilityRead } = require('./helpers/library-cloud.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright, makeContext, ready, nav } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, session, base, cloud } = require('./life-sync-browser.cjs');
const out = path.resolve('.local/local-post-finder');
const ref = row => Object.fromEntries(['workspaceId', 'kind', 'id', 'revision', 'unowned', 'versionId']
  .filter(key => row[key] !== undefined).map(key => [key, row[key]]));

async function databaseSnapshot(page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('life-tools-v1');
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const names = [...db.objectStoreNames].sort(), tx = db.transaction(names, 'readonly');
      const reads = names.map(name => {
        const store = tx.objectStore(name), keys = store.getAllKeys(), values = store.getAll();
        const read = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        return Promise.all([read(keys), read(values)]).then(([keys, values]) => ({ name, rows: keys.map((key, index) => [key, values[index]]) }));
      });
      const rows = await Promise.all(reads);
      const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
      async function canonical(value) {
        if (value instanceof Blob) return { blob: true, size: value.size, type: value.type, sha256: await hash(await value.arrayBuffer()) };
        if (Array.isArray(value)) return Promise.all(value.map(canonical));
        if (value && typeof value === 'object') {
          const result = {}; for (const key of Object.keys(value).sort()) result[key] = await canonical(value[key]); return result;
        }
        return value;
      }
      const result = [];
      for (const store of rows) result.push({ store: store.name, rows: store.rows.length,
        sha256: await hash(new TextEncoder().encode(JSON.stringify(await canonical(store.rows)))) });
      return result;
    } finally { db.close(); }
  });
}

async function seed(page, { corrupt = false } = {}) {
  return page.evaluate(async ({ corrupt, foreignId }) => {
    const L = HaedoLife, C = L.Core, M = L.PhotoPost, s = L.Shell.storage;
    const workspaceId = await s.getActive(), photos = [];
    for (const [width, height] of [[4032, 3024], [1200, 1800]]) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const paint = canvas.getContext('2d'); paint.fillStyle = '#dbe6d8'; paint.fillRect(0, 0, width, height);
      paint.fillStyle = '#264833'; paint.fillRect(20, 20, 100, 80);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      photos.push(await M.readPhoto(new File([blob], 'synthetic-original-' + photos.length + '.png', { type: 'image/png' }), C.id));
    }
    async function photo(ws, title, status = 'saved', archived = false, originals = []) {
      const value = M.create(C.id); Object.assign(value, { title, status, archived, photos: originals,
        ops: [{ insert: '목록과 독립적으로 남아 있는 합성 본문🌱\n' }, ...originals.flatMap((p, i) => [
          { insert: { photo: { id: p.id, caption: '합성 사진 설명 ' + i, alt: '중립 색면 ' + i } } }, { insert: '\n' }])] });
      return s.savePhotoPost(ws, value, 0);
    }
    const missing = await photo(workspaceId, '목록에서 빠진 합성글', 'saved', false, photos);
    const second = await s.createWorkspace('별도 합성 작업공간');
    const stale = await photo(second.workspaceId, '현재 본문 제목이 정확한 합성글');
    const draft = await photo(second.workspaceId, '작성 중인 합성글', 'draft');
    const archived = await photo(second.workspaceId, '보관함의 합성글', 'saved', true);
    const state = await s.readWorkbench(second.workspaceId), time = '2026-10-20T01:00:00.000Z';
    const plain = L.PagePosts.draft([], C.id(), time); plain.body = '기존 첨부 글의 정확한 합성 본문'; plain.status = 'saved';
    state.page.posts ||= []; state.page.posts.push(plain); await s.saveWorkbench(second.workspaceId, state, state.revision);
    const pageDraft = L.PagePosts.draft([], C.id(), time); pageDraft.body = '첨부 작성기의 합성 초안';
    await s.savePageDrafts(second.workspaceId, { revision: 0, posts: [pageDraft] }, 0);
    let bundle = await s.read(second.workspaceId);
    let writing = L.Writing.createDraft(bundle); writing.title = '원문으로 저장한 합성글'; writing.text = '\ufeff이전 원문 그대로\r\n가족 👨‍👩‍👧 합성 본문';
    writing = await s.saveStage(writing);
    const prepared = await L.Writing.prepareSave(bundle, writing);
    const committed = await s.commitLocal({ workspaceId: second.workspaceId, baseRevision: bundle.revision,
      operationId: C.id(), changes: prepared.changes, stageId: writing.stageId, stageRevision: writing.revision, stageResult: prepared.stageResult });
    if (committed.status !== 'stored') throw Error('Synthetic writing commit failed');
    bundle = await s.read(second.workspaceId);
    let writingDraft = L.Writing.createDraft(bundle); writingDraft.title = '원문 작성 중 합성초안'; writingDraft.text = '아직 반영하지 않은 합성 본문';
    writingDraft = await s.saveStage(writingDraft);
    // Foreign and explicitly unowned fixtures are written only into this isolated
    // test DB. Do not switch Shell's actual account merely to seed another owner.
    const foreign = C.createWorkspace({ title: '다른 계정의 합성 공간' });
    const unowned = C.createWorkspace({ title: '로그인 전 합성 공간' });
    const unknownOwners = corrupt ? [C.createWorkspace({ title: '비노출 소유정보 오류 합성 공간' }), C.createWorkspace({ title: '비노출 소유충돌 합성 공간' })] : [];
    const foreignPost = { ...structuredClone(missing), id: C.id(), title: '다른 계정 전용 합성글' };
    const unownedPost = { ...structuredClone(missing), id: C.id(), title: '로그인 전 합성글' };
    const request = indexedDB.open('life-tools-v1');
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction(['bundles', 'meta'], 'readwrite'), meta = tx.objectStore('meta');
    const complete = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || Error('Synthetic fixture transaction aborted')); });
    meta.delete('photo-posts:' + workspaceId);
    const indexRequest = meta.get('photo-posts:' + second.workspaceId);
    indexRequest.onsuccess = () => {
      const index = indexRequest.result.value; const row = index.find(row => row.id === stale.id);
      Object.assign(row, { title: '오래된 목록 제목', revision: 0, body: '오래된 목록 본문' });
      if (corrupt) index.push({ id: 'dangling-synthetic-id', title: '본문 없는 합성 항목', revision: 1, status: 'saved', archived: false, updatedAt: time });
      meta.put({ key: 'photo-posts:' + second.workspaceId, value: index });
    };
    for (const [b, doc, owner] of [[foreign, foreignPost, { projectUrl: s.account.projectUrl, userId: foreignId }], [unowned, unownedPost, null]]) {
      tx.objectStore('bundles').add(b); if (owner) meta.put({ key: 'owner:' + b.workspaceId, value: owner });
      meta.put({ key: 'photo-post:' + b.workspaceId + ':' + doc.id, value: doc });
    }
    if (corrupt) {
      meta.put({ key: 'photo-post:' + second.workspaceId + ':corrupt-synthetic-id', value: { format: 'life-photo-post-v2', id: 'corrupt-synthetic-id', title: '손상된 합성 본문', revision: 1 } });
      const broken = C.createWorkspace({ title: '목록 형식 실패 합성 공간' });
      tx.objectStore('bundles').add(broken); meta.put({ key: 'owner:' + broken.workspaceId, value: s.account });
      meta.put({ key: 'photo-posts:' + broken.workspaceId, value: { unsupported: true } });
      meta.put({ key: 'photo-post:' + broken.workspaceId + ':' + stale.id, value: stale });
      for (const [index, b] of unknownOwners.entries()) {
        tx.objectStore('bundles').add(b);
        meta.put({ key: 'owner:' + b.workspaceId, value: { projectUrl: s.account.projectUrl, userId: index ? foreignId : '' } });
        if (index) meta.put({ key: 'sync:' + b.workspaceId, value: { binding: { projectUrl: s.account.projectUrl, userId: C.id(), remoteId: b.workspaceId } } });
        meta.put({ key: 'photo-post:' + b.workspaceId + ':' + foreignPost.id, value: foreignPost });
      }
    }
    await complete; db.close(); await s.setActive(workspaceId);
    return { workspaceId, otherWorkspaceId: second.workspaceId, missingId: missing.id, staleId: stale.id, draftId: draft.id,
      archivedId: archived.id, plainId: plain.id, pageDraftId: pageDraft.id, writingId: prepared.source.id,
      writingDraftId: writingDraft.stageId, appliedStageId: writing.stageId,
      foreignWorkspaceId: foreign.workspaceId, foreignPostId: foreignPost.id, unownedWorkspaceId: unowned.workspaceId, unownedId: unownedPost.id,
      originals: photos.map(p => ({ digest: p.digest, width: p.width, height: p.height })), title: missing.title,
      body: M.plainText(missing), sourceBody: writing.text,
      unknownOwners: unknownOwners.map(b => ({ workspaceId: b.workspaceId, title: b.title })) };
  }, { corrupt, foreignId: accounts.b.id });
}

async function manager(page) {
  await openBlogMenu(page); await page.getByRole('button', { name: '글 공개·보관', exact: true }).click();
  await page.locator('.blog-manager-list[data-state="ready"],.blog-manager-list[data-state="partial"]').waitFor();
}
async function finder(page) {
  const details = page.locator('#blogLocalFind');
  if (!await details.evaluate(node => node.open)) await details.locator(':scope > summary').click();
  await page.locator('#blogLocalScan').waitFor();
}
async function scan(page) {
  const before = await page.evaluate(() => window.__finderScans || 0);
  await page.locator('#blogLocalScan').click();
  await page.waitForFunction(before => (window.__finderScans || 0) > before &&
    ['ready', 'partial', 'error'].includes(document.querySelector('#blogLocalStatus')?.dataset.state), before);
  assert.notEqual(await page.locator('#blogLocalStatus').getAttribute('data-state'), 'error', await page.locator('#blogLocalStatus').innerText());
  return page.evaluate(() => window.__lastFinderScan);
}
const row = (page, id) => page.locator('#blogLocalResults article[data-local-post-id="' + id + '"]');

async function main() {
  assert.equal(new URL(base).hostname, '127.0.0.1', 'Use the explicitly owned loopback test server');
  await fs.mkdir(out, { recursive: true });
  const report = { scope: 'Synthetic SDK/Auth and actual isolated IndexedDB; read-only local discovery, no recovery writes, production or Apple claims.',
    checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], libraryCapabilityReads: [], remoteWrites: 0 };
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); let active;
  async function fixture(options) {
    const fake = new FakeCloud(), context = await makeContext(browser, fake, 'local-finder-' + report.checks.length, accounts.a, { viewport: { width: 1440, height: 1000 } }); active = context;
    context.on('request', request => {
      const url = new URL(request.url());
      if (isLegacyLibraryCapabilityRead(request, { cloud, server: fake })) report.libraryCapabilityReads.push({ owner: fake.libraryOwner(request), method: request.method(), path: url.pathname, parameterCount: 0 });
      else if (url.origin === cloud && url.pathname.startsWith('/rest/v1/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
          url.pathname !== '/rest/v1/rpc/life_blog_list') report.remoteWrites++;
    });
    // Instrument only the asynchronous test boundary. Original storage APIs and
    // IndexedDB validation execute in full; account transitions cannot be faked.
    const source = await fs.readFile('assets/life/storage.js', 'utf8');
    await context.route(base + '/assets/life/storage.js', route => route.fulfill({ contentType: 'application/javascript', body: source + `
      {const original=HaedoLife.Storage.forAccount;HaedoLife.Storage={...HaedoLife.Storage,forAccount(...args){const storage=original(...args);return Object.freeze({...storage,
        async scanLocalPosts(options){window.__finderScans=(window.__finderScans||0)+1;const result=await storage.scanLocalPosts(options);window.__lastFinderScan=result;if(window.__holdFinderScan){window.__holdFinderScan=false;window.__finderScanHeld=true;await new Promise(resolve=>window.__releaseFinderScan=resolve);}return result;},
        async readLocalPostCandidate(ref){const result=await storage.readLocalPostCandidate(ref);if(window.__holdFinderRead){window.__holdFinderRead=false;window.__finderReadHeld=true;await new Promise(resolve=>window.__releaseFinderRead=resolve);}return result;}
      });}};}` }));
    await context.route('**/*', route => { const origin = new URL(route.request().url()).origin;
      if ([new URL(base).origin, cloud].includes(origin)) return route.fallback(); report.external.push(origin); return route.abort(); });
    await context.route(cloud + '/rest/v1/rpc/life_blog_list', route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => report.pageErrors.push(error.message)); page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    await page.goto(base + '/index.html'); await ready(page);
    const seeded = await seed(page, options);
    // Corruption is introduced after verified mount. Existing startup workspace
    // ownership validation intentionally fails closed on malformed owners; this
    // case isolates the new explicit scan rather than changing bootstrap rules.
    if (!options?.corrupt) { await page.reload(); await ready(page); }
    return { page, context, fake, seeded };
  }
  async function check(name, run, options) {
    console.log('START ' + name); const f = await fixture(options);
    try { await run(f); assert.equal(f.fake.writes().length, 0); assert.equal(report.remoteWrites, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack });
      await f.page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), timeout: 20000 }).catch(() => {}); throw error; }
    finally { await f.context.close(); active = null; }
  }
  try {
    await check('An omitted summary stays absent from home/manager but explicit local discovery reads and exports its two original photos without any DB mutation', async ({ page, seeded }) => {
      await page.locator('#homePostList').waitFor();
      assert.equal(await page.locator('#homePostList .home-post').count(), 0);
      await manager(page); assert.equal(await page.locator('.blog-manager-list .blog-post').count(), 0);
      const before = await databaseSnapshot(page); assert.equal(await page.evaluate(() => window.__finderScans || 0), 0);
      await finder(page); assert.equal(await page.evaluate(() => window.__finderScans || 0), 0);
      assert.equal(await page.locator('#blogLocalIncludeUnowned').isChecked(), false);
      const found = await scan(page);
      assert.equal(found.complete, true); assert.deepEqual(found.issues, []);
      const missing = found.posts.find(p => p.id === seeded.missingId); assert.ok(missing); assert.equal(missing.indexState, 'missing');
      assert.equal(found.posts.find(p => p.id === seeded.staleId).indexState, 'mismatch');
      assert.equal(found.posts.find(p => p.id === seeded.staleId).title, '현재 본문 제목이 정확한 합성글');
      for (const id of [seeded.draftId, seeded.archivedId, seeded.plainId, seeded.pageDraftId, seeded.writingId, seeded.writingDraftId, seeded.appliedStageId]) assert.ok(found.posts.some(p => p.id === id), id);
      assert.equal(found.posts.find(p => p.id === seeded.draftId).status, 'draft'); assert.equal(found.posts.find(p => p.id === seeded.archivedId).archived, true);
      assert.equal(found.posts.find(p => p.id === seeded.appliedStageId).status, 'applied');
      assert.ok(found.workspaces.some(w => w.workspaceId === seeded.otherWorkspaceId));
      assert.ok(!found.posts.some(p => [seeded.foreignPostId, seeded.unownedId].includes(p.id)));
      assert.ok(!found.workspaces.some(w => [seeded.foreignWorkspaceId, seeded.unownedWorkspaceId].includes(w.workspaceId)));
      const denied = await page.evaluate(async input => {
        try { await HaedoLife.Shell.storage.readLocalPostCandidate(input); return null; } catch (error) { return error.code; }
      }, { workspaceId: seeded.foreignWorkspaceId, id: seeded.foreignPostId, kind: 'photo', revision: 1, unowned: false });
      assert.equal(denied, 'workspace_access_denied', 'A forged candidate reference must not cross account ownership');
      // Inspect the first result on mobile before any download/second click can
      // auto-scroll and conceal an off-screen, merely programmatically focused preview.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#blogLocalResults article').first().getByRole('button', { name: '내용 확인', exact: true }).click();
      await page.locator('#blogLocalPreview[data-state="ready"]').waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const position = await page.evaluate(() => {
        const heading = document.querySelector('#blogLocalPreview h3'), bounds = heading.getBoundingClientRect();
        const header = document.querySelector('.life-toolbar.haedo-page-heading').getBoundingClientRect();
        return { top: bounds.top, bottom: bounds.bottom, headerBottom: header.bottom,
          height: innerHeight, focused: document.activeElement === heading };
      });
      assert.equal(position.focused, true);
      assert.ok(position.headerBottom > 0, 'Measure the actual visible sticky heading bar');
      assert.ok(position.top >= Math.max(0, position.headerBottom) - 1, 'Preview heading must clear the sticky header');
      assert.ok(position.top < position.height && position.bottom > 0 && position.bottom <= position.height,
        'First result preview heading must be visible before another click can scroll it into view');
      report.mobilePreview = position;
      await page.screenshot({ path: path.join(out, 'preview-mobile-390.png'), timeout: 20000 });
      report.visual.push({ scene: 'preview', width: 390 });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await row(page, seeded.missingId).getByRole('button', { name: '내용 확인', exact: true }).click();
      const preview = page.locator('#blogLocalPreview'); await preview.waitFor();
      assert.ok((await preview.innerText()).includes(seeded.title));
      const download = page.waitForEvent('download'); await preview.getByRole('button', { name: /ZIP/ }).click();
      const file = await download, bytes = await fs.readFile(await file.path());
      const restored = await page.evaluate(async bytes => {
        const doc = await HaedoLife.PhotoPost.readBackup(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }), HaedoLife.Core.id);
        return { title: doc.title, body: HaedoLife.PhotoPost.plainText(doc), photos: await Promise.all(doc.photos.map(async p => ({ digest: await HaedoLife.PhotoPost.digest(p.blob), width: p.width, height: p.height }))) };
      }, [...bytes]);
      assert.equal(restored.title, seeded.title); assert.equal(restored.body, seeded.body); assert.deepEqual(restored.photos, seeded.originals);
      await row(page, seeded.writingId).getByRole('button', { name: '내용 확인', exact: true }).click();
      await page.locator('#blogLocalPreview[data-state="ready"]').waitFor();
      const textDownload = page.waitForEvent('download');
      await page.locator('#blogLocalPreview').getByRole('button', { name: '본문 사본 저장', exact: true }).click();
      assert.equal(await fs.readFile(await (await textDownload).path(), 'utf8'), seeded.sourceBody, 'Text download preserves BOM, CRLF and emoji without title prefix');
      await page.locator('#blogLocalSearch').fill('목록과 독립적으로');
      assert.equal(await page.locator('#blogLocalResults article').count(), 0, 'The search promises titles, not an unperformed full-body scan');
      await page.locator('#blogLocalSearch').fill('');
      await page.locator('#blogLocalIncludeUnowned').check(); assert.equal(await row(page, seeded.unownedId).count(), 0, 'Checkbox alone must not read old local data');
      const withUnowned = await scan(page); assert.ok(withUnowned.posts.some(p => p.id === seeded.unownedId && p.unowned));
      assert.ok(!withUnowned.posts.some(p => p.id === seeded.foreignPostId));
      assert.deepEqual(await databaseSnapshot(page), before, 'Scan/preview/file download must preserve all rows, revisions, owner/active keys, timestamps, indexes and Blob SHA');
      report.originalPhotos = seeded.originals;
      for (const width of [1440, 820, 390]) { await page.setViewportSize({ width, height: 1000 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        await page.screenshot({ path: path.join(out, 'found-' + width + '.png'), timeout: 20000 }); report.visual.push({ scene: 'found', width }); }
    });
    await check('Corrupt raw documents, invalid summaries and dangling indexes report partial results while retaining readable candidates and every stored byte', async ({ page, seeded }) => {
      await manager(page); await finder(page); const before = await databaseSnapshot(page), result = await scan(page);
      assert.equal(result.complete, false); assert.ok(result.issues.length >= 3);
      assert.ok(result.posts.some(p => p.id === seeded.missingId)); assert.ok(result.posts.some(p => p.id === seeded.staleId));
      assert.ok(!result.posts.some(p => ['corrupt-synthetic-id', 'dangling-synthetic-id'].includes(p.id)));
      assert.ok(!result.posts.some(p => p.id === seeded.foreignPostId));
      for (const hidden of seeded.unknownOwners) {
        assert.ok(!JSON.stringify(result).includes(hidden.workspaceId), 'Unverified owner workspace IDs must not leak through issues');
        assert.ok(!JSON.stringify(result).includes(hidden.title), 'Unverified owner workspace titles must not leak through issues');
      }
      const ownershipIssues = result.issues.filter(issue => issue.code === 'workspace_ownership_unknown');
      assert.equal(ownershipIssues.length, 2); assert.ok(ownershipIssues.every(issue => !Object.hasOwn(issue, 'workspaceId')));
      await row(page, seeded.missingId).getByRole('button', { name: '내용 확인', exact: true }).click(); await page.locator('#blogLocalPreview').waitFor();
      assert.deepEqual(await databaseSnapshot(page), before);
      report.partialIssueCodes = result.issues.map(issue => issue.code).sort();
    }, { corrupt: true });
    await check('A changed candidate is refused and delayed old-account scan/read results never enter the new account view', async ({ page, seeded }) => {
      await manager(page); await finder(page); const found = await scan(page), candidate = found.posts.find(p => p.id === seeded.missingId);
      await page.evaluate(async id => { const s = HaedoLife.Shell.storage, w = await s.getActive(), doc = await s.readPhotoPost(w, id); doc.title = '명시적으로 바꾼 합성글'; await s.savePhotoPost(w, doc, doc.revision); }, seeded.missingId);
      const beforeStaleRead = await databaseSnapshot(page);
      const staleCode = await page.evaluate(async input => { try { await HaedoLife.Shell.storage.readLocalPostCandidate(input); return null; } catch (error) { return error.code; } }, ref(candidate));
      assert.equal(staleCode, 'local_post_changed'); assert.deepEqual(await databaseSnapshot(page), beforeStaleRead);
      await row(page, seeded.missingId).getByRole('button', { name: '내용 확인', exact: true }).click();
      await page.locator('#blogLocalStatus[data-state="error"]').waitFor();
      assert.equal(await page.locator('#blogLocalPreview').isVisible(), false);
      assert.deepEqual(await databaseSnapshot(page), beforeStaleRead);
      await page.evaluate(() => { window.__holdFinderScan = true; window.__finderScanHeld = false; });
      await page.locator('#blogLocalScan').click(); await page.waitForFunction(() => __finderScanHeld);
      await page.evaluate(async value => { await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, session(accounts.b));
      await page.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell.storage?.account?.userId === id, accounts.b.id); await ready(page);
      const beforeRelease = await databaseSnapshot(page);
      await page.evaluate(() => __releaseFinderScan());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('#blogLocalResults article').count(), 0);
      assert.ok(!(await page.locator('#lifeApp').innerText()).includes(seeded.title));
      assert.deepEqual(await databaseSnapshot(page), beforeRelease);
      await page.evaluate(async value => { await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, session(accounts.a));
      await page.waitForFunction(id => HaedoLife.Shell.storage?.account?.userId === id, accounts.a.id); await ready(page);
      await manager(page); await finder(page); await scan(page);
      await page.evaluate(() => { window.__holdFinderRead = true; window.__finderReadHeld = false; });
      await row(page, seeded.missingId).getByRole('button', { name: '내용 확인', exact: true }).click(); await page.waitForFunction(() => __finderReadHeld);
      await page.evaluate(async value => { await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, session(accounts.b));
      await page.waitForFunction(id => HaedoLife.Shell.storage?.account?.userId === id, accounts.b.id); await ready(page);
      const beforeReadRelease = await databaseSnapshot(page); await page.evaluate(() => __releaseFinderRead());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('#blogLocalPreview').count(), 0); assert.ok(!(await page.locator('#lifeApp').innerText()).includes('명시적으로 바꾼 합성글'));
      assert.deepEqual(await databaseSnapshot(page), beforeReadRelease);
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } catch (error) { report.pass = false; report.error = error.stack; throw error; }
  finally { await active?.close(); await browser.close(); report.resourcesClosed = true; report.capturedAt = new Date().toISOString();
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({ pass: report.pass, checks: report.checks.length, visual: report.visual.length,
    consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, remoteWrites: 0 }));
}

module.exports = { databaseSnapshot, seed, manager, finder, scan, ref };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

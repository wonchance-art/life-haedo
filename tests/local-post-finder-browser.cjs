/* Read-only local post discovery: synthetic HTTP Auth, real SDK and IndexedDB.
 * 2026-11-01 owner directive: posts sync to every device automatically, so the
 * per-browser "이 브라우저에서 글 찾기" control is gone from the manager. The
 * read-only, account-scoped storage scan it used is still verified here.
 * No personal browser profile, production API, recovery writes or Apple claims.
 * BASE_URL=http://127.0.0.1:4233 PW_MODULE_PATH=<installed playwright> node tests/local-post-finder-browser.cjs
 */
'use strict';
const { openBlogMenu } = require('./helpers/feature-menus.cjs');
const { isLegacyLibraryCapabilityRead } = require('./helpers/library-cloud.cjs');
const { isBackgroundSync } = require('./helpers/account-sync-rpcs.cjs'); // Owner directive 2026-11-01: only owner-scoped background sync calls are excluded.
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
        // Account-document sync bookkeeping (accountDoc:/accountDocBase:/accountDocCursor:/accountDocRecovery:)
        // is written by the background engine, not by the finder under test; it is excluded by name.
        return Promise.all([read(keys), read(values)]).then(([keys, values]) => ({ name, rows: keys.map((key, index) => [key, values[index]])
          .filter(([key]) => !(name === 'meta' && typeof key === 'string' && /^accountDoc(?:Base|Cursor|Recovery)?:/.test(key))) }));
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
// The background account sync is parked so this read-only scan observes an
// unchanged database; explicit storage calls stand in for the removed control.
async function scan(page, options = {}) {
  const before = await page.evaluate(() => window.__finderScans || 0);
  const result = await page.evaluate(options => HaedoLife.Shell.storage.scanLocalPosts(options), options);
  assert.equal(await page.evaluate(() => window.__finderScans || 0), before + 1);
  return result;
}
// Explicit app writes (a save, an account start) may still be committing
// listeners' follow-up work; observe the database once it is quiet.
async function settled(page) {
  let value = await databaseSnapshot(page);
  for (let tries = 0; tries < 50; tries++) { await page.waitForTimeout(200); const next = await databaseSnapshot(page); if (JSON.stringify(next) === JSON.stringify(value)) return next; value = next; }
  return value;
}
async function candidate(page, input) {
  return page.evaluate(async input => {
    try { const value = await HaedoLife.Shell.storage.readLocalPostCandidate(input); return { ok: true, kind: value.kind, title: value.title, body: value.body ?? null }; }
    catch (error) { return { ok: false, code: error.code }; }
  }, input);
}

async function main() {
  assert.equal(new URL(base).hostname, '127.0.0.1', 'Use the explicitly owned loopback test server');
  await fs.mkdir(out, { recursive: true });
  const report = { scope: 'Synthetic SDK/Auth and actual isolated IndexedDB; read-only local discovery, no recovery writes, production or Apple claims.',
    checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], libraryCapabilityReads: [], remoteWrites: 0 };
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); let active;
  async function fixture(options) {
    const fake = new FakeCloud(), context = await makeContext(browser, fake, 'local-finder-' + report.checks.length, accounts.a, { viewport: { width: 1440, height: 1000 } }); active = context;
    await context.addInitScript(() => {
      const request = LockManager.prototype.request;
      LockManager.prototype.request = function (name, ...rest) { if (String(name).startsWith('haedo-blog-sync:')) return Promise.resolve(rest.at(-1)(null)); return request.call(this, name, ...rest); };
    });
    context.on('request', request => {
      const url = new URL(request.url());
      if (isBackgroundSync(request.url())) (report.backgroundSync ||= []).push(url.pathname); else if (isLegacyLibraryCapabilityRead(request, { cloud, server: fake })) report.libraryCapabilityReads.push({ owner: fake.libraryOwner(request), method: request.method(), path: url.pathname, parameterCount: 0 });
      else if (url.origin === cloud && url.pathname.startsWith('/rest/v1/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
          url.pathname !== '/rest/v1/rpc/life_blog_list') {
          report.remoteWrites++; (report.remoteWritePaths ||= []).push(url.pathname); }
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
    await check('An omitted summary stays absent from home/manager; the manager offers no per-browser finder, and the account-scoped scan reads and exports its two originals without any DB mutation', async ({ page, seeded }) => {
      await page.locator('#homePostList').waitFor(); await page.locator('#homePosts[aria-busy="false"]').waitFor();
      // 2026-11-01 one account, one blog: the home lists the indexed posts of
      // every library of the account: the second library's saved post and the
      // account-less post that sign-in adoption copied (same id) into the
      // account's new copy. A document omitted from its summary list stays absent.
      const homeIds = () => page.locator('#homePostList .home-post').evaluateAll(nodes => nodes.map(node => node.dataset.photoPostId + '@' + node.dataset.workspaceId).sort());
      const shown = await (async () => { for (let tries = 0; tries < 100; tries++) { const ids = await homeIds(); if (ids.length === 2) return ids; await page.waitForTimeout(100); } return homeIds(); })();
      assert.deepEqual(shown.map(row => row.split('@')[0]).sort(), [seeded.staleId, seeded.unownedId].sort());
      assert.ok(shown.every(row => row.split('@')[1] !== seeded.unownedWorkspaceId), 'the copied post opens in the account copy, never the account-less library');
      assert.equal(await page.locator('#homePostList [data-photo-post-id="' + seeded.missingId + '"]').count(), 0);
      await manager(page); assert.equal(await page.locator('.blog-manager-list .blog-post').count(), 0);
      assert.equal(await page.locator('#blogLocalFind').count(), 0, 'No per-device discovery choice remains');
      assert.equal(await page.getByText('이 브라우저에서 글 찾기').count(), 0);
      const before = await databaseSnapshot(page); assert.equal(await page.evaluate(() => window.__finderScans || 0), 0);
      const found = await scan(page);
      assert.equal(found.complete, true); assert.deepEqual(found.issues, []);
      const missing = found.posts.find(p => p.id === seeded.missingId); assert.ok(missing); assert.equal(missing.indexState, 'missing');
      assert.equal(found.posts.find(p => p.id === seeded.staleId).indexState, 'mismatch');
      assert.equal(found.posts.find(p => p.id === seeded.staleId).title, '현재 본문 제목이 정확한 합성글');
      for (const id of [seeded.draftId, seeded.archivedId, seeded.plainId, seeded.pageDraftId, seeded.writingId, seeded.writingDraftId, seeded.appliedStageId]) assert.ok(found.posts.some(p => p.id === id), id);
      assert.equal(found.posts.find(p => p.id === seeded.draftId).status, 'draft'); assert.equal(found.posts.find(p => p.id === seeded.archivedId).archived, true);
      assert.equal(found.posts.find(p => p.id === seeded.appliedStageId).status, 'applied');
      assert.ok(found.workspaces.some(w => w.workspaceId === seeded.otherWorkspaceId));
      assert.ok(!found.posts.some(p => p.id === seeded.foreignPostId));
      // The account-less post is found only as the adopted account copy.
      assert.ok(found.posts.filter(p => p.id === seeded.unownedId).every(p => !p.unowned && p.workspaceId !== seeded.unownedWorkspaceId));
      assert.ok(!found.workspaces.some(w => [seeded.foreignWorkspaceId, seeded.unownedWorkspaceId].includes(w.workspaceId)));
      assert.equal((await candidate(page, { workspaceId: seeded.foreignWorkspaceId, id: seeded.foreignPostId, kind: 'photo', revision: 1, unowned: false })).code, 'workspace_access_denied', 'A forged candidate reference must not cross account ownership');
      const exported = await page.evaluate(async input => {
        const value = await HaedoLife.Shell.storage.readLocalPostCandidate(input);
        const doc = await HaedoLife.Blog.hydrate(HaedoLife.Blog.pack(value.doc), value.doc.photos), zip = await HaedoLife.PhotoPost.backup(doc);
        const restored = await HaedoLife.PhotoPost.readBackup(zip, HaedoLife.Core.id);
        return { title: restored.title, body: HaedoLife.PhotoPost.plainText(restored), photos: await Promise.all(restored.photos.map(async p => ({ digest: await HaedoLife.PhotoPost.digest(p.blob), width: p.width, height: p.height }))) };
      }, ref(missing));
      assert.equal(exported.title, seeded.title); assert.equal(exported.body, seeded.body); assert.deepEqual(exported.photos, seeded.originals);
      const source = await candidate(page, ref(found.posts.find(p => p.id === seeded.writingId)));
      assert.equal(source.body, seeded.sourceBody, 'Text body preserves BOM, CRLF and emoji');
      const withUnowned = await scan(page, { includeUnowned: true }); assert.ok(withUnowned.posts.some(p => p.id === seeded.unownedId && p.unowned));
      assert.ok(!withUnowned.posts.some(p => p.id === seeded.foreignPostId));
      assert.deepEqual(await databaseSnapshot(page), before, 'Scan/read/export must preserve all rows, revisions, owner/active keys, timestamps, indexes and Blob SHA');
      report.originalPhotos = seeded.originals;
      for (const width of [1440, 820, 390]) { await page.setViewportSize({ width, height: 1000 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        await page.screenshot({ path: path.join(out, 'manager-' + width + '.png'), timeout: 20000 }); report.visual.push({ scene: 'manager-without-finder', width }); }
      await page.setViewportSize({ width: 1440, height: 1000 });
    });
    await check('Corrupt raw documents, invalid summaries and dangling indexes report partial results while retaining readable candidates and every stored byte', async ({ page, seeded }) => {
      const before = await databaseSnapshot(page), result = await scan(page);
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
      assert.equal((await candidate(page, ref(result.posts.find(p => p.id === seeded.missingId)))).ok, true);
      assert.deepEqual(await databaseSnapshot(page), before);
      report.partialIssueCodes = result.issues.map(issue => issue.code).sort();
    }, { corrupt: true });
    await check('A changed candidate is refused, and an old account handle cannot scan or read after the account changes', async ({ page, seeded }) => {
      const found = await scan(page), item = found.posts.find(p => p.id === seeded.missingId);
      await page.evaluate(async id => { const s = HaedoLife.Shell.storage, w = await s.getActive(), doc = await s.readPhotoPost(w, id); doc.title = '명시적으로 바꾼 합성글'; await s.savePhotoPost(w, doc, doc.revision); }, seeded.missingId);
      const beforeStaleRead = await settled(page);
      assert.equal((await candidate(page, ref(item))).code, 'local_post_changed'); assert.deepEqual(await databaseSnapshot(page), beforeStaleRead);
      await page.evaluate(() => { window.__oldFinderStorage = HaedoLife.Shell.storage; });
      await page.evaluate(async value => { await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, session(accounts.b));
      await page.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell.storage?.account?.userId === id, accounts.b.id); await ready(page);
      // The newly signed-in account finishes its own startup writes first.
      const beforeOld = await settled(page);
      const stale = await page.evaluate(async input => {
        const codes = [];
        try { await __oldFinderStorage.scanLocalPosts({}); codes.push('read'); } catch (error) { codes.push(error.code); }
        try { await __oldFinderStorage.readLocalPostCandidate(input); codes.push('read'); } catch (error) { codes.push(error.code); }
        return codes;
      }, { ...ref(item), revision: item.revision + 1 });
      assert.deepEqual(stale, ['storage_scope_closed', 'storage_scope_closed']);
      const other = await scan(page); assert.ok(!other.posts.some(p => p.id === seeded.missingId), 'the other account sees nothing of this account');
      assert.ok(!(await page.locator('#lifeApp').innerText()).includes('명시적으로 바꾼 합성글'));
      assert.deepEqual(await databaseSnapshot(page), beforeOld);
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } catch (error) { report.pass = false; report.error = error.stack; throw error; }
  finally { await active?.close(); await browser.close(); report.resourcesClosed = true; report.capturedAt = new Date().toISOString();
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({ pass: report.pass, checks: report.checks.length, visual: report.visual.length,
    consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, remoteWrites: 0 }));
}

// The signed-in account's account-docs engine has finished a full cycle on this page. Its
// first cycle for an account records that account's cursor and document schema in meta
// (storage writeAccountDocCursor); a snapshot meant as "before" for that account is taken
// after this point, not while the engine may still write. Synchronous predicate on purpose:
// page.waitForFunction treats a returned Promise as already true.
async function accountDocsCycled(page, userId) {
  await page.waitForFunction(id => HaedoLife.Shell.storage?.account?.userId === id && ['synced', 'pending'].includes(HaedoLife.Shell.accountDocsSync?.getStatus().state), userId);
}
module.exports = { databaseSnapshot, accountDocsCycled, seed, manager, scan, candidate, ref };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

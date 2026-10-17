/* Selected preservation ZIP journeys: actual app/SDK/IndexedDB and downloaded
 * bytes; synthetic Auth only. No production, private files or Apple claims. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4197';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready, settle, nav } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, base, cloud } = require('./life-sync-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const Z = require('../vendor/fflate/fflate.js');
const out = path.resolve(__dirname, '../.local/preservation');
const hash = value => createHash('sha256').update(value).digest('hex');

async function seed(page) {
  return page.evaluate(async () => {
    const C = HaedoLife.Core, P = HaedoLife.PhotoPost, R = HaedoLife.SourceReference,
      N = HaedoLife.NineBoard, s = HaedoLife.Shell.storage, workspaceId = await s.getActive();
    const initial = await s.read(workspaceId);
    const raw = '\ufeff🌱 머리\r\n👨‍👩‍👧‍👦 정확한 옛 구절\r\n둘째 줄\r\n원문 끝';
    const quote = '👨‍👩‍👧‍👦 정확한 옛 구절\r\n둘째 줄';
    const locator = { start: raw.indexOf(quote), end: raw.indexOf(quote) + quote.length };
    const old = await C.prepareImport({ origin: 'obsidian', title: '정확한 옛 산책 원문', text: raw,
      author: '익명 작성자', authorRelation: 'other', url: 'https://example.org/preservation-source', fileName: '익명 산책.md', originalCreatedAt: '2024-06-03', coverage: { status: 'partial', omissions: ['사진 미포함'] } }, initial);
    let next = C.applyChanges(initial, C.buildImportChanges(initial, old, [{ ...locator, topic: '선택하지 않은 발췌', note: 'PRIVATE_RECORD_SENTINEL' }]));
    const newer = await C.prepareImport({ origin: 'obsidian', title: old.source.title,
      text: 'LATEST_VERSION_MUST_NOT_REPLACE_OLD', existingSourceId: old.source.id, authorRelation: 'unknown' }, next);
    next = C.applyChanges(next, C.buildImportChanges(next, newer));
    const unrelated = await C.prepareImport({ origin: 'apple_notes', title: 'UNSELECTED_SOURCE_SENTINEL', text: 'UNSELECTED_BODY_SENTINEL', authorRelation: 'self' }, next);
    next = C.applyChanges(next, C.buildImportChanges(next, unrelated));
    const commit = await s.commitLocal({ workspaceId, baseRevision: initial.revision, operationId: C.id(), changes: { put: {
      sources: next.sources, sourceVersions: next.sourceVersions, records: next.records,
    } } });
    if (commit.status !== 'stored') throw Error('Synthetic source fixture failed');
    const bundle = await s.read(workspaceId), sourceRef = await R.build({ bundle, sourceId: old.source.id, versionId: old.version.id, locator });
    const photos = [];
    for (const [width, height, type, name] of [[4032, 3024, 'image/png', '익명 풍경.png'], [1200, 1800, 'image/jpeg', '익명 세로.jpg']]) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const g = canvas.getContext('2d'); g.fillStyle = '#e7e1d5'; g.fillRect(0, 0, width, height);
      g.fillStyle = '#222'; g.font = '42px sans-serif'; g.fillText('합성 원본 사진 🌱', 40, 90);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.91));
      photos.push(await P.readPhoto(new File([blob], name, { type }), C.id));
    }
    const doc = P.create(C.id); doc.title = '선택한 여행 사진 글'; doc.status = 'saved'; doc.photos = photos;
    doc.ops = [{ insert: '오래 남길 여행의 생각🌱\n' }, ...photos.flatMap((p, i) => [
      { insert: { photo: { id: p.id, caption: '사진 설명 ' + i + '\n둘째 줄', alt: '합성 풍경 ' + i } } }, { insert: '\n' },
    ])];
    let post = await s.savePhotoPostWithEvidence(workspaceId, doc, 0, [sourceRef], 0);
    post = await s.savePhotoPost(workspaceId, post, post.revision);
    const dependencyDoc = P.create(C.id); dependencyDoc.title = '9칸이 참조한 저장 글'; dependencyDoc.status = 'saved';
    dependencyDoc.ops = [{ insert: '9칸에 직접 고른 저장 글의 정확한 구절🌱\n' }];
    let dependency = await s.savePhotoPost(workspaceId, dependencyDoc, 0);
    dependency = await s.savePhotoPost(workspaceId, dependency, dependency.revision);
    const postRef = await R.buildPost({ workspaceId, post: dependency });
    const hidden = P.create(C.id); hidden.title = 'UNSELECTED_POST_SENTINEL'; hidden.status = 'saved'; hidden.ops = [{ insert: 'UNSELECTED_POST_BODY_SENTINEL\n' }];
    await s.savePhotoPost(workspaceId, hidden, 0);
    const draft = P.create(C.id); draft.title = 'UNSAVED_DRAFT_SENTINEL'; await s.savePhotoPost(workspaceId, draft, 0);
    const selected = N.create(C.id); selected.title = '옛 구절과 저장 글 아홉 칸'; selected.intro = '선택한 구성 설명';
    selected.areas[0].title = '내가 고른 근거'; selected.areas[0].note = 'SELECTED_AREA_NOTE_KEEP';
    selected.areas[0].items = [N.evidenceSnapshot({ kind: 'source', value: sourceRef }), N.evidenceSnapshot({ kind: 'post', value: postRef })];
    selected.areas[0].items[0].reason = '선택한 구절의 이유'; selected.areas[0].items[1].reason = '선택한 저장 글의 이유';
    const privateBoard = N.create(C.id); privateBoard.title = 'UNSELECTED_BOARD_SENTINEL'; privateBoard.areas[0].note = 'UNSELECTED_AREA_NOTE_SENTINEL';
    await s.saveNineBoard(workspaceId, { format: 'life-nine-board-v2', workspaceId, revision: 0, boards: [selected, privateBoard] }, 0);
    await s.writeBlogSyncState(workspaceId, post.id, { enabled: false, status: 'paused', remoteId: 'PRIVATE_REMOTE_ID_SENTINEL', publication: { token: 'PRIVATE_PUBLIC_TOKEN_SENTINEL', active: false } }, 0);
    return { workspaceId, raw, quote, locator, sourceId: old.source.id, oldVersionId: old.version.id, latestVersionId: newer.version.id,
      postId: post.id, postRevision: post.revision, dependencyId: dependency.id, dependencyRevision: dependency.revision,
      boardId: selected.id, photoHashes: photos.map(p => ({ id: p.id, digest: p.digest, size: p.size, width: p.width, height: p.height, name: p.name, type: p.type })) };
  });
}

async function state(page, workspaceId) {
  return page.evaluate(async requested => {
    const s = HaedoLife.Shell.storage, id = requested || await s.getActive(), index = await s.listPhotoPosts(id);
    const posts = [];
    for (const row of index) {
      const doc = await s.readPhotoPost(id, row.id), photos = [];
      for (const p of doc.photos) { const { blob, ...meta } = p; photos.push({ ...meta, actualHash: await HaedoLife.PhotoPost.digest(blob) }); }
      posts.push({ doc: { ...doc, photos }, evidence: await s.readPostEvidence(id, row.id), blog: await s.readBlogSyncState(id, row.id) });
    }
    return { active: await s.getActive(), spaces: await s.listWorkspaces(), bundle: await s.read(id), nine: await s.readNineBoard(id),
      workbench: await s.readWorkbench(id), collection: await s.readCollection(id), pageDrafts: await s.readPageDrafts(id),
      stages: await s.listStages(id), posts };
  }, workspaceId);
}

// Test-fixture-only access to the synthetic legacy rows. Production code does
// not expose an ownership-delete action; this recreates pre-account local data.
async function legacyRows(page, workspaceId, action = 'read', postId = null, owner = null) {
  return page.evaluate(async ({ workspaceId, action, postId, owner }) => {
    const data = await new Promise((resolve, reject) => {
      const open = indexedDB.open('life-tools-v1'); open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction(['bundles', 'meta'], action === 'read' ? 'readonly' : 'readwrite'), meta = tx.objectStore('meta');
        const result = {};
        if (action === 'deleteOwner') meta.delete('owner:' + workspaceId);
        else if (action === 'setOwner') meta.put({ key: 'owner:' + workspaceId, value: owner });
        else if (action === 'editPost') {
          const request = meta.get('photo-post:' + workspaceId + ':' + postId);
          request.onsuccess = () => {
            const row = request.result, doc = row.value;
            doc.title = '검증 도중 다른 창에서 바뀐 계정 미연결 글'; doc.revision++; doc.updatedAt = new Date().toISOString(); meta.put(row);
            const index = meta.get('photo-posts:' + workspaceId);
            index.onsuccess = () => { const row = index.result, summary = row.value.find(value => value.id === postId);
              Object.assign(summary, { title: doc.title, revision: doc.revision, updatedAt: doc.updatedAt }); meta.put(row); };
          };
        }
        if (action === 'read') {
          const bundle = tx.objectStore('bundles').get(workspaceId); bundle.onsuccess = () => { result.bundle = bundle.result; };
          const all = tx.objectStore('bundles').getAllKeys(); all.onsuccess = () => { result.workspaceIds = all.result.sort(); };
          const rows = meta.getAll(); rows.onsuccess = () => { result.rows = rows.result.filter(row => row.key.includes(workspaceId)).sort((a, b) => a.key.localeCompare(b.key)); };
        }
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || Error('Synthetic legacy transaction aborted')); };
        tx.oncomplete = () => { db.close(); resolve(result); };
      };
    });
    async function portable(value) {
      if (value instanceof Blob) return { type: value.type, size: value.size, actualHash: await HaedoLife.PhotoPost.digest(value) };
      if (Array.isArray(value)) return Promise.all(value.map(portable));
      if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await portable(item)])));
      return value;
    }
    return portable(data);
  }, { workspaceId, action, postId, owner });
}

async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Only an explicit loopback test server is permitted');
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const report = { checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], browser: browser.version(),
    scope: 'Actual local app/SDK/IndexedDB and downloaded ZIP bytes. Synthetic Auth, no production accounts or remote writes. Chromium viewport simulation; no Apple claim.' };
  const server = new FakeCloud(), context = await makeContext(browser, server, 'preservation-a', accounts.a, { viewport: { width: 1440, height: 1000 }, hasTouch: true });
  // Keep the actual account-scoped IDB implementation; expose only deterministic
  // read failures and an already completed read returning after account disposal.
  await context.route(base + '/assets/life/storage.js', async route => {
    const response = await route.fetch(), source = await response.text();
    const hook = `;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,
      async readWorkbench(...values){if(window.__preservationFailWorkbench)throw Object.assign(new Error('Synthetic workbench read failure'),{code:'synthetic_read_failure'});return actual.readWorkbench(...values);},
      async readPreservationSnapshot(...values){const value=await actual.readPreservationSnapshot(...values);if(window.__preservationHoldSnapshot){window.__preservationSnapshotHeld=true;await new Promise(resolve=>window.__preservationReleaseSnapshot=resolve);}window.__preservationSnapshotFinished=(window.__preservationSnapshotFinished||0)+1;return value;},
      async installPreservationCopy(...values){window.__preservationInstalling=true;try{return await actual.installPreservationCopy(...values);}finally{window.__preservationInstalling=false;}}
    });}});})();`;
    await route.fulfill({ response, body: source + hook });
  });
  await context.route(base + '/assets/life/blog.js', async route => {
    const response = await route.fetch(), source = await response.text();
    const hook = `;(()=>{const original=HaedoLife.Blog;HaedoLife.Blog=Object.freeze({...original,async hydrate(...values){const result=await original.hydrate(...values);if(window.__preservationInstalling&&window.__preservationHoldDecode){window.__preservationDecodeHeld=true;await new Promise(resolve=>window.__preservationReleaseDecode=()=>{window.__preservationHoldDecode=false;resolve();});}return result;}});})();`;
    await route.fulfill({ response, body: source + hook });
  });
  await context.route('**/*', route => { const origin = new URL(route.request().url()).origin;
    if ([new URL(base).origin, cloud].includes(origin)) return route.fallback(); report.external.push(origin); return route.abort(); });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push(event.text()); });
  const check = async (name, run) => { console.log('START ' + name); await run(); report.checks.push(name); console.log('PASS ' + name); };
  const enter = async () => { await nav(page, 'manage'); await page.locator('#lifePreservationOpen').click(); await page.locator('#lifePreservation[data-state="ready"]').waitFor(); };
  const prepare = async fixture => {
    await page.locator('#preservationPostSelection input[data-post-id="' + fixture.postId + '"]').check();
    await page.locator('#preservationBoardSelection input[data-board-id="' + fixture.boardId + '"]').check();
    await page.locator('#preservationPrepareExport').click(); await page.locator('#preservationExportReview[data-state="ready"]').waitFor();
  };
  const load = async (bytes, name = 'selected-preservation.zip') => {
    await page.locator('#preservationFile').setInputFiles({ name, mimeType: 'application/zip', buffer: Buffer.from(bytes) });
    await page.locator('#preservationImportReview[data-state="ready"]').waitFor();
  };
  const capture = async scene => {
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready);
      const metrics = await page.evaluate(inspect);
      assert.equal(metrics.horizontalOverflow, false); for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ' ' + key);
      const file = scene + '-' + width + '.png'; await page.screenshot({ path: path.join(out, file), fullPage: true }); report.visual.push({ scene, width, file, metrics });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  };
  let fixture, original, archive, manifest;
  try {
    await page.goto(base + '/index.html'); await ready(page); fixture = await seed(page); original = await state(page, fixture.workspaceId);
    await page.reload(); await ready(page);
    await check('Management inventory and explicit selection preserve every original and require a separate file download', async () => {
      await enter(); assert.equal(await page.locator('#lifePreservation input[type="checkbox"]:checked').count(), 0);
      assert.equal(await page.locator('#preservationPostSelection input[data-post-id]').count(), 3, 'Unsaved drafts must not be export candidates');
      assert.equal(await page.locator('#preservationBoardSelection input[data-board-id]').count(), 2);
      await capture('inventory');
      await page.locator('#preservationPostSelection input[data-post-id="' + fixture.postId + '"]').check();
      const jumpBefore = await page.evaluate(() => {
        window.__preservationJumpRoot = document.querySelector('#lifePreservation');
        window.__preservationJumpTarget = document.querySelector('#preservationTransport');
        return { url: location.href, selected: [...__preservationJumpRoot.querySelectorAll('input[data-post-id]:checked')].map(input => input.dataset.postId) };
      });
      await page.locator('a[href="#preservationTransport"]').click();
      await page.waitForFunction(() => document.activeElement === window.__preservationJumpTarget);
      const jumpAfter = await page.evaluate(() => ({ url: location.href,
        selected: [...document.querySelectorAll('#lifePreservation input[data-post-id]:checked')].map(input => input.dataset.postId),
        sameRoot: __preservationJumpRoot === document.querySelector('#lifePreservation'),
        sameTarget: __preservationJumpTarget === document.querySelector('#preservationTransport') }));
      assert.equal(jumpAfter.url, jumpBefore.url, 'An in-page jump must not re-enter the app router through fragment history');
      assert.equal(jumpAfter.sameRoot, true); assert.equal(jumpAfter.sameTarget, true);
      assert.deepEqual(jumpAfter.selected, [fixture.postId]); assert.deepEqual(jumpAfter.selected, jumpBefore.selected);
      await page.locator('#preservationPostSelection input[data-post-id="' + fixture.postId + '"]').uncheck();
      assert.equal(await page.locator('#lifePreservation input[type="checkbox"]:checked').count(), 0);
      assert.deepEqual(await state(page, fixture.workspaceId), original); await prepare(fixture);
      assert.match(await page.locator('#preservationExportReview').innerText(), /9칸이 참조한 저장 글/);
      assert.deepEqual(await state(page, fixture.workspaceId), original); await capture('selected-review');
      const event = page.waitForEvent('download'); await page.locator('#preservationDownload').click();
      archive = Buffer.from(await fs.readFile(await (await event).path()));
      const files = Z.unzipSync(archive); manifest = JSON.parse(Z.strFromU8(files['manifest.json']));
      assert.equal(manifest.format, 'life-preservation-package-v1'); assert.equal(manifest.posts.length, 2);
      assert.deepEqual(manifest.posts.map(p => p.doc.id).sort(), [fixture.postId, fixture.dependencyId].sort());
      assert.equal(manifest.nineBoard.boards.length, 1); assert.equal(manifest.nineBoard.boards[0].id, fixture.boardId);
      assert.equal(manifest.bundle.sources.length, 1); assert.equal(manifest.bundle.sourceVersions.length, 1);
      assert.equal(manifest.bundle.sourceVersions[0].id, fixture.oldVersionId); assert.equal(manifest.bundle.sourceVersions[0].contentText, fixture.raw);
      const originalSource = original.bundle.sources.find(source => source.id === fixture.sourceId);
      const originalVersion = original.bundle.sourceVersions.find(version => version.id === fixture.oldVersionId);
      assert.deepEqual(manifest.bundle.sources[0], originalSource); assert.deepEqual(manifest.bundle.sourceVersions[0], originalVersion);
      assert.equal(hash(Buffer.from(fixture.raw)), manifest.bundle.sourceVersions[0].contentHash);
      for (const key of ['records', 'links', 'resumeHints']) assert.deepEqual(manifest.bundle[key], []);
      const encoded = JSON.stringify(manifest);
      for (const excluded of ['PRIVATE_RECORD_SENTINEL', 'UNSELECTED_SOURCE_SENTINEL', 'UNSELECTED_BODY_SENTINEL', 'UNSELECTED_POST_SENTINEL', 'UNSELECTED_POST_BODY_SENTINEL', 'UNSELECTED_BOARD_SENTINEL', 'UNSELECTED_AREA_NOTE_SENTINEL', 'UNSAVED_DRAFT_SENTINEL', 'PRIVATE_REMOTE_ID_SENTINEL', 'PRIVATE_PUBLIC_TOKEN_SENTINEL', 'LATEST_VERSION_MUST_NOT_REPLACE_OLD']) assert(!encoded.includes(excluded), excluded);
      assert(encoded.includes('SELECTED_AREA_NOTE_KEEP'));
      const expectedPaths = ['manifest.json'];
      for (const p of fixture.photoHashes) { const name = 'photos/' + fixture.postId + '/' + p.id; expectedPaths.push(name); assert.equal(hash(files[name]), p.digest); assert.equal(files[name].length, p.size); }
      assert.deepEqual(Object.keys(files).sort(), expectedPaths.sort());
      assert.deepEqual(await state(page, fixture.workspaceId), original);
    });
    await check('Changed photos, false pixel declarations, exact-source text, reference ranges and unknown ZIP paths cannot create a partial workspace', async () => {
      const before = await state(page, fixture.workspaceId), variants = [];
      const originalFiles = Z.unzipSync(archive), photoPath = 'photos/' + fixture.postId + '/' + fixture.photoHashes[0].id;
      const photos = { ...originalFiles, [photoPath]: originalFiles[photoPath].slice() }; photos[photoPath][photos[photoPath].length - 1] ^= 1; variants.push(photos);
      for (const change of [
        m => { m.bundle.sourceVersions[0].contentText += 'changed'; },
        m => { m.posts.find(p => p.doc.id === fixture.postId).evidence.refs[0].locator.start++; },
        // Original bytes/digest still match: only the actual image decoder can
        // disprove this otherwise valid positive dimension declaration.
        m => { m.posts.find(p => p.doc.id === fixture.postId).doc.photos[0].width++; },
      ]) {
        const m = structuredClone(manifest); change(m); variants.push({ ...originalFiles, 'manifest.json': Z.strToU8(JSON.stringify(m)) });
      }
      variants.push({ ...originalFiles, 'unexpected/private.txt': Z.strToU8('UNEXPECTED_PRIVATE_FILE') });
      for (let index = 0; index < variants.length; index++) {
        // A newer invalid file must also invalidate an older valid candidate.
        await load(archive);
        await page.locator('#preservationFile').setInputFiles({ name: 'changed-' + index + '.zip', mimeType: 'application/zip', buffer: Buffer.from(Z.zipSync(variants[index], { level: 0 })) });
        await page.locator('#preservationError:not([hidden])').waitFor();
        assert.equal(await page.locator('#preservationImportReview[data-state="ready"]').count(), 0);
        assert.deepEqual(await state(page, fixture.workspaceId), before);
      }
    });
    await check('An actual install transaction abort preserves the original, active workspace and file candidate for retry', async () => {
      await load(archive); const before = await state(page, fixture.workspaceId);
      await page.evaluate(() => { window.__preservationAdd = IDBObjectStore.prototype.add; IDBObjectStore.prototype.add = function (...args) {
        const result = __preservationAdd.apply(this, args); if (this.name === 'bundles') this.transaction.abort(); return result;
      }; });
      await page.locator('#preservationRestore').click(); await page.locator('#preservationError:not([hidden])').waitFor();
      assert.deepEqual(await state(page, fixture.workspaceId), before); assert.equal(await page.locator('#preservationImportReview[data-state="ready"]').count(), 1);
      await capture('failed-restore'); await page.evaluate(() => { IDBObjectStore.prototype.add = __preservationAdd; });
    });
    await check('Explicit restoration makes a private workspace with fresh IDs, exact originals and resolvable old-version and saved-post references', async () => {
      await page.locator('#preservationRestore').click();
      await page.waitForFunction(id => document.querySelector('#lifePreservation')?.dataset.restoreWorkspaceId && document.querySelector('#lifePreservation').dataset.restoreWorkspaceId !== id, fixture.workspaceId);
      const newId = await page.locator('#lifePreservation').getAttribute('data-restore-workspace-id');
      assert.equal(await page.locator('#lifePreservation input[type="checkbox"]:checked').count(), 0);
      const restored = await state(page, newId); assert.notEqual(newId, fixture.workspaceId);
      assert.equal(restored.bundle.sources.length, 1); assert.equal(restored.bundle.sourceVersions.length, 1);
      assert.notEqual(restored.bundle.sources[0].id, fixture.sourceId); assert.notEqual(restored.bundle.sourceVersions[0].id, fixture.oldVersionId);
      assert.equal(restored.bundle.sourceVersions[0].contentText, fixture.raw); assert.equal(restored.posts.length, 2);
      for (const post of restored.posts) { assert.equal(post.doc.status, 'saved'); assert.equal(post.doc.revision, 1); assert.equal(post.doc.replaces, null); assert.equal(post.blog, null); }
      const copiedPost = restored.posts.find(p => p.doc.title === '선택한 여행 사진 글');
      assert.notEqual(copiedPost.doc.id, fixture.postId);
      for (let i = 0; i < fixture.photoHashes.length; i++) { const got = copiedPost.doc.photos[i], expected = fixture.photoHashes[i];
        assert.notEqual(got.id, expected.id); for (const key of ['digest', 'size', 'width', 'height', 'name', 'type']) assert.equal(got[key], expected[key]); assert.equal(got.actualHash, expected.digest); }
      const sourceRef = copiedPost.evidence.refs[0]; assert.equal(sourceRef.workspaceId, newId); assert.equal(sourceRef.sourceVersionId, restored.bundle.sourceVersions[0].id);
      assert.deepEqual(sourceRef.locator, fixture.locator); assert.equal(sourceRef.quote, fixture.quote);
      const board = restored.nine.boards[0]; assert.notEqual(board.id, fixture.boardId); assert.equal(board.areas[0].note, 'SELECTED_AREA_NOTE_KEEP');
      assert.deepEqual(board.areas[0].items[0].reference.value, sourceRef);
      const copiedDependency = restored.posts.find(p => p.doc.title === '9칸이 참조한 저장 글'), postRef = board.areas[0].items[1].reference.value;
      assert.notEqual(copiedDependency.doc.id, fixture.dependencyId); assert.equal(postRef.workspaceId, newId); assert.equal(postRef.postId, copiedDependency.doc.id); assert.equal(postRef.postRevision, 1);
      const originalAgain = await state(page, fixture.workspaceId); delete originalAgain.spaces; delete originalAgain.active;
      const compare = structuredClone(original); delete compare.spaces; delete compare.active; assert.deepEqual(originalAgain, compare);
      await page.evaluate(async id => HaedoLife.Shell.storage.setActive(id), newId);
      await page.goto(base + '/index.html?section=records&view=page'); await ready(page); await page.locator('#wbPageNine').click(); await page.locator('.nb-status').waitFor();
      const sourceCell = page.locator('.nb-cell').nth(0); await sourceCell.getByText('보관한 근거', { exact: true }).click();
      await sourceCell.getByRole('button', { name: /^정확한 근거 열기/ }).click(); await page.locator('#lifeSourceText').waitFor();
      assert.equal(await page.locator('#lifeSourceText').textContent(), fixture.raw);
      // The file contains exactly the needed old version. A single-version
      // reader intentionally has no version picker; its sole body is exact.
      assert.equal(await page.locator('#lifeVersion').count(), 0);
      assert.match(await page.locator('.life-reader-meta').last().innerText(), /버전 1\/1/);
      await page.waitForFunction(({ quote, locator }) => { const text = document.querySelector('#lifeSourceText')?.firstChild, sel = getSelection(); if (!text || sel?.rangeCount !== 1) return false; const r = sel.getRangeAt(0); return r.startContainer === text && r.endContainer === text && r.startOffset === locator.start && r.endOffset === locator.end && sel.toString() === quote; }, fixture);
      await page.locator('#lifeSearchReturn').click(); await page.locator('.nb-status').waitFor();
      const postCell = page.locator('.nb-cell').nth(1); await postCell.getByText('보관한 근거', { exact: true }).click(); await postCell.getByRole('button', { name: /^정확한 근거 열기/ }).click();
      await page.getByRole('heading', { name: '9칸이 참조한 저장 글', exact: true }).waitFor(); await capture('restored-post-reference');
    });
    await check('A competing tab edit invalidates the reviewed export instead of silently downloading stale content', async () => {
      await page.evaluate(async id => HaedoLife.Shell.storage.setActive(id), fixture.workspaceId);
      await page.goto(base + '/index.html'); await ready(page); await enter(); await prepare(fixture);
      const other = await context.newPage();
      try {
        await other.goto(base + '/index.html'); await ready(other);
        await other.evaluate(async ({ workspaceId, postId }) => { const s = HaedoLife.Shell.storage, post = await s.readPhotoPost(workspaceId, postId);
          post.title = '다른 탭에서 먼저 저장한 여행 사진 글'; await s.savePhotoPost(workspaceId, post, post.revision);
        }, fixture);
      } finally { await other.close(); }
      const latest = await state(page, fixture.workspaceId), downloads = [];
      const recordDownload = value => downloads.push(value); page.on('download', recordDownload);
      try {
        await page.locator('#preservationDownload').click(); await page.locator('#preservationError:not([hidden])').waitFor();
        assert.match(await page.locator('#preservationError').innerText(), /바뀌|다시 확인/);
        assert.equal(downloads.length, 0); assert.deepEqual(await state(page, fixture.workspaceId), latest);
      } finally { page.off('download', recordDownload); }
      await page.locator('#preservationRefresh').click(); await page.locator('#lifePreservation[data-state="ready"]').waitFor(); await prepare(fixture);
      assert.match(await page.locator('#preservationExportReview').innerText(), /다른 탭에서 먼저 저장한/);
      assert.deepEqual(await state(page, fixture.workspaceId), latest);
    });
    await check('One unreadable inventory category remains unknown while other categories and choices survive and can be retried', async () => {
      const before = await state(page, fixture.workspaceId);
      await page.evaluate(() => { window.__preservationFailWorkbench = true; });
      await page.locator('#preservationRefresh').click();
      await page.locator('[data-preservation-key="workbench"][data-state="error"]').waitFor();
      const failed = page.locator('[data-preservation-key="workbench"]');
      assert.match(await failed.innerText(), /확인 못함|읽기 실패/); assert(!/\b0개/.test(await failed.innerText()));
      for (const key of ['sources', 'photoPosts', 'nineBoard']) await page.locator('[data-preservation-key="' + key + '"][data-state="ready"]').waitFor();
      assert.equal(await page.locator('#preservationPostSelection input[data-post-id="' + fixture.postId + '"]').isChecked(), true);
      await capture('partial-inventory');
      await page.evaluate(() => { window.__preservationFailWorkbench = false; });
      await page.locator('#preservationRefresh').click(); await page.locator('[data-preservation-key="workbench"][data-state="ready"]').waitFor();
      assert.deepEqual(await state(page, fixture.workspaceId), before);
    });
    await check('A late old-account snapshot cannot render or install after signout, and another account cannot read its workspaces', async () => {
      await page.evaluate(() => { window.__preservationHoldSnapshot = true; });
      await page.locator('#preservationPrepareExport').click(); await page.waitForFunction(() => window.__preservationSnapshotHeld === true);
      const completed = await page.evaluate(() => window.__preservationSnapshotFinished || 0);
      await page.evaluate(() => { window.__preservationSignout = HaedoAuth.client.auth.signOut({ scope: 'local' }); });
      await page.waitForFunction(() => !HaedoLife.Shell.storage && document.querySelector('#lifeApp').hidden);
      await page.evaluate(() => window.__preservationReleaseSnapshot());
      await page.waitForFunction(before => window.__preservationSnapshotFinished > before, completed);
      assert.equal(await page.locator('#preservationExportReview,#preservationImportReview').count(), 0);
      assert(!(await page.locator('body').innerText()).includes('다른 탭에서 먼저 저장한 여행 사진 글'));
      assert.equal(await page.evaluate(() => HaedoAuth.user), null);
      server.oauthAccounts.set('preservation-a', accounts.b);
      await page.goto(base + '/login.html?next=index.html');
      await page.locator('#googleLogin').click();
      await page.waitForURL(url => url.pathname === '/index.html'); await ready(page);
      const blocked = await page.evaluate(async ({ workspaceId, postId }) => { const s = HaedoLife.Shell.storage; const rows = await s.listWorkspaces(); let readError = null;
        try { await s.readPreservationSnapshot(workspaceId, { postIds: [postId], boardIds: [] }); } catch (error) { readError = error.code; }
        return { ids: rows.map(row => row.workspaceId), readError };
      }, fixture);
      assert(!blocked.ids.includes(fixture.workspaceId)); assert.equal(blocked.readError, 'workspace_access_denied');
      await enter(); assert.equal(await page.locator('#preservationPostSelection input').count(), 0); assert.equal(await page.locator('#preservationBoardSelection input').count(), 0);
    });
    await check('Unowned direct-copy rechecks changed originals and newly claimed ownership after actual photo decoding, then copies only a fresh selection', async () => {
      const home = await page.evaluate(() => HaedoLife.Shell.storage.getActive());
      await page.evaluate(() => HaedoLife.Shell.storage.createWorkspace('합성 계정 연결 전 공간'));
      const old = await seed(page);
      await page.evaluate(id => HaedoLife.Shell.storage.setActive(id), home);
      await legacyRows(page, old.workspaceId, 'deleteOwner');
      await page.goto(base + '/index.html'); await ready(page); await enter();
      await page.locator('#preservationWorkspace').selectOption(old.workspaceId);
      await page.locator('#preservationPostSelection input[data-post-id="' + old.postId + '"]').waitFor(); await prepare(old);
      const activeBefore = await page.evaluate(() => HaedoLife.Shell.storage.getActive());
      const holdDecode = () => page.evaluate(() => { window.__preservationDecodeHeld = false; window.__preservationHoldDecode = true; });
      const releaseDecode = () => page.evaluate(() => window.__preservationReleaseDecode());
      await holdDecode(); await page.locator('#preservationRestorePrepared').click();
      await page.waitForFunction(() => window.__preservationDecodeHeld === true);
      // The actual image decoder has finished inside storage.install..., after
      // the service's last fresh() read; mutate the actual IDB before its commit.
      await legacyRows(page, old.workspaceId, 'editPost', old.postId);
      const changed = await legacyRows(page, old.workspaceId);
      await releaseDecode(); await page.locator('#preservationError:not([hidden])').waitFor();
      assert.match(await page.locator('#preservationError').innerText(), /바뀌|다시 확인/);
      assert.deepEqual(await legacyRows(page, old.workspaceId), changed);
      assert.equal(await page.evaluate(() => HaedoLife.Shell.storage.getActive()), activeBefore);
      assert(!changed.rows.some(row => row.key === 'owner:' + old.workspaceId), 'A failed copy cannot claim legacy ownership');
      await page.evaluate(() => {
        window.__preservationOldExportReview = document.querySelector('#preservationExportReview');
        window.__preservationHoldSnapshot = true; window.__preservationSnapshotHeld = false;
      });
      await page.locator('#preservationPrepareExport').click(); await page.waitForFunction(() => window.__preservationSnapshotHeld === true);
      assert.equal(await page.locator('#lifePreservation').getAttribute('data-state'), 'busy');
      assert.equal(await page.locator('#lifePreservation').getAttribute('aria-busy'), 'true');
      assert.equal(await page.evaluate(() => window.__preservationOldExportReview.isConnected), false);
      assert.equal(await page.locator('#preservationExportReview,#preservationDownload,#preservationRestorePrepared').count(), 0, 'Rechecking must remove the old candidate while the real snapshot read is held');
      await page.evaluate(() => { window.__preservationHoldSnapshot = false; window.__preservationReleaseSnapshot(); });
      await page.waitForFunction(() => {
        const review = document.querySelector('#preservationExportReview');
        return document.querySelector('#lifePreservation')?.dataset.state === 'ready' && review?.dataset.state === 'ready' && review !== window.__preservationOldExportReview;
      });
      assert.equal(await page.locator('#lifePreservation').getAttribute('aria-busy'), 'false');
      assert.match(await page.locator('#preservationExportReview').innerText(), /검증 도중 다른 창에서 바뀐/);
      await page.locator('#preservationRestorePrepared').click(); await page.locator('#preservationRestored').waitFor();
      const copiedId = await page.locator('#lifePreservation').getAttribute('data-restore-workspace-id');
      assert(copiedId && copiedId !== old.workspaceId); assert.equal(await page.locator('#lifePreservation input[type="checkbox"]:checked').count(), 0);
      const copied = await state(page, copiedId); assert.equal(copied.posts.length, 2);
      assert(copied.posts.some(row => row.doc.title === '검증 도중 다른 창에서 바뀐 계정 미연결 글'));
      const afterCopy = await legacyRows(page, old.workspaceId); assert.deepEqual(afterCopy.rows, changed.rows); assert.deepEqual(afterCopy.bundle, changed.bundle);
      assert.equal(afterCopy.workspaceIds.length, changed.workspaceIds.length + 1);
      await prepare(old); await holdDecode(); await page.locator('#preservationRestorePrepared').click();
      await page.waitForFunction(() => window.__preservationDecodeHeld === true);
      await legacyRows(page, old.workspaceId, 'setOwner', null, { projectUrl: cloud, userId: accounts.a.id });
      const claimed = await legacyRows(page, old.workspaceId), copiedActive = await page.evaluate(() => HaedoLife.Shell.storage.getActive());
      await releaseDecode(); await page.locator('#preservationError:not([hidden])').waitFor();
      assert.match(await page.locator('#preservationError').innerText(), /계정|연결|권한/);
      assert.deepEqual(await legacyRows(page, old.workspaceId), claimed);
      assert.equal(await page.evaluate(() => HaedoLife.Shell.storage.getActive()), copiedActive);
      await capture('unowned-race-refused');
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []);
    assert.equal(server.writes().length, 0); report.pass = true;
  } catch (error) { report.failure = error.stack; await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {}); throw error; }
  finally { await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { seed, state };

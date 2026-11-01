/* 설정 → 백업·복원 journey: actual app/SDK/IndexedDB and the downloaded ZIP.
 * Synthetic Auth and FakeCloud only. No production account, private file or
 * Apple device claim; 390px is Chromium viewport simulation. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4198';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready, settle, nav } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, base, cloud } = require('./life-sync-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const Z = require('../vendor/fflate/fflate.js');
const out = path.resolve(__dirname, '../.local/full-backup');
const sha = value => createHash('sha256').update(value).digest('hex');

// Two synthetic workspaces: exact old/new source versions, a composition group,
// folder, collection item, nine-slot board with exact evidence, a saved post with
// a HEIC original + JPEG view and a JPEG photo, a draft, settings and a timeline.
async function seed(page) {
  return page.evaluate(async uid => {
    const C = HaedoLife.Core, P = HaedoLife.PhotoPost, R = HaedoLife.SourceReference, N = HaedoLife.NineBoard, F = HaedoLife.SourceFolders,
      S = HaedoLife.DiscoverySettings, s = HaedoLife.Shell.storage, first = await s.getActive();
    async function addSource(workspaceId, title, text, extra) {
      let bundle = await s.read(workspaceId);
      const prepared = await C.prepareImport({ origin: 'obsidian', title, text, authorRelation: 'self' }, bundle);
      let result = await s.commitLocal({ workspaceId, operationId: C.id(), baseRevision: bundle.revision, changes: C.buildImportChanges(bundle, prepared, [{ start: 0, end: 2, topic: '검증', note: '비공개 메모' }]) });
      if (result.status !== 'stored') throw Error('source fixture');
      if (extra) {
        bundle = await s.read(workspaceId);
        const next = await C.prepareImport({ origin: 'obsidian', title, text: extra, existingSourceId: prepared.source.id, authorRelation: 'self' }, bundle);
        result = await s.commitLocal({ workspaceId, operationId: C.id(), baseRevision: bundle.revision, changes: C.buildImportChanges(bundle, next) });
        if (result.status !== 'stored') throw Error('source version fixture');
      }
      return prepared;
    }
    async function canvasBlob(width, height, type, color) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const g = canvas.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, width, height); g.fillStyle = '#111'; g.fillRect(10, 10, 40, 40);
      return new Promise(resolve => canvas.toBlob(resolve, type, 0.92));
    }
    async function pixel(blob) {
      const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const g = canvas.getContext('2d'); g.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, height: bitmap.height, center: Array.from(g.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data), corner: Array.from(g.getImageData(20, 20, 1, 1).data) };
    }
    const old = await addSource(first, '산책 원문', '옛 문장 그대로 남긴 산책 기록🌿', '새로 고친 산책 기록');
    const bundle = await s.read(first);
    const ref = await R.build({ bundle, sourceId: old.source.id, versionId: old.version.id, locator: { start: 0, end: 6 } });
    const wb = await s.readWorkbench(first); wb.groups.push({ id: C.id(), title: '옛 산책 묶음', versionIds: [old.version.id] }); await s.saveWorkbench(first, wb, wb.revision);
    let folders = F.createFolder(await s.readSourceFolders(first), { name: '산책', parentId: null });
    folders = F.assignSources(folders, [old.source.id], folders.folders[0].id); await s.saveSourceFolders(first, folders, folders.revision);
    const collection = await s.readCollection(first);
    collection.items.push(HaedoLife.Collection.fromAttachment({ type: 'book', title: '익명 책', creator: '익명 작가', url: '' }, C.id(), new Date().toISOString()));
    await s.saveCollection(first, collection, collection.revision);
    const board = N.create(C.id); board.title = '아홉 칸 구성'; board.areas[0].title = '근거';
    board.areas[0].items = [N.evidenceSnapshot({ kind: 'source', value: ref })]; board.areas[0].items[0].reason = '고른 이유';
    await s.saveNineBoard(first, { format: 'life-nine-board-v2', workspaceId: first, revision: 0, boards: [board] }, 0);
    const heicBytes = new Uint8Array(64); heicBytes.set([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99, 0, 0, 0, 0, 109, 105, 102, 49, 104, 101, 105, 99]);
    for (let i = 24; i < 64; i++) heicBytes[i] = (i * 37) & 255;
    const heicOriginal = new Blob([heicBytes], { type: 'image/heic' }), view = await canvasBlob(800, 600, 'image/jpeg', '#3a7d6b');
    const heic = { id: C.id(), name: 'IMG_0001.HEIC', type: 'image/heic', width: 800, height: 600, size: heicOriginal.size, digest: await P.digest(heicOriginal), blob: heicOriginal,
      view: { type: 'image/jpeg', size: view.size, digest: await P.digest(view), width: 800, height: 600, blob: view } };
    const jpeg = await P.readPhoto(new File([await canvasBlob(1200, 900, 'image/jpeg', '#d9c4a1')], '익명 풍경.jpg', { type: 'image/jpeg' }), C.id);
    const doc = P.create(C.id); doc.title = '저장한 사진 글'; doc.status = 'saved'; doc.photos = [heic, jpeg];
    doc.ops = [{ insert: '여행의 생각🌿\n' }, ...[heic, jpeg].flatMap(p => [{ insert: { photo: { id: p.id, caption: '설명', alt: '합성 사진' } } }, { insert: '\n' }])];
    const saved = await s.savePhotoPostWithEvidence(first, doc, 0, [ref], 0);
    const second = (await s.createWorkspace('두 번째 자료공간')).workspaceId;
    await s.setActive(first);
    await addSource(second, '두 번째 원문', '두 번째 공간의 원문입니다.');
    const draft = P.create(C.id); draft.title = '두 번째 공간 초안'; draft.ops = [{ insert: '초안 본문\n' }];
    await s.savePhotoPost(second, draft, 0);
    const settings = await s.readDiscoverySettings(first);
    await s.saveDiscoverySettings(first, S.update(settings, { autoRefresh: true }, { expectedRevision: settings.revision }), settings.revision);
    const keys = HaedoPlatformData.keys(uid);
    localStorage.setItem(keys.registry, JSON.stringify({ docs: [{ id: 'd_fixture', name: '익명 연표', updated: '2026-11-01T00:00:00.000Z' }], current: 'd_fixture' }));
    localStorage.setItem(keys.docs + 'd_fixture', JSON.stringify({ profile: { name: '익명 연표', birth: '1990-01' }, events: [] }));
    localStorage.setItem(keys.items, JSON.stringify([{ id: 'g1', kind: 'goal', data: { title: '익명 목표' } }]));
    const versions = (await s.read(first)).sourceVersions.map(v => ({ contentHash: v.contentHash, contentText: v.contentText }));
    return { first, second, savedId: saved.id, oldText: '옛 문장 그대로 남긴 산책 기록🌿', versions, heicDigest: heic.digest, viewDigest: heic.view.digest, jpegDigest: jpeg.digest,
      viewPixel: await pixel(view), jpegPixel: await pixel(jpeg.blob) };
  }, accounts.a.id);
}
// Everything stored for the account, with Blob digests instead of bytes.
async function accountState(page) {
  return page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, P = HaedoLife.PhotoPost, rows = [];
    for (const ws of await s.listWorkspaces()) {
      const posts = [];
      for (const row of await s.listPhotoPosts(ws.workspaceId)) {
        const doc = await s.readPhotoPost(ws.workspaceId, row.id);
        posts.push({ id: doc.id, title: doc.title, status: doc.status, revision: doc.revision, photos: await Promise.all(doc.photos.map(async p => ({ type: p.type, width: p.width, height: p.height,
          digest: await P.digest(p.blob), view: p.view ? { digest: await P.digest(p.view.blob), width: p.view.width } : null }))), evidence: await s.readPostEvidence(ws.workspaceId, row.id) });
      }
      rows.push({ workspaceId: ws.workspaceId, title: ws.title, bundle: await s.read(ws.workspaceId), workbench: await s.readWorkbench(ws.workspaceId),
        folders: await s.readSourceFolders(ws.workspaceId), collection: await s.readCollection(ws.workspaceId), nine: await s.readNineBoard(ws.workspaceId),
        settings: await s.readDiscoverySettings(ws.workspaceId), posts });
    }
    return { active: await s.getActive(), rows };
  });
}
async function openBackup(page) {
  await nav(page, 'manage');
  await page.getByRole('button', { name: '백업·복원', exact: true }).click(); await settle(page);
  await page.locator('#lifeMain[data-mode="backup"]').waitFor();
}

async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Only an explicit loopback test server is permitted');
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  openBrowser = browser;
  const report = { checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], browser: browser.version(),
    scope: 'Actual local app/SDK/IndexedDB, downloaded ZIP bytes and restore in a second, empty account context. Synthetic Auth/FakeCloud; Chromium viewport simulation; no Apple claim.' };
  const server = new FakeCloud();
  const watch = page => {
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', event => { if (event.type() === 'error' && !/^Failed to load resource/.test(event.text())) report.consoleErrors.push(event.text()); });
  };
  const guardExternal = async context => context.route('**/*', route => { const origin = new URL(route.request().url()).origin;
    if ([new URL(base).origin, cloud].includes(origin)) return route.fallback(); report.external.push(origin); return route.abort(); });
  const check = async (name, run) => { console.log('START ' + name); await run(); report.checks.push(name); console.log('PASS ' + name); };
  const capture = async (page, scene, widths = [390, 1440]) => {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      const metrics = await page.evaluate(inspect);
      assert.equal(metrics.horizontalOverflow, false, scene + ' overflow ' + width);
      for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ' ' + key + ' ' + width);
      const file = scene + '-' + width + '.png'; await page.screenshot({ path: path.join(out, file), fullPage: true }); report.visual.push({ scene, width, file });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  };
  const a = await makeContext(browser, server, 'full-backup-a', accounts.a, { viewport: { width: 1440, height: 1000 } });
  await guardExternal(a);
  const page = await a.newPage(); page.setDefaultTimeout(30000); watch(page);
  let fixture, archive, manifest, original;
  try {
    await page.goto(base + '/index.html'); await ready(page); fixture = await seed(page);
    await page.reload(); await ready(page);
    original = await accountState(page);

    await check('Settings shows one 백업·복원 entry; the screen lists every format with counts before download', async () => {
      await nav(page, 'manage');
      for (const removed of ['자료·구성 백업', '내보내기·사본 복원', '컬렉션 백업·복구', '보관 범위·근거 파일'])
        assert.equal(await page.getByRole('button', { name: removed, exact: true }).count(), 0, removed + ' moved off the settings screen');
      await openBackup(page);
      await page.locator('#fbInventory [data-kind="photoPosts"]').waitFor();
      const kinds = await page.locator('#fbInventory [data-kind]').evaluateAll(rows => rows.map(row => row.dataset.kind));
      assert.deepEqual(kinds, ['library', 'collection', 'photoPosts', 'nineBoards', 'materialWriting', 'accountDocuments', 'timeline']);
      // Kinds without a file format are named before download, with where they are kept.
      const excluded = await page.locator('#fbNotIncluded [data-not-included]').evaluateAll(rows => rows.map(row => row.dataset.notIncluded));
      assert.deepEqual(excluded.sort(), ['importDrafts', 'originalsServer', 'publication', 'sourceEditDrafts', 'writingDrafts']);
      assert.match(await page.locator('#fbNotIncluded').innerText(), /글쓰기 초안 0개/);
      assert.doesNotMatch(await page.locator('#fbDownload').innerText(), /모든 항목|전부 담/);
      assert.match(await page.locator('#fbInventory [data-kind="library"]').innerText(), /자료 2 · 원문 버전 3/);
      assert.match(await page.locator('#fbInventory [data-kind="library"]').innerText(), /자료공간 2개/);
      assert.match(await page.locator('#fbInventory [data-kind="photoPosts"]').innerText(), /글 2 · 사진 2/);
      assert.match(await page.locator('#fbInventory [data-kind="timeline"]').innerText(), /연표 1 · 목표 1/);
      assert.match(await page.locator('#fbEstimate').innerText(), /자료공간 2개 · 파일 \d+개/);
      for (const label of ['자료·구성 백업', '내보내기·사본 복원', '컬렉션 백업·복구', '보관 범위·근거 파일', '연간 계획 파일'])
        assert.equal(await page.getByRole('button', { name: label, exact: true }).isVisible(), true, label);
      assert.deepEqual(await accountState(page), original);
      await capture(page, 'backup-screen');
    });

    await check('모두 받기 downloads one ZIP: README/manifest list each file, format, version, counts and SHA-256; photo bytes are the originals', async () => {
      const download = page.waitForEvent('download'); await page.locator('#fbDownloadAll').click();
      const file = await download; archive = Buffer.from(await fs.readFile(await file.path()));
      assert.match(file.suggestedFilename(), /^haedo-backup-\d{4}-\d{2}-\d{2}\.zip$/);
      await page.locator('#fbDownloadDone').waitFor();
      assert.equal(await page.locator('#fbNotIncludedAfter [data-not-included]').count(), 5, 'the result repeats what the ZIP does not contain');
      const files = Z.unzipSync(archive); manifest = JSON.parse(Z.strFromU8(files['manifest.json']));
      assert.equal(manifest.format, 'haedo-full-backup-v1'); assert.equal(manifest.complete, true); assert.equal(manifest.workspaces.length, 2);
      assert.deepEqual(Object.keys(files).sort(), ['README.txt', 'manifest.json', ...manifest.files.map(item => item.path)].sort());
      for (const item of manifest.files) assert.equal(sha(files[item.path]), item.sha256, item.path);
      const readme = Z.strFromU8(files['README.txt']);
      assert.match(readme, /하나의 형식이 아닙니다/); for (const item of manifest.files) assert.ok(readme.includes(item.path) && readme.includes(item.sha256));
      const post = manifest.files.find(item => item.postId === fixture.savedId), inner = Z.unzipSync(files[post.path]);
      const photos = JSON.parse(Z.strFromU8(inner['manifest.json'])).photos;
      assert.equal(sha(inner['photos/' + photos[0].id]), fixture.heicDigest); assert.equal(sha(inner['views/' + photos[0].id]), fixture.viewDigest);
      assert.equal(sha(inner['photos/' + photos[1].id]), fixture.jpegDigest);
      const result = await page.locator('#fbDownloadResult').innerText();
      assert.match(result, /하나의 형식이 아닙니다/); assert.match(result, /사진 글/); assert.match(result, /life-photo-post-backup-v2 v2/); assert.match(result, /연표·목표·습관/);
      assert.deepEqual(await accountState(page), original, 'downloading changed nothing');
      await fs.writeFile(path.join(out, 'downloaded-backup.zip'), archive);
    });

    await check('Old direct addresses still open the exact format screen and return to 백업·복원 with that row focused', async () => {
      await page.goto(base + '/index.html?section=manage&view=transfer'); await ready(page); await settle(page);
      await page.locator('#lifeMain[data-mode="transfer"]').waitFor();
      await page.getByRole('button', { name: '백업·복원으로 돌아가기', exact: true }).click(); await settle(page);
      await page.locator('#lifeMain[data-mode="backup"]').waitFor();
      await page.waitForFunction(() => document.activeElement?.dataset.focusKey === 'backup:transfer');
      await page.goto(base + '/index.html?section=manage#lifeBackupMaterials'); await ready(page); await settle(page);
      await page.locator('#lifeMain[data-mode="backup"]').waitFor();
      await page.getByRole('button', { name: '자료·구성 백업', exact: true }).click(); await settle(page);
      await page.locator('#wbBackupDownload').waitFor();
      await page.locator('[data-subview-return]').click(); await settle(page);
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '자료·구성 백업');
    });

    await check('Restoring into the same account: the button stays off after the restore, and reopening the same file warns and needs a confirmation', async () => {
      const before = await accountState(page);
      await page.goto(base + '/index.html'); await ready(page); await openBackup(page);
      await page.locator('#fbRestoreFile').setInputFiles({ name: 'haedo-backup.zip', mimeType: 'application/zip', buffer: archive });
      await page.locator('#fbRestoreHeading').waitFor();
      assert.equal(await page.locator('#fbRepeatWarning').count(), 0, 'a first restore has no warning');
      await page.locator('#fbRestoreRun').click();
      await page.locator('#fbRestoreResultHeading').waitFor();
      const statuses = await page.locator('#fbRestoreReport [data-status]').evaluateAll(rows => rows.map(row => row.dataset.status));
      assert.deepEqual(statuses.filter(status => status !== 'restored'), []);
      assert.equal(await page.locator('#fbRestoreRun').isDisabled(), true, 'the same opened file cannot run again');
      const after = await accountState(page);
      assert.equal(after.rows.length, before.rows.length + 2, 'one new copy per original workspace');
      for (const row of before.rows) assert.deepEqual(after.rows.find(item => item.workspaceId === row.workspaceId), row, 'existing workspaces unchanged');
      assert.equal(after.active, before.active);
      // Reopening the same backup on this account warns with the date and requires an explicit confirmation.
      await page.locator('#fbRestoreFile').setInputFiles({ name: 'haedo-backup-again.zip', mimeType: 'application/zip', buffer: archive });
      await page.locator('#fbRepeatWarning').waitFor();
      assert.match(await page.locator('#fbRepeatWarning').innerText(), /이미 복원했습니다/);
      assert.match(await page.locator('#fbRepeatWarning').innerText(), /\d{4}\. \d{1,2}\. \d{1,2}\./);
      assert.equal(await page.locator('#fbRestoreRun').isDisabled(), true);
      await page.locator('#fbRepeatConfirm').check();
      assert.equal(await page.locator('#fbRestoreRun').isDisabled(), false);
      await page.locator('#fbRepeatConfirm').uncheck();
      assert.equal(await page.locator('#fbRestoreRun').isDisabled(), true);
      assert.deepEqual(await accountState(page), after, 'opening the file again writes nothing');
      await capture(page, 'repeat-warning', [390]);
    });
  } finally { await a.close(); }

  const b = await makeContext(browser, server, 'full-backup-b', accounts.b, { viewport: { width: 1440, height: 1000 } });
  await guardExternal(b);
  const target = await b.newPage(); target.setDefaultTimeout(30000); watch(target);
  try {
    await target.goto(base + '/index.html'); await ready(target);
    await target.evaluate(async () => {
      const C = HaedoLife.Core, s = HaedoLife.Shell.storage, workspaceId = await s.getActive(), bundle = await s.read(workspaceId);
      const prepared = await C.prepareImport({ origin: 'obsidian', title: '원래 있던 원문', text: '복원 전부터 있던 원문입니다.', authorRelation: 'self' }, bundle);
      await s.commitLocal({ workspaceId, operationId: C.id(), baseRevision: bundle.revision, changes: C.buildImportChanges(bundle, prepared) });
    });
    await target.reload(); await ready(target);
    const before = await accountState(target);
    assert.equal(before.rows.length, 1);

    await check('A tampered bundle is rejected with the failing file named and nothing written', async () => {
      const files = Z.unzipSync(archive), item = manifest.files.find(row => row.kind === 'photoPosts');
      const changed = { ...files, [item.path]: Uint8Array.from(files[item.path], (byte, i) => i === 50 ? byte ^ 1 : byte) };
      await openBackup(target);
      await target.locator('#fbRestoreFile').setInputFiles({ name: 'changed.zip', mimeType: 'application/zip', buffer: Buffer.from(Z.zipSync(changed, { level: 0 })) });
      await target.locator('#fbRestoreError').waitFor();
      assert.match(await target.locator('#fbRestoreError').innerText(), /SHA-256과 다릅니다/);
      assert.equal(await target.locator('#fbRestoreRun').count(), 0);
      assert.deepEqual(await accountState(target), before);
    });

    await check('Restore into another account creates new copies with exact versions and identical photo bytes/pixels; existing data untouched', async () => {
      await target.locator('#fbRestoreFile').setInputFiles({ name: 'haedo-backup.zip', mimeType: 'application/zip', buffer: archive });
      await target.locator('#fbRestoreHeading').waitFor();
      const preview = await target.locator('#fbRestorePreview').innerText();
      assert.match(preview, /해도 백업 ZIP \(목록 v2\)/); assert.match(preview, /SHA-256 확인 완료/); assert.match(preview, /haedo-full-backup-v1|파일 \d+개/);
      const choices = await target.locator('#fbRestorePreview input[type=checkbox]').evaluateAll(inputs => inputs.map(input => [input.value, input.checked]));
      assert.deepEqual(choices, [['library', true], ['collection', true], ['photoPosts', true], ['nineBoards', true], ['materialWriting', true], ['accountDocuments', true]]);
      assert.equal(await target.locator('#fbRestoreNotIncluded [data-not-included]').count(), 5);
      assert.match(await target.locator('#fbRestorePreview [data-kind="timeline"]').innerText(), /이 화면에서는 복원하지 않습니다/);
      assert.equal(await target.locator('#fbRestorePreview a[href="workspace.html?section=manage#backupAll"]').count(), 1);
      await capture(target, 'restore-preview', [390]);
      await target.locator('#fbRestoreRun').click();
      await target.locator('#fbRestoreResultHeading').waitFor();
      const statuses = await target.locator('#fbRestoreReport [data-status]').evaluateAll(rows => rows.map(row => [row.dataset.kind, row.dataset.status]));
      assert.ok(statuses.length >= 6); assert.deepEqual(statuses.filter(([, status]) => status !== 'restored'), []);
      assert.match(await target.locator('#fbRestoreResult').innerText(), /새 자료공간 2개/);
      const after = await accountState(target);
      assert.equal(after.active, before.active, 'the workspace in use stays active');
      assert.deepEqual(after.rows.find(row => row.workspaceId === before.rows[0].workspaceId), before.rows[0], 'existing workspace unchanged');
      assert.equal(after.rows.length, 3);
      const copy = after.rows.find(row => row.title === '첫 자료공간' || row.bundle.sources.some(source => source.title === '산책 원문'));
      assert.deepEqual(copy.bundle.sourceVersions.map(v => ({ contentHash: v.contentHash, contentText: v.contentText })), fixture.versions);
      const oldCopy = copy.bundle.sourceVersions.find(v => v.contentText === fixture.oldText);
      assert.deepEqual(copy.workbench.groups[0].versionIds, [oldCopy.id]);
      assert.equal(copy.folders.folders.length, 1); assert.equal(copy.collection.items.length, 1);
      assert.equal(copy.nine.boards[0].areas[0].items[0].reference.value.sourceVersionId, oldCopy.id);
      assert.equal(copy.settings.autoRefresh, true);
      const post = copy.posts.find(row => row.title === '저장한 사진 글');
      assert.equal(post.status, 'saved'); assert.notEqual(post.id, fixture.savedId);
      assert.deepEqual(post.photos.map(p => [p.type, p.digest]), [['image/heic', fixture.heicDigest], ['image/jpeg', fixture.jpegDigest]]);
      assert.equal(post.photos[0].view.digest, fixture.viewDigest);
      assert.equal(post.evidence.refs[0].sourceVersionId, oldCopy.id);
      const pixels = await target.evaluate(async ({ workspaceId, postId }) => {
        const s = HaedoLife.Shell.storage, doc = await s.readPhotoPost(workspaceId, postId);
        async function pixel(blob) {
          const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
          const g = canvas.getContext('2d'); g.drawImage(bitmap, 0, 0);
          return { width: bitmap.width, height: bitmap.height, center: Array.from(g.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data), corner: Array.from(g.getImageData(20, 20, 1, 1).data) };
        }
        return { view: await pixel(doc.photos[0].view.blob), jpeg: await pixel(doc.photos[1].blob) };
      }, { workspaceId: copy.workspaceId, postId: post.id });
      assert.deepEqual(pixels.view, fixture.viewPixel); assert.deepEqual(pixels.jpeg, fixture.jpegPixel);
      const secondCopy = after.rows.find(row => row.bundle.sources.some(source => source.title === '두 번째 원문'));
      assert.equal(secondCopy.posts[0].status, 'draft');
      await capture(target, 'restore-result');
    });

    await check('The result opens a restored copy; the previous workspace remains', async () => {
      const open = target.locator('#fbRestoreResult button[data-workspace-id]').first();
      const id = await open.getAttribute('data-workspace-id'); await open.click(); await settle(target);
      await target.locator('#lifeMain[data-mode="sources"]').waitFor();
      assert.equal(await target.evaluate(() => HaedoLife.Shell.storage.getActive()), id);
      assert.equal((await target.evaluate(() => HaedoLife.Shell.storage.listWorkspaces())).length, 3);
    });
  } finally { await b.close(); }
  await browser.close();
  assert.deepEqual(report.external, []);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log('PASS full backup browser: ' + report.checks.length + ' checks');
}
let openBrowser = null;
// A failed check must not leave the browser (and this process) running.
main().catch(async error => { console.error(error.stack); process.exitCode = 1; await openBrowser?.close().catch(() => {}); });

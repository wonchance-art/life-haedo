/* Account materials: actual app, bundled SDK and IndexedDB with anonymous HTTP.
 * No personal corpus, operating database, live RLS or Apple-device claim. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, session, base, cloud } = require('./life-sync-browser.cjs');
const { databaseSnapshot } = require('./local-post-finder-browser.cjs');
const C = require('../assets/life/core.js');
const out = path.resolve('.local/account-materials');
const registryId = '99999999-9999-4999-8999-999999999999';
const quote = '정확한 옛 구절🌱';
const oldText = '\ufeff😀\r\n# 정확 목적지\r\n' + quote + '\r\n# 다른 목적지\r\n두 번째 위치';
const clone = value => structuredClone(value);
function gate() { let enter, release; return { entered: new Promise(r => { enter = r; }), released: new Promise(r => { release = r; }), enter: () => enter(), release: () => release() }; }
class MaterialsCloud extends FakeCloud {
  constructor(bundle) { super(); this.bundle = bundle; this.enabled = false; this.pin = 7; this.remoteRevision = 7; this.holdCorpus = null; }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/rest/v1/life_account_materials') {
      assert.equal(request.method(), 'GET', 'Registry is read only');
      const token = request.headers().authorization?.replace(/^Bearer /i, '');
      const owner = token ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub : null;
      assert.equal(url.searchParams.get('owner_id'), 'eq.' + owner);
      this.requests.push({ kind: 'materials-list', owner, device });
      return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(this.enabled && owner === accounts.a.id ? [{ id: registryId, owner_id: owner, workspace_id: this.bundle.workspaceId, workspace_revision: this.pin, revision: 1, enabled: true }] : []) });
    }
    if (url.pathname === '/rest/v1/life_workspaces' && url.searchParams.get('id') === 'eq.' + this.bundle.workspaceId) {
      assert.equal(request.method(), 'GET');
      this.requests.push({ kind: 'materials-read', device });
      const row = { id: this.bundle.workspaceId, owner_id: accounts.a.id, title: this.bundle.title, revision: this.remoteRevision, updated_at: this.bundle.updatedAt, data: clone(this.bundle) };
      if (this.holdCorpus) { const hold = this.holdCorpus; this.holdCorpus = null; hold.enter(); await hold.released; }
      return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([row]) });
    }
    return super.handle(route, device);
  }
}
async function corpus() {
  const { buildVault } = await import('../scripts/lib/obsidian-vault.mjs');
  const imported = await buildVault([
    ['시작.md', '\ufeff😀\r\n검색표식 [[대상#정확 목적지]] [[대상#다른 목적지]]'],
    ['대상.md', oldText], ['다른/대상.md', '동명 자료의 별도 원문'], ['빈자료.md', '']
  ].map(([path, text]) => ({ path, bytes: Buffer.from(text) })), { repositoryUrl: 'https://github.com/example/anonymous-materials', ref: 'a'.repeat(40), title: '합성 계정 원문' });
  let bundle = imported.notesBackup.workspace;
  const source = bundle.sources.find(s => s.sourceKey === '대상.md'), old = bundle.sourceVersions.find(v => v.sourceId === source.id);
  const prepared = await C.prepareImport({ origin: 'obsidian', existingSourceId: source.id, title: source.title, text: '# 새 제목\n옛 구절이 없는 새 버전' }, bundle);
  bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, prepared));
  return { bundle, start: bundle.sources.find(s => s.sourceKey === '시작.md').id, target: source.id, oldVersion: old.id, newVersion: prepared.version.id };
}
async function seed(page) {
  return page.evaluate(async () => {
    const L = HaedoLife, s = L.Shell.storage, C = L.Core; let b = await s.read(await s.getActive());
    for (let i = 0; i < 6; i++) {
      const p = await C.prepareImport({ origin: 'other', title: '기존 합성 자료 ' + i, text: '기존 원문과 개인 메모 ' + i, forceSeparate: true }, b);
      const r = await s.commitLocal({ workspaceId: b.workspaceId, operationId: C.id(), baseRevision: b.revision, changes: C.buildImportChanges(b, p, i === 0 ? [{ start: 0, end: 5, topic: '기존 주제', note: '보존할 기존 메모' }] : []) });
      if (r.status !== 'stored') throw Error('Existing fixture commit failed'); b = await s.read(b.workspaceId);
    }
    const canvas = document.createElement('canvas'); canvas.width = 4032; canvas.height = 3024;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#456b52'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const photo = await L.PhotoPost.readPhoto(new File([blob], 'synthetic-original.png', { type: 'image/png' }), C.id);
    const doc = L.PhotoPost.create(C.id); Object.assign(doc, { status: 'saved', title: '보존할 사진 글', photos: [photo], ops: [{ insert: '보존할 완성글\n' }, { insert: { photo: { id: photo.id, caption: '보존할 설명', alt: '합성 색면' } } }, { insert: '\n' }] });
    const saved = await s.savePhotoPost(b.workspaceId, doc, 0);
    const draft = L.PhotoPost.create(C.id); draft.title = '보존할 미완성글'; await s.savePhotoPost(b.workspaceId, draft, 0);
    return { workspaceId: b.workspaceId, bundle: b, postId: saved.id, original: { digest: photo.digest, size: photo.size, width: photo.width, height: photo.height } };
  });
}
async function preserved(page, seeded) {
  return page.evaluate(async f => {
    const s = HaedoLife.Shell.storage, b = await s.read(f.workspaceId), p = await s.readPhotoPost(f.workspaceId, f.postId);
    const hash = async blob => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(x => x.toString(16).padStart(2, '0')).join('');
    return { active: await s.getActive(), spaces: (await s.listWorkspaces()).map(w => w.workspaceId),
      old: Object.fromEntries(['sources', 'sourceVersions', 'records', 'links', 'resumeHints', 'tombstones'].map(k => [k, b[k].filter(row => f.bundle[k].some(old => old.id === row.id))])),
      posts: await s.listPhotoPosts(f.workspaceId), doc: { ...p, photos: await Promise.all(p.photos.map(async v => ({ ...v, blob: await hash(v.blob) }))) },
      workbench: await s.readWorkbench(f.workspaceId), stages: await s.listStages(f.workspaceId), sync: await s.getSyncState(f.workspaceId) };
  }, seeded);
}
async function register(page, workspaceId) {
  return page.evaluate(async ws => {
    const m = HaedoLife.AccountMaterials.create({ storage: HaedoLife.Shell.storage, auth: HaedoAuth, core: HaedoLife.Core });
    try { return await m.register(ws); } catch (e) { return { error: e.code || e.message }; } finally { m.dispose(); }
  }, workspaceId);
}
async function sources(page) { await page.goto(base + '/index.html?section=records&view=sources'); await ready(page); await settle(page); await page.locator('#lifeSearch').waitFor(); }
async function main() {
  await fs.mkdir(out, { recursive: true });
  const f = await corpus(), browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const report = { scope: 'Real bundled SDK and IndexedDB; synthetic Auth/read-only registry HTTP. No live SQL/RLS, personal corpus, operating writes or Apple hardware proof.', checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [] };
  async function check(name, action) {
    if (process.env.ACCOUNT_MATERIALS_MATCH && !new RegExp(process.env.ACCOUNT_MATERIALS_MATCH).test(name)) return;
    const server = new MaterialsCloud(clone(f.bundle)), context = await makeContext(browser, server, 'materials-' + report.checks.length, accounts.a, { viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('console', e => { if (e.type() === 'error') report.consoleErrors.push(e.text()); }); page.on('pageerror', e => report.pageErrors.push(e.message));
    await context.route('**/*', route => { if ([new URL(base).origin, cloud].includes(new URL(route.request().url()).origin)) return route.fallback(); report.external.push(new URL(route.request().url()).origin); return route.abort(); });
    try { await sources(page); const seeded = await seed(page); await action({ page, context, server, seeded }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true, remoteWrites: server.writes().length, registryReads: server.requests.filter(r => r.kind === 'materials-list').length, corpusReads: server.requests.filter(r => r.kind === 'materials-read').length }); console.log('PASS ' + name); }
    catch (e) { report.checks.push({ name, pass: false, error: e.stack }); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); throw e; }
    finally { await context.close(); }
  }
  try {
    await check('Existing six materials and original photo survive ordinary bootstrap, exact search, note links, excerpt and idempotent re-entry', async ({ page, server, seeded }) => {
      const before = await preserved(page, seeded); server.enabled = true;
      assert.equal(before.doc.photos[0].blob, seeded.original.digest);
      assert.equal(seeded.original.width, 4032); assert.equal(seeded.original.height, 3024);
      await sources(page);
      assert.deepEqual(await preserved(page, seeded), before);
      const current = await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.read(await s.getActive()); });
      assert.equal(current.sources.length, 6 + f.bundle.sources.length);
      for (const kind of ['sources', 'sourceVersions', 'links']) for (const row of f.bundle[kind]) assert.deepEqual(current[kind].find(v => v.id === row.id), row);
      await page.locator('#lifeFindOpen').click(); await page.locator('#lifeFind[aria-busy="false"]').waitFor(); await page.locator('#lifeFindQuery').fill(quote);
      await page.locator('.life-find-result[data-kind="source"][data-focus-key="find:source:' + f.oldVersion + '"]').click();
      assert.equal(await page.locator('#lifeSourceText').textContent(), oldText);
      await sources(page);
      await page.locator('#lifeSearch').fill('검색표식'); await page.locator('.life-source-open[data-source-id="' + f.start + '"]').click();
      await page.locator('.life-obsidian-links > summary').click();
      const target = page.locator('.life-obsidian-links .life-backup-source').filter({ hasText: '# 정확 목적지' }).locator('[data-linked-version="' + f.oldVersion + '"]');
      await target.click(); await page.waitForFunction(() => getSelection()?.toString() === '# 정확 목적지');
      assert.equal(await page.locator('#lifeSourceText').textContent(), oldText); assert.equal(await page.locator('#lifeVersion').inputValue(), f.oldVersion);
      assert.notEqual(f.oldVersion, f.newVersion);
      await page.locator('#lifeSearchReturn').click(); assert.equal(await page.locator('#lifeSearch').inputValue(), '검색표식');
      await page.locator('.life-source-open[data-source-id="' + f.start + '"]').click(); await page.locator('.life-obsidian-links > summary').click();
      await page.locator('.life-obsidian-links .life-backup-source').filter({ hasText: '# 다른 목적지' }).locator('[data-linked-version="' + f.oldVersion + '"]').click();
      await page.waitForFunction(() => getSelection()?.toString() === '# 다른 목적지');
      assert.equal(await page.locator('#lifeVersion').inputValue(), f.oldVersion); assert.equal(await page.locator('#lifeSourceText').textContent(), oldText);
      for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); const file = 'exact-material-' + width + '.png'; await page.screenshot({ path: path.join(out, file), fullPage: true }); report.visual.push(file); }
      await page.locator('#lifeSourceText').evaluate((el, text) => { const start = el.textContent.indexOf(text), r = document.createRange(); r.setStart(el.firstChild, start); r.setEnd(el.firstChild, start + text.length); el.focus(); getSelection().removeAllRanges(); getSelection().addRange(r); el.dispatchEvent(new Event('pointerup', { bubbles: true })); }, quote);
      await page.locator('#lifeExcerptToggle').click(); await page.locator('#lifeSourceTopic').fill('새 합성 주제'); await page.locator('#lifeSourceNote').fill('정확 원문 연결 메모'); await page.locator('#lifeSourceExcerptSave').click();
      await page.waitForFunction(async q => { const s = HaedoLife.Shell.storage; return (await s.read(await s.getActive())).records.some(r => r.text === q); }, quote);
      const saved = await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.read(await s.getActive()); });
      const record = saved.records.find(r => r.text === quote); assert.ok(record); assert.equal(record.sourceRefs[0].sourceVersionId, f.oldVersion); assert.equal(oldText.slice(record.sourceRefs[0].locator.start, record.sourceRefs[0].locator.end), quote);
      const snapshot = await databaseSnapshot(page), reads = server.requests.filter(r => r.kind === 'materials-read').length;
      const again = await register(page, seeded.workspaceId); assert.equal(again.status, 'already_registered'); await sources(page);
      assert.deepEqual(await databaseSnapshot(page), snapshot); assert.equal(server.requests.filter(r => r.kind === 'materials-read').length, reads, 'Durable registration skips corpus reads');
      const newOperation = await page.evaluate(async ({ ws, id }) => { const s = HaedoLife.Shell.storage, b = await s.read(ws), marker = await s.readAccountMaterialRegistration(ws, id); return s.commitLocal({ workspaceId: ws, baseRevision: b.revision, operationId: HaedoLife.Core.id(), changes: {}, accountMaterialRegistration: marker.descriptor }); }, { ws: seeded.workspaceId, id: registryId });
      assert.equal(newOperation.status, 'already_registered'); assert.deepEqual(await databaseSnapshot(page), snapshot, 'New operation ID must not add another receipt or advance revisions');
      assert.deepEqual(await preserved(page, seeded), before);
      report.originalPhoto = seeded.original;
    });
    await check('Actual IDB abort rolls back registration, same input retries once, and a second tab winning CAS is preserved', async ({ page, context, server, seeded }) => {
      const before = await databaseSnapshot(page); server.enabled = true;
      await page.evaluate(() => { window.__materialsAbort = true; window.__materialsAbortCount = 0; for (const method of ['put', 'add']) { const original = IDBObjectStore.prototype[method]; IDBObjectStore.prototype[method] = function(v, ...args) { const r = original.call(this, v, ...args); if (__materialsAbort && this.name === 'meta' && v?.key?.startsWith('account-material:')) { __materialsAbortCount++; this.transaction.abort(); } return r; }; } });
      const aborted = await register(page, seeded.workspaceId); assert.equal(aborted.error, 'storage_aborted'); assert.equal(await page.evaluate(() => __materialsAbortCount), 1); assert.deepEqual(await databaseSnapshot(page), before);
      await page.evaluate(() => { __materialsAbort = false; });
      const other = await context.newPage(); server.enabled = false; await sources(other); server.enabled = true;
      await page.evaluate(ws => { window.__materialsCommitHeld = false; window.__materialsRegistration = (async () => { const s = HaedoLife.Shell.storage; const wrapped = { ...s, async commitLocal(input) { window.__materialsCommitHeld = true; await new Promise(r => { window.__materialsCommitRelease = r; }); return s.commitLocal(input); } }; const m = HaedoLife.AccountMaterials.create({ storage: wrapped, auth: HaedoAuth, core: HaedoLife.Core }); try { return await m.register(ws); } catch(e) { return {error:e.code}; } finally {m.dispose();} })(); }, seeded.workspaceId);
      await page.waitForFunction(() => __materialsCommitHeld);
      const winner = await other.evaluate(async ws => { const s = HaedoLife.Shell.storage, b = await s.read(ws), p = await HaedoLife.Core.prepareImport({ origin: 'other', title: '다른 탭의 보존할 변경', text: '승자 입력', forceSeparate: true }, b); return s.commitLocal({ workspaceId: ws, operationId: HaedoLife.Core.id(), baseRevision: b.revision, changes: HaedoLife.Core.buildImportChanges(b,p) }); }, seeded.workspaceId);
      assert.equal(winner.status, 'stored'); const afterWinner = await databaseSnapshot(page);
      await page.evaluate(() => __materialsCommitRelease()); const conflict = await page.evaluate(() => __materialsRegistration); assert.equal(conflict.error, 'account_material_conflict'); assert.deepEqual(await databaseSnapshot(page), afterWinner);
      assert.equal((await register(page, seeded.workspaceId)).status, 'stored'); const once = await databaseSnapshot(page);
      assert.equal((await register(page, seeded.workspaceId)).status, 'already_registered'); assert.deepEqual(await databaseSnapshot(page), once);
      await other.close();
    });
    await check('Forged original SHA or revision pin fails closed, and delayed account A registration cannot write into account B', async ({ page, server, seeded }) => {
      const before = await databaseSnapshot(page); server.enabled = true; const original = clone(server.bundle);
      server.bundle.sourceVersions.find(v => v.contentText).contentText += '위조'; const hash = await register(page, seeded.workspaceId); assert.equal(hash.error, 'hash_mismatch'); assert.deepEqual(await databaseSnapshot(page), before);
      server.bundle = original; server.pin++; const pin = await register(page, seeded.workspaceId); assert.equal(pin.error, 'account_material_source_changed'); assert.deepEqual(await databaseSnapshot(page), before); server.pin--;
      const hold = gate(); server.holdCorpus = hold;
      await page.evaluate(ws => { window.__lateMaterial = (async () => { const m = HaedoLife.AccountMaterials.create({ storage: HaedoLife.Shell.storage, auth: HaedoAuth, core: HaedoLife.Core }); try { return await m.register(ws); } catch(e) { return {error:e.code}; } finally {m.dispose();} })(); }, seeded.workspaceId);
      await hold.entered;
      await page.evaluate(async value => { await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, session(accounts.b));
      await page.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell.storage?.account?.userId === id, accounts.b.id); await ready(page); await settle(page);
      const bBefore = await databaseSnapshot(page); hold.release(); const late = await page.evaluate(() => __lateMaterial); assert.ok(late.error); assert.deepEqual(await databaseSnapshot(page), bBefore);
      assert.equal(await page.locator('.life-source-open[data-source-id="' + f.start + '"]').count(), 0);
      const denied = await page.evaluate(async ws => { try { await HaedoLife.Shell.storage.read(ws); return null; } catch (e) { return e.code; } }, seeded.workspaceId);
      assert.equal(denied, 'workspace_access_denied'); assert.deepEqual(await databaseSnapshot(page), bBefore);
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } finally {
    report.sourceHashes = {};
    for (const file of ['assets/life/account-materials.js', 'assets/life/storage.js', 'assets/life/ui.js', 'assets/platform-auth.js', 'assets/platform-life-remote.js', 'sw.js']) report.sourceHashes[file] = createHash('sha256').update(await fs.readFile(path.resolve(__dirname, '..', file))).digest('hex');
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close();
  }
}
module.exports = { MaterialsCloud, corpus, seed, preserved, register };
if (require.main === module) main().catch(e => { console.error(e.stack); process.exitCode = 1; });

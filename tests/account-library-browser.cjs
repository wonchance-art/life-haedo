/* Default private account materials: real SDK, scoped IDB, anonymous intercepted
 * HTTP. Every device starts signed out. No enable/download/syncNow shortcuts.
 * BASE_URL=http://127.0.0.1:4173 node tests/account-library-browser.cjs */
'use strict';
const { openRecordsMenu } = require('./helpers/feature-menus.cjs');
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { CompositionCloud } = require('./composition-sync-browser.cjs');
const { accounts, cloud, base, openManagement } = require('./life-sync-browser.cjs');
const { playwright, ready, shellReady, settle, makeContext, nav } = require('./unified-home-browser.cjs');
const { fixture: originalFixture } = require('./fixtures/original-attachments.cjs');
const output = path.resolve(process.env.ACCOUNT_LIBRARY_OUTPUT || '.local/account-library');
const title = '익명 계정 자동 연동 자료', quote = '같은 원문의 두 번째 정확한 구절 🌱';
const raw = '\uFEFF---\r\ntitle: 익명 자동 연동\r\ntags: [언어, 독서]\r\n---\r\n\r\n# 익명 계정 본문\r\n\r\n' + quote + '\r\n\r\n' + quote + '\r\n';
const edited = raw.replace(/\r\n?/g, '\n') + '\n## 두 번째 기기의 수정\n정확한 이전 판은 그대로 보존합니다.\n';
const sha = value => createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const report = { createdAt: new Date().toISOString(), scope: 'Anonymous capability-1 account-default HTTP fixture, real bundled SDK and independent account-scoped IndexedDB contexts. Actual import/quote/folder/edit/original-file UI; explicitly labelled saved profile setup through actual storage. No manual sync enable/download/syncNow, production SQL/RLS, real accounts, personal vault, actual devices or OS file-save claim.', checks: [], visual: [], observations: [], consoleErrors: [], expectedConsoleErrors: [], pageErrors: [], externalRequests: [], forbiddenWrites: [], closedContexts: 0 };
async function waitFor(read, predicate, label) {
  const deadline = Date.now() + 15000; let last;
  do { last = await read(); if (predicate(last)) return last; await new Promise(done => setTimeout(done, 25)); } while (Date.now() < deadline);
  throw Error(label + ' did not arrive: ' + JSON.stringify(last));
}
const click = async (page, selector) => { await page.locator(selector).click(); await settle(page); };
const button = async (page, name) => { await page.getByRole('button', { name, exact: true }).click(); await settle(page); };
async function snapshot(page, id) {
  return page.evaluate(async id => { const s = HaedoLife.Shell.storage, workspaceId = id || await s.getActive(); return { bundle: await s.read(workspaceId), workbench: await s.readWorkbench(workspaceId), sourceFolders: await s.readSourceFolders(workspaceId), collection: await s.readCollection(workspaceId), nineBoard: await s.readNineBoard(workspaceId) }; }, id);
}
const state = (page, id) => page.evaluate(id => HaedoLife.Shell.accountLibrary.getState(id), id);
// Core's public manager deliberately omits outbox contents. Inspect the actual
// scoped persistence, as the original life-sync browser suite does; composition
// and metadata managers already expose their persisted state contract.
const domainState = (page, domain, id) => page.evaluate(({ domain, id }) => domain === 'sync' ? HaedoLife.Shell.storage.getSyncState(id) : HaedoLife.Shell[domain].getState(id), { domain, id });
const durableDirty = (page, id, domain) => page.evaluate(async ({ id, domain }) => { const h = HaedoLife.Shell, state = await h[domain].getState(id), revision = domain === 'sync' ? (await h.storage.read(id)).revision : (await h.storage.readLibraryMetaSnapshot(id)).metadata.revision, account = await h.accountLibrary.getState(id); return { state, revision, account }; }, { id, domain });
const synced = (page, id) => waitFor(() => state(page, id), value => value.mode === 'account' && value.status === 'synced' && ['sources', 'composition', 'metadata'].every(key => value.domains[key]?.status === 'synced'), 'Acknowledged account state');
const focus = page => page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
function semantic(value) { const result = copy(value); delete result.revision; return result; }
function exactGraph(actual, expected) { for (const key of Object.keys(expected)) assert.deepEqual(semantic(actual[key]), semantic(expected[key]), key + ': exact IDs, bytes and references'); }
async function reveal(control) { for (let n = await control.locator('xpath=ancestor::details').count(); n > 0; n--) { const el = control.locator('xpath=ancestor::details[' + n + ']'); if (!await el.evaluate(el => el.open)) await el.locator(':scope > summary').click(); } }
async function records(page) { await nav(page, 'records'); await page.locator('#lifeFolderFilter:enabled').waitFor(); }
async function importMarkdown(page, value = raw, name = title) {
  await records(page); await button(page, '가져오기'); await button(page, '텍스트 파일');
  await page.locator('#lifeImportFile').setInputFiles({ name: 'anonymous-account-' + sha(name).slice(0, 12) + '.md', mimeType: 'text/markdown', buffer: Buffer.from(value) }); await settle(page);
  for (const [key, text] of Object.entries({ Origin: 'obsidian', Title: name, Author: '익명 작성자', Relation: 'other', Coverage: 'partial', Omissions: '익명 합성 자료' })) { const field = page.locator('#lifeImport' + key); await reveal(field); if (['Origin', 'Relation', 'Coverage'].includes(key)) await field.selectOption(text); else await field.fill(text); }
  await button(page, '원문·출처 확인'); await button(page, '자료만 보관'); await page.locator('#lifeSourceInfoToggle').waitFor();
  const saved = await snapshot(page), source = saved.bundle.sources.find(item => item.title === name), version = saved.bundle.sourceVersions.filter(item => item.sourceId === source?.id).at(-1);
  assert(source && version); assert.equal(version.contentText, value); assert.equal(version.contentHash, sha(value)); return { id: saved.bundle.workspaceId, source, version };
}
async function reader(page, sourceId, versionId) { await records(page); await click(page, '.life-source-open[data-source-id="' + sourceId + '"]' + (versionId ? '[data-version-id="' + versionId + '"]' : '')); await page.locator('#lifeSourceInfoToggle').waitFor(); }
async function richProfile(page, f) {
  await click(page, '#lifeExcerptToggle'); await page.waitForFunction(() => document.querySelector('#lifeSourceText')?.dataset.readingMode === 'raw');
  const start = raw.lastIndexOf(quote), end = start + quote.length;
  await page.locator('#lifeSourceText').evaluate((el, range) => { if (el.firstChild?.nodeType !== Node.TEXT_NODE) throw Error('Exact raw Text node absent'); el.focus(); const r = document.createRange(); r.setStart(el.firstChild, range.start); r.setEnd(el.firstChild, range.end); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(r); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); }, { start, end });
  await page.locator('#lifeSourceTopic').fill('익명 언어와 독서'); await page.locator('#lifeSourceNote').fill('두 기기에서 보존할 익명 발췌'); await click(page, '#lifeSourceExcerptSave');
  await records(page); const parent = await folder(page, '익명 읽기'), child = await folder(page, '익명 언어', parent.id);
  const assignment = page.locator('.life-source-card[data-source-id="' + f.source.id + '"] [data-source-folder-assignment]').first(); await assignment.locator(':scope > summary').click(); await assignment.locator('[data-source-folder-destination]').selectOption(child.id); await assignment.locator('[data-source-folder-apply]').click();
  await waitFor(() => snapshot(page), value => value.sourceFolders.assignments.some(item => item.sourceId === f.source.id && item.folderId === child.id), 'Folder assignment');
  // Explicit fixture: use actual saved-domain models/storage; no wire seeding or
  // manager replacement. All automatic replication remains production code.
  await page.evaluate(async ({ id, sourceId, versionId, start, end }) => {
    const h = HaedoLife, s = h.Shell.storage, bundle = await s.read(id), wb = await s.readWorkbench(id);
    wb.groups.push({ id: h.Core.id(), title: '익명 자동 연동 묶음', versionIds: [versionId] }); wb.page.title = '익명 기기의 보관된 구성'; await s.saveWorkbench(id, wb, wb.revision);
    const collection = await s.readCollection(id), now = new Date().toISOString(); collection.items.push({ id: h.Core.id(), type: 'book', title: '익명 독서 자료', creator: '익명', url: '', note: '기기 사이에 보존할 메모', tags: ['독서'], details: { year: '2026' }, archived: false, createdAt: now, updatedAt: now }); await s.saveCollection(id, collection, collection.revision);
    const nine = await s.readNineBoard(id), board = h.NineBoard.create(h.Core.id); board.title = '익명 근거 9칸'; board.areas[0].title = '언어 학습';
    const ref = await h.SourceReference.build({ bundle, sourceId, versionId, locator: { start, end } }); board.areas[0].items.push(h.NineBoard.evidenceSnapshot({ kind: 'source', value: ref })); nine.format = 'life-nine-board-v2'; nine.boards.push(board); await s.saveNineBoard(id, nine, nine.revision);
  }, { id: f.id, sourceId: f.source.id, versionId: f.version.id, start, end });
  const saved = await snapshot(page), record = saved.bundle.records.find(item => item.note === '두 기기에서 보존할 익명 발췌'); assert(record); assert.equal(record.text, quote); assert.deepEqual(record.sourceRefs[0].locator, { start, end });
  return { parent, child, saved };
}
async function folder(page, name, parentId = '', id = '') {
  const details = page.locator('#lifeFolderManage'); if (!await details.evaluate(el => el.open)) await details.locator(':scope > summary').click();
  await page.locator('#lifeFolderEdit').selectOption(id || 'new'); await page.locator('#lifeFolderName').fill(name); await page.locator('#lifeFolderParent').selectOption(parentId);
  const before = (await snapshot(page)).sourceFolders.revision; await click(page, '#lifeFolderSave');
  const saved = await waitFor(() => snapshot(page), value => value.sourceFolders.revision > before, 'Explicit folder save'); const result = saved.sourceFolders.folders.find(item => id ? item.id === id : item.name === name); assert(result); return result;
}
async function edit(page, f) {
  await reader(page, f.source.id, f.version.id); const toggle = page.locator('#lifeSourceInfoToggle'); if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await click(page, '#lifeSourceEdit'); await page.locator('#lifeSourceEditText').fill(edited); await click(page, '#lifeSourceEditSave'); await page.locator('#lifeSourceInfoToggle').waitFor();
}
async function collectionNote(page, id, note) { await page.evaluate(async ({ id, note }) => { const s = HaedoLife.Shell.storage, value = await s.readCollection(id); value.items[0].note = note; await s.saveCollection(id, value, value.revision); }, { id, note }); }
async function freshFolderView(page) {
  await records(page); const before = await snapshot(page), details = page.locator('#lifeFolderManage'); if (!await details.evaluate(el => el.open)) await details.locator(':scope > summary').click();
  assert(before.sourceFolders.assignments.length > 0); assert(before.sourceFolders.assignments.every(item => before.bundle.sources.some(source => source.id === item.sourceId)), 'Every real assigned source is available');
  await page.locator('#lifeFolderUnavailable[hidden]').waitFor({ state: 'attached' }); assert.equal(await page.locator('#lifeFolderUnavailable').textContent(), ''); assert.doesNotMatch(await details.innerText(), /이\s*브라우저/);
  const editId = await page.locator('#lifeFolderEdit').inputValue(), saved = before.sourceFolders.folders.find(item => item.id === editId);
  assert.equal(await page.locator('#lifeFolderName').inputValue(), saved?.name || '', 'Latest review must not discard an unsaved folder name'); assert.equal(await page.locator('#lifeFolderParent').inputValue(), saved?.parentId || '', 'Latest review must not discard an unsaved folder parent'); assert.equal(await page.locator('#lifeSourceEditText').count(), 0);
  const refresh = page.getByRole('button', { name: '최신 내용 확인', exact: true }); if (await refresh.isVisible()) await button(page, '최신 내용 확인');
  exactGraph(await snapshot(page), before); assert.equal(await refresh.count(), 0); await page.locator('#lifeFolderUnavailable[hidden]').waitFor({ state: 'attached' }); assert.equal(await page.locator('#lifeFolderUnavailable').textContent(), ''); assert.doesNotMatch(await page.locator('#lifeFolderManage').innerText(), /이\s*브라우저/);
}
async function missingFolderReferenceFixture(page) {
  const before = await snapshot(page);
  const observed = await page.evaluate(async () => {
    const h = HaedoLife, C = h.Core, F = h.SourceFolders, ws = C.id(), empty = C.createWorkspace({ workspaceId: ws, title: '익명 폴더 참조 검수' }), prepared = await C.prepareImport({ origin: 'obsidian', title: '익명 늦게 도착한 자료', text: '# 익명 지연 자료\n원문은 메모리 안에서만 생성합니다.\n' }, empty), received = C.applyChanges(empty, C.buildImportChanges(empty, prepared, []));
    let folders = F.createFolder(F.empty(ws), { name: '익명 참조', parentId: null }); folders.assignments.push({ sourceId: prepared.source.id, folderId: folders.folders[0].id }); F.validate(folders);
    const host = document.createElement('section'); host.dataset.anonymousFolderFixture = 'true'; document.body.append(host); const results = [];
    async function inspect(captured, initial, replacement) {
      let current = initial; const snapshot = { bundle: structuredClone(captured), sourceFolders: structuredClone(folders) }, api = h.SourceFoldersUI.create({ document, storage: { subscribe: () => () => {}, readSourceFoldersSnapshot: async () => structuredClone(snapshot) }, getBundle: () => current });
      try {
        await api.ready; api.mountList(host); const missing = () => { const el = host.querySelector('#lifeFolderUnavailable'); return { hidden: el.hidden, text: el.textContent }; }, first = missing(), sameSnapshot = api.getSnapshot();
        current = replacement; api.mountList(host); return { first, after: missing(), snapshotUnchanged: JSON.stringify(api.getSnapshot()) === JSON.stringify(sameSnapshot) };
      } finally { api.dispose(); host.replaceChildren(); }
    }
    try {
      results.push(await inspect(empty, empty, received));
      const newerMissing = { ...structuredClone(empty), revision: received.revision + 1 }; C.validateWorkspace(newerMissing); results.push(await inspect(newerMissing, received, { ...structuredClone(received), revision: newerMissing.revision }));
      return { cases: results, actualStorageWrites: 0, memoryOnlyCoreModels: true, readonlyComponentFixture: true };
    } finally { host.remove(); }
  });
  for (const [index, result] of observed.cases.entries()) { assert.equal(result.first.hidden, false, 'Legitimate missing source case ' + index); assert.match(result.first.text, /자료 연결 1개/); assert.equal(result.after.hidden, true); assert.equal(result.after.text, ''); assert.equal(result.snapshotUnchanged, true, 'Changing available bundle identity must invalidate the count cache without changing the folder snapshot'); }
  exactGraph(await snapshot(page), before); report.folderAvailabilityComponentFixture = observed;
}
async function captureThree(page) {
  await freshFolderView(page); const details = page.locator('#lifeFolderManage'), summary = details.locator(':scope > summary'); if (!await details.evaluate(el => el.open)) await summary.click();
  await summary.focus(); await summary.press('Space'); assert.equal(await details.evaluate(el => el.open), false); await summary.press('Enter'); assert.equal(await details.evaluate(el => el.open), true);
  const before = await snapshot(page);
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await page.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); }); await summary.focus();
    const audit = await summary.evaluate(el => { const box = el.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, height: box.height, focus: document.activeElement === el, outline: getComputedStyle(el).outlineStyle, pointerClear: hit === el || el.contains(hit) }; });
    const controls = await page.locator('#lifeFolderFilter, #lifeFolderManage input:not([type=hidden]), #lifeFolderManage select, #lifeFolderManage button:enabled').evaluateAll(nodes => nodes.filter(el => el.getClientRects().length && !el.closest('[hidden]')).map(el => { el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(), hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return { id: el.id, tag: el.tagName, fontSize: parseFloat(getComputedStyle(el).fontSize), width: b.width, height: b.height, left: b.left, right: b.right, pointerClear: hit === el || el.contains(hit), named: !!(el.getAttribute('aria-label') || el.labels?.length || el.textContent?.trim()) }; }));
    await page.evaluate(() => scrollTo(0, 0)); await summary.focus(); const file = 'account-library-' + width + '.png'; await page.screenshot({ path: path.join(output, file), fullPage: true }); report.visual.push({ width, file, audit, controls });
    assert(audit.documentWidth <= width); assert(audit.height >= 44); assert.equal(audit.focus, true); assert.notEqual(audit.outline, 'none'); assert.equal(audit.pointerClear, true);
    for (const c of controls) { assert(c.width >= 44 && c.height >= 44, c.id + ': target44px'); assert(c.left >= -0.5 && c.right <= width + 0.5, c.id + ': bounds'); assert.equal(c.pointerClear, true, c.id + ': real pointer hit'); assert.equal(c.named, true, c.id + ': name'); if (['INPUT', 'SELECT'].includes(c.tag)) assert(c.fontSize >= 16, c.id + ': input16px'); }
  }
  exactGraph(await snapshot(page), before); await page.setViewportSize({ width: 820, height: 1000 });
}
async function openOriginals(page) { await openRecordsMenu(page); await click(page, '#lifeOriginalAttachmentsOpen'); await page.locator('#lifeOriginalAttachments').waitFor(); }
async function download(page, control) { const waiting = page.waitForEvent('download'); await control.click(); const file = await waiting, chunks = []; for await (const chunk of await file.createReadStream()) chunks.push(chunk); return Buffer.concat(chunks); }

async function main() {
  assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)); await assert.rejects(fs.access(output), 'Fresh evidence directory required'); await fs.mkdir(output, { recursive: true });
  const files = ['index.html', 'life.html', 'sw.js', 'assets/life/account-library.js', 'assets/life/library-meta.js', 'assets/life/library-remote.js', 'assets/life/library-meta-sync.js', 'assets/life/library-originals-remote.js', 'assets/life/original-attachments.js', 'assets/life/original-attachments-ui.js', 'assets/life/storage.js', 'assets/life/sync.js', 'assets/life/composition-sync.js', 'assets/life/shell.js', 'assets/life/ui.js', 'assets/life/ui.css', 'assets/life/source-folders-ui.js', 'assets/platform-life-remote.js', 'tests/account-library-browser.cjs', 'tests/life-sync-browser.cjs', 'tests/helpers/library-cloud.cjs', 'tests/composition-sync-browser.cjs', 'tests/unified-home-browser.cjs'];
  const hashes = async () => Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await fs.readFile(path.resolve(__dirname, '..', file)))]))); report.sourceHashesBefore = await hashes();
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); report.browser = browser.version();
  async function check(name, action) {
    if (process.env.ACCOUNT_LIBRARY_MATCH && !new RegExp(process.env.ACCOUNT_LIBRARY_MATCH).test(name)) return;
    const server = new CompositionCloud().enableAccountLibrary(), devices = []; let held;
    async function device(label, account = accounts.a) {
      const name = 'account-' + report.checks.length + '-' + label, context = await makeContext(browser, server, name, null, { viewport: { width: 820, height: 1000 }, hasTouch: true, reducedMotion: 'reduce' });
      context.on('request', request => {
        const u = new URL(request.url()), method = request.method(); if (u.origin !== cloud || ['GET', 'OPTIONS'].includes(method) || u.pathname.startsWith('/auth/')) return;
        const owner = server.libraryOwner(request); let body; try { body = request.postDataJSON(); } catch (_) {}
        const compositionRead = method === 'POST' && u.pathname === '/rest/v1/rpc/life_composition_get' && owner === value.owner && body && Object.keys(body).length === 1 && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(body.p_workspace_id);
        const rpc = u.pathname.split('/').at(-1), allowedRpc = method === 'POST' && u.pathname === '/rest/v1/rpc/' + rpc && ['life_sync_put', 'life_composition_put', 'life_library_capabilities', 'life_library_open', 'life_library_catalog', 'life_library_meta_get', 'life_library_meta_put', 'life_library_originals_list', 'life_library_original_get', 'life_library_original_put'].includes(rpc);
        const chunk = method === 'POST' && u.pathname.startsWith('/storage/v1/object/life-library-originals/' + owner + '/');
        if (!(compositionRead || owner === value.owner && (allowedRpc || chunk))) report.forbiddenWrites.push({ name, method, path: u.pathname, owner });
      });
      await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback(); report.externalRequests.push({ name, path: u.origin + u.pathname }); return route.abort('blockedbyclient'); });
      const value = { context, name, owner: account.id, page: null, login: null, expectedFailures: false }; devices.push(value);
      context.on('page', page => { page.setDefaultTimeout(15000); page.on('pageerror', error => report.pageErrors.push({ name, message: error.message })); page.on('console', event => { if (event.type() !== 'error') return; const error = { name, message: event.text(), location: event.location().url }; if (value.expectedFailures && error.location.startsWith(cloud) && /^Failed to load resource:/.test(error.message) && /ERR_(FAILED|INTERNET_DISCONNECTED|ABORTED)|status of (400|403|404|409|503)/.test(error.message)) report.expectedConsoleErrors.push(error); else report.consoleErrors.push(error); }); });
      value.page = await context.newPage();
      value.login = async (owner = account) => {
        await value.page.goto(base + '/index.html'); await shellReady(value.page); assert.deepEqual(await value.page.evaluate(() => __homeDbOpens), [], 'No private DB before verified sign-in');
        server.oauthAccounts.set(name, owner); await value.page.goto(base + '/login.html?next=' + encodeURIComponent('index.html?section=records')); await value.page.locator('#googleLogin').click(); await value.page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(value.page); await records(value.page);
        assert.equal(await value.page.evaluate(() => HaedoAuth.user.id), owner.id); assert((await value.page.evaluate(() => __homeDbOpens)).every(item => item.verified)); assert.equal(await value.page.getByRole('button', { name: '이 작업공간 동기화 시작', exact: true }).count(), 0);
      };
      return value;
    }
    console.log('RUN ' + name);
    try { await action({ server, device, hold(value) { held = value; } }); assert.deepEqual(server.libraryCapabilities, { version: 1, metadataVersion: 1, originalsVersion: 1 }); assert(server.libraryRequests.some(row => row.rpc === 'life_library_capabilities')); assert.deepEqual(server.libraryRouteErrors, []); assert.equal(server.publicationWrites?.().length || 0, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); for (const d of devices) await d.page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '-' + d.name + '.png'), fullPage: true }).catch(() => {}); }
    finally { held?.entered?.resolve(); held?.allowB?.resolve(); held?.release?.resolve(); report.observations.push({ check: name, requests: copy(server.requests), libraryRequests: copy(server.libraryRequests), assets: copy(server.libraryAssetCalls), expectedTransportFailures: server.expectedFailures, routeErrors: copy(server.libraryRouteErrors) }); for (const d of devices) { await d.context.close(); report.closedContexts++; } }
  }
  try {
    await check('default A import, exact quote and saved profiles automatically arrive on fresh B; B edit returns to A at three widths', async ({ server, device }) => {
      const a = await device('a'); await a.login(); await synced(a.page); const f = await importMarkdown(a.page), rich = await richProfile(a.page, f); await synced(a.page, f.id);
      const b = await device('b'); await b.login(); await synced(b.page, f.id); assert.equal(await b.page.evaluate(() => HaedoLife.Shell.storage.getActive()), f.id); exactGraph(await snapshot(b.page), await snapshot(a.page));
      assert.equal(server.libraryDefaults.size, 1); assert(server.libraryMeta(accounts.a.id, f.id)); assert.equal((await snapshot(b.page)).nineBoard.boards[0].areas[0].items[0].reference.value.sourceVersionId, f.version.id);
      await edit(b.page, f); await synced(b.page, f.id); await a.page.bringToFront(); await focus(a.page); await waitFor(() => snapshot(a.page), value => value.bundle.sourceVersions.some(v => v.contentText === edited), 'A lifecycle receive of B edit'); await synced(a.page, f.id);
      const final = await snapshot(a.page); assert.equal(final.bundle.sources.length, 1); assert.equal(final.bundle.sourceVersions.length, 2); assert.equal(final.bundle.sourceVersions.find(v => v.id === f.version.id).contentText, raw); assert.equal(final.bundle.sourceVersions.find(v => v.contentText === edited).contentHash, sha(edited));
      assert.deepEqual(final.sourceFolders.assignments, rich.saved.sourceFolders.assignments); assert.deepEqual(final.bundle.records, rich.saved.bundle.records); exactGraph(final, await snapshot(b.page)); await captureThree(a.page); await missingFolderReferenceFixture(a.page);
    });
    await check('automatic offline outbox, lost ACK receipt replay and later source and metadata edits survive reload', async ({ server, device }) => {
      const a = await device('a'); await a.login(); const f = await importMarkdown(a.page); await richProfile(a.page, f); await synced(a.page, f.id); a.expectedFailures = true;
      const remoteBeforeOffline = copy(server.row(accounts.a.id, f.id)); server.offline.add(a.name); await importMarkdown(a.page, '# 익명 오프라인\n전송 대기 원문\n', '익명 오프라인 자료');
      await waitFor(() => durableDirty(a.page, f.id, 'sync'), value => value.revision > value.state.syncedLocalRevision && value.account.status === 'error' && !!value.account.error, 'Durable source dirty revision and account error before verified transmission'); assert.deepEqual(server.row(accounts.a.id, f.id), remoteBeforeOffline); assert.notEqual((await state(a.page, f.id)).status, 'synced'); await a.page.locator('#lifeAccountStorage[data-state="error"]').waitFor();
      server.loseResponses.add(a.name); server.offline.delete(a.name); await a.page.evaluate(() => window.dispatchEvent(new Event('online')));
      const pending = await waitFor(() => domainState(a.page, 'sync', f.id), value => value.outbox && server.row(accounts.a.id, f.id).data.sources.length === 2, 'Stored source with lost ACK');
      const outbox = copy(pending.outbox); await importMarkdown(a.page, '# 익명 후속\n응답 대기 중 새 원문\n', '익명 후속 자료'); assert.deepEqual((await domainState(a.page, 'sync', f.id)).outbox, outbox, 'Later changes must not alter durable operation payload');
      await a.page.reload(); await ready(a.page); server.loseResponses.delete(a.name); await focus(a.page); await synced(a.page, f.id); assert.equal(server.row(accounts.a.id, f.id).data.sources.length, 3); assert(server.writes(accounts.a.id, f.id).filter(r => r.operation === outbox.operationId).length >= 2); assert.equal((await domainState(a.page, 'sync', f.id)).outbox, null);
      server.loseLibraryResponses.add(a.name); await collectionNote(a.page, f.id, '익명 응답 유실 메모');
      const metadataPending = await waitFor(() => domainState(a.page, 'libraryMetaSync', f.id), value => value.outbox && server.libraryMeta(accounts.a.id, f.id).data.collection.items[0].note === '익명 응답 유실 메모', 'Stored metadata lost ACK'); const metadataOutbox = copy(metadataPending.outbox);
      await collectionNote(a.page, f.id, '익명 후속 메모'); assert.deepEqual((await domainState(a.page, 'libraryMetaSync', f.id)).outbox, metadataOutbox);
      await a.page.reload(); await ready(a.page); server.loseLibraryResponses.delete(a.name); await focus(a.page); await synced(a.page, f.id); assert.equal(server.libraryMeta(accounts.a.id, f.id).data.collection.items[0].note, '익명 후속 메모'); assert(server.libraryWrites(a.name).filter(row => row.body.p_operation_id === metadataOutbox.operationId).length >= 2);
      const b = await device('b'); await b.login(); await synced(b.page, f.id); exactGraph(await snapshot(b.page), await snapshot(a.page));
    });
    await check('two metadata writers require explicit comparison for both choices and retain exact unchosen recoveries without enrolling copies', async ({ server, device }) => {
      const a = await device('a'); await a.login(); const f = await importMarkdown(a.page), rich = await richProfile(a.page, f); await synced(a.page, f.id); const b = await device('b'); await b.login(); await synced(b.page, f.id); b.expectedFailures = true;
      for (const choice of ['remote', 'local']) {
        const localLabel = '익명 기기 B ' + choice, remoteLabel = '익명 기기 A ' + choice, remoteBeforeOffline = copy(server.libraryMeta(accounts.a.id, f.id)); server.offline.add(b.name); await collectionNote(b.page, f.id, localLabel); await waitFor(() => durableDirty(b.page, f.id, 'libraryMetaSync'), value => value.revision > value.state.syncedLocalRevision && value.account.status === 'error' && !!value.account.error, 'Durable metadata dirty revision and account error before verified transmission'); assert.deepEqual(server.libraryMeta(accounts.a.id, f.id), remoteBeforeOffline); assert.equal((await snapshot(b.page)).collection.items[0].note, localLabel); await b.page.locator('#lifeAccountStorage[data-state="error"]').waitFor();
        await collectionNote(a.page, f.id, remoteLabel); await synced(a.page, f.id); server.offline.delete(b.name); await focus(b.page); await waitFor(() => domainState(b.page, 'libraryMetaSync', f.id), value => !!value.conflict, 'Explicit metadata conflict');
        const writes = server.libraryWrites(b.name).length; await b.page.goto(base + '/index.html?section=manage&view=sync'); await ready(b.page); await click(b.page, '#lifeLibraryMetaCompare'); const comparison = await b.page.locator('#lifeLibraryMetaComparison').innerText(); assert(comparison.includes(localLabel) && comparison.includes(remoteLabel)); assert.equal(server.libraryWrites(b.name).length, writes, 'Preview must not write');
        await click(b.page, choice === 'remote' ? '#lifeLibraryMetaUseRemote' : '#lifeLibraryMetaUseLocal'); await synced(b.page, f.id);
        const recoveries = await b.page.evaluate(async id => { const s = HaedoLife.Shell.storage; return Promise.all((await s.listLibraryMetaRecoveries(id)).map(row => s.readLibraryMetaRecovery(id, row.id))); }, f.id); assert(recoveries.some(row => row.metadata.collection.items[0].note === (choice === 'remote' ? localLabel : remoteLabel))); for (const row of recoveries) { assert.equal(row.bundle.workspaceId, f.id); assert.equal(row.bundle.sourceVersions.find(v => v.id === f.version.id).contentText, raw); assert.deepEqual(row.metadata.sourceFolders.assignments, rich.saved.sourceFolders.assignments); }
        await focus(a.page); await waitFor(() => snapshot(a.page), value => value.collection.items[0].note === (choice === 'remote' ? remoteLabel : localLabel), 'Chosen metadata return to A'); await synced(a.page, f.id); await synced(b.page, f.id);
      }
      assert.equal([...server.rows.values()].filter(row => row.owner_id === accounts.a.id).length, 1, 'Recovery must not become another automatically uploaded account library');
    });
    await check('original ZIP automatically catalogs on B and lazy bytes reject corruption and missing chunks; pending upload retries immutable bytes', async ({ server, device }) => {
      const a = await device('a'); await a.login(); await synced(a.page); a.expectedFailures = true; const original = originalFixture(); server.failLibraryUploads.add(a.name); await openOriginals(a.page);
      await a.page.locator('#originalAttachmentsFile').setInputFiles({ name: 'anonymous-private-originals-part-1.zip', mimeType: 'application/zip', buffer: original.zip }); await a.page.locator('#originalAttachmentsInstall').waitFor(); await click(a.page, '#originalAttachmentsInstall');
      await waitFor(() => a.page.evaluate(() => HaedoLife.Shell.originals.getState()), value => value.pending === 1 && value.error, 'Durable original upload pending'); assert.equal(server.libraryOriginals.size, 0); assert.notEqual((await state(a.page)).status, 'synced');
      server.failLibraryUploads.delete(a.name); await click(a.page, '#originalAttachmentsRetry'); await waitFor(() => [...server.libraryOriginals.values()], value => value.length === 1, 'Original manifest ACK'); await synced(a.page); const stored = copy([...server.libraryOriginals.values()][0]); assert.equal(stored.manifest.archiveHash, sha(original.zip));
      const b = await device('b'); b.expectedFailures = true; await b.login(); await synced(b.page); const before = server.libraryAssetCalls.filter(row => row.device === b.name && row.method === 'GET').length; await openOriginals(b.page); await b.page.locator('#originalAttachmentsCopies .original-attachments-copy').waitFor(); assert.equal(server.libraryAssetCalls.filter(row => row.device === b.name && row.method === 'GET').length, before, 'Catalog must not download archive bytes'); assert.equal(await b.page.locator('#originalAttachmentsFile').inputValue(), '', 'B did not reselect original ZIP');
      const row = b.page.locator('#originalAttachmentsCopies .original-attachments-copy'), archiveButton = row.getByRole('button', { name: '파트 원본 ZIP 받기', exact: true }), chunkPath = stored.manifest.chunks[0].path;
      for (const fault of [server.corruptLibraryChunks, server.missingLibraryChunks]) { fault.add(chunkPath); await archiveButton.click(); await b.page.locator('#originalAttachmentsError:not([hidden])').waitFor(); fault.delete(chunkPath); assert.equal(await b.page.locator('#originalAttachmentsEntries .original-attachments-entry').count(), 0); }
      assert.equal(sha(await download(b.page, archiveButton)), sha(original.zip)); await row.getByRole('button').first().click(); await b.page.locator('.original-attachments-entry').first().waitFor();
      const working = b.page.locator('.original-attachments-entry[data-role="working-note-version"]'); await working.getByRole('button', { name: '원문 그대로 읽기', exact: true }).click(); assert.equal(await working.locator('pre').textContent(), original.files['snapshot/working-version/notes/익명.md'].toString()); assert.equal(await b.page.evaluate(() => window.__originalsXSS), undefined); assert.equal(sha(await download(b.page, working.getByRole('button', { name: '원본 파일 받기', exact: true }))), sha(original.files['snapshot/working-version/notes/익명.md']));
      const gets = server.libraryAssetCalls.filter(row => row.device === b.name && row.method === 'GET').length; assert.equal(sha(await download(b.page, archiveButton)), sha(original.zip)); assert.equal(server.libraryAssetCalls.filter(row => row.device === b.name && row.method === 'GET').length, gets, 'Verified byte cache must be reused');
      const other = await device('other-owner', accounts.b); other.expectedFailures = true; await other.login(); await openOriginals(other.page); assert.equal(await other.page.locator('.original-attachments-copy').count(), 0);
      const rejection = await other.page.evaluate(async ({ id, path }) => { const remote = await HaedoAuth.client.rpc('life_library_original_get', { p_id: id }); const chunk = await HaedoAuth.client.storage.from('life-library-originals').download(path); let code; try { await HaedoLife.Shell.originals.archive(id); } catch (error) { code = error.code; } return { manifest: remote.data, forbiddenChunk: !!chunk.error, code }; }, { id: stored.id, path: chunkPath }); assert.equal(rejection.manifest, null); assert.equal(rejection.forbiddenChunk, true); assert(rejection.code);
    });
    await check('simultaneous first login shares a default; missing remote never recreates and late old-account metadata cannot enter the new account', async ({ server, device, hold }) => {
      const a = await device('a'), b = await device('b');
      // Deterministic replay of the observed race: both actual logins run in
      // parallel. B's first workbench read waits until A captured a null result;
      // A receives that stale null only after B stored the canonical initial row.
      const initial = { device: a.name, write: false, entered: deferred(), allowB: deferred(), release: deferred() }; hold(initial); let aReadCount = 0, initialCaptured = false; initial.entered.promise.then(() => { initialCaptured = true; });
      // enable() first probes the schema, then run() reads the row used for CAS.
      // Hold that second read, so this test proves the actual expected-0 race.
      const compositionRead = cloud + '/rest/v1/rpc/life_composition_get', captureActualRead = async route => { if (++aReadCount === 2) server.heldComposition = initial; return route.fallback(); }, waitForA = async route => { await initial.entered.promise; await initial.allowB.promise; return route.fallback(); }; await a.context.route(compositionRead, captureActualRead); await b.context.route(compositionRead, waitForA);
      const logins = Promise.all([a.login(), b.login()]); logins.catch(() => {});
      await waitFor(() => initialCaptured, value => value === true, 'A captured canonical initial null workbench in actual CAS read'); assert.equal(server.compositions.size, 0); initial.allowB.resolve();
      await waitFor(() => server.compositions.size, value => value === 1, 'B stored canonical initial workbench'); initial.release.resolve(); await logins; await a.context.unroute(compositionRead, captureActualRead); await b.context.unroute(compositionRead, waitForA);
      await Promise.all([synced(a.page), synced(b.page)]); const id = (await snapshot(a.page)).bundle.workspaceId; assert.equal((await snapshot(b.page)).bundle.workspaceId, id); assert.equal(server.libraryDefaults.size, 1);
      const initialWrites = server.compositionWrites().filter(row => row.owner === accounts.a.id && row.id === id); assert.equal(initialWrites.length, 2); assert(initialWrites.every(row => row.expected === 0)); assert.equal(new Set(initialWrites.map(row => row.operation)).size, 2); assert.deepEqual(initialWrites.map(row => row.device).sort(), [a.name, b.name].sort());
      assert.equal(server.composition(accounts.a.id, id).revision, 1, 'Identical initial race must converge without a replacement write'); for (const d of [a, b]) { const value = await domainState(d.page, 'compositionSync', id); assert.equal(value.conflict, null); assert.equal(value.outbox, null); }
      const f = await importMarkdown(a.page); await richProfile(a.page, f); await synced(a.page, id); await focus(b.page); await waitFor(() => snapshot(b.page), value => value.bundle.sources.length === 1 && value.collection.items.length === 1, 'B automatic receive'); await synced(b.page, id);
      const gate = { device: b.name, rpc: 'life_library_meta_get', entered: deferred(), release: deferred() }; server.heldLibrary = gate; hold(gate); await focus(b.page); await waitFor(() => server.heldLibrary, value => value === null, 'Old-account metadata request captured');
      await b.page.evaluate(() => { window.__accountSignOut = HaedoAuth.client.auth.signOut({ scope: 'local' }); }); await b.page.waitForFunction(() => HaedoAuth.user === null); gate.release.resolve(); await shellReady(b.page);
      b.owner = accounts.b.id; server.oauthAccounts.set(b.name, accounts.b); await b.page.goto(base + '/login.html?next=' + encodeURIComponent('index.html?section=records')); await b.page.locator('#googleLogin').click(); await b.page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(b.page); await synced(b.page); const other = await snapshot(b.page); assert.notEqual(other.bundle.workspaceId, id); assert.equal(other.bundle.sources.length, 0); assert.equal(other.collection.items.length, 0); assert.equal(other.sourceFolders.folders.length, 0);
      const before = await snapshot(a.page), writes = server.writes(accounts.a.id, id).length; server.rows.delete(server.key(accounts.a.id, id)); await focus(a.page); await waitFor(() => state(a.page, id), value => value.status === 'error' || value.status === 'conflict', 'Missing remote failure'); assert.equal(server.row(accounts.a.id, id), undefined); assert.equal(server.writes(accounts.a.id, id).length, writes); exactGraph(await snapshot(a.page), before);
    });
  } finally { await browser.close(); report.browserClosed = true; report.sourceHashesAfter = await hashes(); report.productsUnchangedDuringRun = JSON.stringify(report.sourceHashesBefore) === JSON.stringify(report.sourceHashesAfter); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
  for (const field of ['consoleErrors', 'pageErrors', 'externalRequests', 'forbiddenWrites']) assert.deepEqual(report[field], [], field); assert.equal(report.productsUnchangedDuringRun, true); assert(report.checks.length && report.checks.every(value => value.pass)); console.log('Account default library: ' + report.checks.length + ' passed; anonymous SDK transport only.');
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

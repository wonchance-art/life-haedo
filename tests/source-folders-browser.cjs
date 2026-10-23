/* Material folders: actual local import/list/read/edit/backup UI, bundled SDK and
 * account/workspace-scoped IDB. Anonymous synthetic records/FakeCloud Auth only.
 * BASE_URL=http://127.0.0.1:4173 node tests/source-folders-browser.cjs */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { FakeCloud, accounts, cloud, base, openManagement } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, nav } = require('./unified-home-browser.cjs');
const output = path.resolve(process.env.SOURCE_FOLDERS_OUTPUT || '.local/source-folders');
const titleA = '익명 폴더 검수 자료 A', titleB = '익명 폴더 검수 자료 B';
const quote = '두 번째 자리의 정확한 익명 문장🌱', note = '익명 폴더 이동 전 보관한 인용';
const raw = '\uFEFF---\r\ntitle: 익명 속성\r\ntags: [익명검수]\r\n---\r\n\r\n# 익명 폴더 본문\r\n\r\n본문의 **강조**와 정확한 문장을 보관합니다.\r\n\r\n' + quote + '\r\n\r\n' + quote + '\r\n';
const edited = raw.replace(/\r\n?/g, '\n') + '\n## 익명 수정 본문\n같은 자료의 새 판도 폴더를 유지합니다.\n';
const parentName = '익명 연구', childName = '익명 관찰', renamedChild = '익명 관찰과 자료 정리의 긴 이름을 줄바꿈으로 확인합니다';
const sha = value => createHash('sha256').update(value).digest('hex');
const click = async (page, selector) => { await page.locator(selector).click(); await settle(page); };
const byName = async (page, name) => { await page.getByRole('button', { name, exact: true }).click(); await settle(page); };
const report = { createdAt: new Date().toISOString(), scope: 'Four actual local material-folder journeys through import/list/read/edit/common-backup UI, bundled SDK and scoped IndexedDB with anonymous intercepted FakeCloud Auth only. Raw Markdown, quotes, workbench group and names are synthetic. Group setup uses the actual storage API as an explicit fixture; one targeted IDB abort is isolated and removed before retry. CSS viewports are not real devices; no personal vault/account/provider, OS file-save or remote folder-sync proof.', checks: [], visual: [], observations: [], consoleErrors: [], pageErrors: [], externalRequests: [], privacyViolations: [], remoteWrites: [], closedContexts: 0 };
async function snapshot(page, workspaceId) {
  return page.evaluate(async workspaceId => { const s = HaedoLife.Shell.storage, id = workspaceId || await s.getActive(); return { bundle: await s.read(id), workbench: await s.readWorkbench(id), sourceFolders: await s.readSourceFolders(id), interest: await s.readInterestProfile(id), annual: await s.readAnnualPlan(id), collection: await s.readCollection(id), discoverySettings: await s.readDiscoverySettings(id) }; }, workspaceId);
}
function originalsUnchanged(actual, expected) { for (const key of ['bundle', 'workbench', 'interest', 'annual', 'collection', 'discoverySettings']) assert.deepEqual(actual[key], expected[key], key + ' must not change during folder operations'); }
async function records(page) { await page.goto(base + '/index.html?section=records'); await ready(page); await settle(page); await page.locator('#lifeFolderFilter:enabled').waitFor(); }
async function reveal(control) { const depth = await control.locator('xpath=ancestor::details').count(); for (let n = depth; n > 0; n--) { const parent = control.locator('xpath=ancestor::details[' + n + ']'); if (!await parent.evaluate(el => el.open)) await parent.locator(':scope > summary').click(); } }
async function importMarkdown(page, importTitle, content = raw) {
  await records(page); await byName(page, '가져오기'); await byName(page, '텍스트 파일');
  await page.locator('#lifeImportFile').setInputFiles({ name: importTitle === titleA ? 'anonymous-folders-a.md' : 'anonymous-folders-b.md', mimeType: 'text/markdown', buffer: Buffer.from(content) }); await settle(page);
  for (const [name, value] of Object.entries({ Origin: 'obsidian', Title: importTitle, Author: '익명 작성자', Relation: 'other', Coverage: 'partial', Omissions: '익명 검증 자료의 원본 첨부는 포함하지 않음' })) { const field = page.locator('#lifeImport' + name); await reveal(field); if (['Origin', 'Relation', 'Coverage'].includes(name)) await field.selectOption(value); else await field.fill(value); }
  await byName(page, '원문·출처 확인'); await byName(page, '자료만 보관'); await page.locator('#lifeSourceInfoToggle').waitFor();
  const value = await snapshot(page), source = value.bundle.sources.find(s => s.title === importTitle), version = value.bundle.sourceVersions.filter(v => v.sourceId === source?.id).at(-1);
  assert(source && version); assert.equal(version.contentText, content); assert.equal(version.contentHash, sha(content)); assert.equal(version.format, 'text/markdown');
  return { source, version, workspaceId: value.bundle.workspaceId };
}
async function sourceOptions(page) { const control = page.locator('#lifeSourceInfoToggle'); if (await control.getAttribute('aria-expanded') !== 'true') await control.click(); await page.locator('#lifeSourceDetails').waitFor({ state: 'visible' }); }
async function readCard(page, sourceId, versionId) { await click(page, '.life-source-open[data-source-id="' + sourceId + '"]' + (versionId ? '[data-version-id="' + versionId + '"]' : '')); await page.locator('#lifeSourceInfoToggle').waitFor(); }
async function fixture(page, rich = false) {
  const a = await importMarkdown(page, titleA), b = await importMarkdown(page, titleB, '# 익명 B\r\n\r\n미분류 비교를 위한 별도 자료입니다.\r\n');
  if (rich) {
    await records(page); await readCard(page, a.source.id); await click(page, '#lifeExcerptToggle'); await page.waitForFunction(() => document.querySelector('#lifeSourceText')?.dataset.readingMode === 'raw');
    const start = raw.lastIndexOf(quote), end = start + quote.length;
    await page.locator('#lifeSourceText').evaluate((el, range) => { assertText(); function assertText() { if (el.firstChild?.nodeType !== Node.TEXT_NODE) throw Error('Exact raw Text node missing'); } el.focus(); const selection = getSelection(), r = document.createRange(); r.setStart(el.firstChild, range.start); r.setEnd(el.firstChild, range.end); selection.removeAllRanges(); selection.addRange(r); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); }, { start, end });
    await page.locator('#lifeSourceTopic').fill('익명 분류 검수'); await page.locator('#lifeSourceNote').fill(note); await click(page, '#lifeSourceExcerptSave');
    await page.evaluate(async ({ workspaceId, versionId }) => { const s = HaedoLife.Shell.storage, state = await s.readWorkbench(workspaceId); state.groups.push({ id: HaedoLife.Core.id(), title: '익명 보존 묶음', versionIds: [versionId] }); await s.saveWorkbench(workspaceId, state, state.revision); }, { workspaceId: a.workspaceId, versionId: a.version.id });
    const value = await snapshot(page), record = value.bundle.records.find(r => r.note === note); assert(record); assert.equal(record.text, quote); assert.deepEqual(record.sourceRefs[0].locator, { start, end }); assert.equal(value.workbench.groups.length, 1);
  }
  await records(page); return { a, b, before: await snapshot(page) };
}
async function manage(page) { const details = page.locator('#lifeFolderManage'); if (!await details.evaluate(el => el.open)) await details.locator(':scope > summary').click(); await page.locator('#lifeFolderName').waitFor(); }
async function folderEditor(page, id = '') { await manage(page); await page.locator('#lifeFolderEdit').selectOption(id || 'new'); }
async function saveFolder(page, { id = '', name, parentId = '' }) { await folderEditor(page, id); await page.locator('#lifeFolderName').fill(name); await page.locator('#lifeFolderParent').selectOption(parentId); const before = (await snapshot(page)).sourceFolders; await click(page, '#lifeFolderSave'); const state = (await waitSnapshot(page, value => value.sourceFolders.revision > before.revision)).sourceFolders; assert.equal(state.revision, before.revision + 1); const folder = id ? state.folders.find(f => f.id === id) : state.folders.find(f => f.name === name.trim()); assert(folder, 'Explicit folder save did not persist'); assert.equal(folder.name, name.trim()); assert.equal(folder.parentId, parentId || null); await page.waitForFunction(id => document.querySelector('#lifeFolderEdit')?.value === id && !document.querySelector('#lifeFolderSave')?.disabled, folder.id); return folder; }
async function assign(page, control, folderId) {
  const before = (await snapshot(page)).sourceFolders;
  if (!await control.evaluate(el => el.open)) await control.locator(':scope > summary').click();
  await control.locator('[data-source-folder-destination]:enabled').waitFor(); await control.locator('[data-source-folder-destination]').selectOption(folderId);
  await control.locator('[data-source-folder-apply]').click();
  const saved = await waitSnapshot(page, value => value.sourceFolders.revision > before.revision); assert.equal(saved.sourceFolders.revision, before.revision + 1); await settle(page);
}
async function assignCard(page, sourceId, folderId) { await assign(page, page.locator('#lifeSearchResults .life-source-card[data-source-id="' + sourceId + '"] [data-source-folder-assignment]').first(), folderId); }
async function assignBulk(page, folderId) { await assign(page, page.locator('#lifeSelectionBar [data-source-folder-assignment]'), folderId); }
async function deleteFolder(page, id) {
  await folderEditor(page, id); const before = await snapshot(page); await click(page, '#lifeFolderDelete'); await page.locator('#lifeFolderDeleteConfirm:not([hidden])').waitFor(); assert.ok((await page.locator('#lifeFolderDeleteConfirm').textContent()).includes('자료는 미분류로 남습니다.')); await click(page, '#lifeFolderDeleteCancel'); assert.deepEqual(await snapshot(page), before, 'Inline deletion cancellation must not write');
  await click(page, '#lifeFolderDelete'); await click(page, '#lifeFolderDeleteApply'); const saved = await waitSnapshot(page, value => value.sourceFolders.revision > before.sourceFolders.revision); assert.equal(saved.sourceFolders.revision, before.sourceFolders.revision + 1); originalsUnchanged(saved, before);
}
async function chooseFolder(page, id = 'all') { await page.locator('#lifeFolderFilter').selectOption(id); await settle(page); }
async function visibleSources(page) { return [...new Set(await page.locator('#lifeSearchResults .life-source-open').evaluateAll(nodes => nodes.map(n => n.dataset.sourceId)))].sort(); }
async function expectSources(page, ids) { assert.deepEqual(await visibleSources(page), [...ids].sort()); }
async function errorVisible(page) { await page.locator('#lifeFolderError:not([hidden])').waitFor(); await page.locator('#lifeFolderSave:enabled').waitFor(); }
async function commonBackup(page) { await openManagement(page); await byName(page, '자료·구성 백업'); await page.locator('#wbBackupDownload').waitFor(); const pending = page.waitForEvent('download'); await click(page, '#wbBackupDownload'); const download = await pending, chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
async function editReader(page) { await sourceOptions(page); await click(page, '#lifeSourceEdit'); await page.locator('#lifeSourceEditText').waitFor(); await page.locator('#lifeSourceEditText').fill(edited); await click(page, '#lifeSourceEditSave'); await page.locator('#lifeSourceInfoToggle').waitFor(); }
async function prepareFolders(page, rich = false) { const f = await fixture(page, rich), parent = await saveFolder(page, { name: parentName }), child = await saveFolder(page, { name: childName, parentId: parent.id }); await assignCard(page, f.a.source.id, child.id); return { ...f, parent, child }; }
async function waitSnapshot(page, predicate) { const deadline = Date.now() + 15000; do { const value = await snapshot(page); if (predicate(value)) return value; await page.waitForTimeout(25); } while (Date.now() < deadline); throw Error('Expected committed folder state did not arrive'); }
async function abortFolderWrite(page, enabled, workspaceId) {
  await page.evaluate(({ enabled, workspaceId }) => {
    if (enabled) {
      if (window.__folderPutOriginal) throw Error('Folder abort hook already installed');
      window.__folderPutOriginal = IDBObjectStore.prototype.put; window.__folderAbortCount = 0;
      IDBObjectStore.prototype.put = function (row, ...args) { const request = __folderPutOriginal.call(this, row, ...args); if (this.name === 'meta' && typeof row?.key === 'string' && row.key.startsWith('source-folders:') && row.value?.workspaceId === workspaceId && !__folderAbortCount) { __folderAbortCount++; this.transaction.abort(); } return request; };
    } else if (window.__folderPutOriginal) { IDBObjectStore.prototype.put = __folderPutOriginal; delete window.__folderPutOriginal; }
  }, { enabled, workspaceId });
}
async function captureThree(page) {
  const before = await snapshot(page), summary = page.locator('#lifeFolderManage > summary');
  await summary.focus(); await summary.press('Space'); assert.equal(await page.locator('#lifeFolderManage').evaluate(el => el.open), false); await summary.press('Enter'); assert.equal(await page.locator('#lifeFolderManage').evaluate(el => el.open), true);
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await page.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); }); await page.keyboard.press('Tab'); await summary.focus();
    const audit = await summary.evaluate(el => { const box = el.getBoundingClientRect(), style = getComputedStyle(el), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, summaryHeight: box.height, summaryWidth: box.width, focus: document.activeElement === el, outline: style.outlineStyle, pointerClear: hit === el || el.contains(hit) }; });
    const controls = await page.locator('#lifeFolderFilter, #lifeFolderManage input:not([type=hidden]), #lifeFolderManage select, #lifeFolderManage button:enabled').evaluateAll(nodes => nodes.filter(el => el.getClientRects().length && !el.closest('[hidden]')).map(el => { el.scrollIntoView({ block: 'center' }); const box = el.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return { id: el.id, tag: el.tagName, fontSize: parseFloat(getComputedStyle(el).fontSize), width: box.width, height: box.height, left: box.left, right: box.right, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, pointerClear: hit === el || el.contains(hit), named: !!(el.getAttribute('aria-label') || el.labels?.length || el.textContent?.trim()) }; }));
    await page.evaluate(() => scrollTo(0, 0)); await summary.focus(); const file = 'folders-' + width + '.png'; await page.screenshot({ path: path.join(output, file), fullPage: true }); report.visual.push({ width, file, audit, controls });
    assert.ok(audit.documentWidth <= width, 'Folder management must not overflow'); assert.ok(audit.summaryHeight >= 44 && audit.summaryWidth >= 44); assert.equal(audit.focus, true); assert.notEqual(audit.outline, 'none'); assert.equal(audit.pointerClear, true);
    for (const control of controls) { if (['INPUT', 'SELECT'].includes(control.tag)) assert.ok(control.fontSize >= 16, control.id + ': 16px text input/select'); assert.ok(control.width >= 44 && control.height >= 44, control.id + ': 44px target'); assert.ok(control.left >= -0.5 && control.right <= width + 0.5, control.id + ': horizontal bounds'); assert.equal(control.pointerClear, true, control.id + ': actual pointer hit / fixed-navigation overlap'); assert.equal(control.named, true, control.id + ': accessible name'); }
  }
  await page.setViewportSize({ width: 820, height: 1000 }); assert.deepEqual(await snapshot(page), before, 'Visual and keyboard inspection must not save folder or original changes');
}
async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Only the anonymous loopback app is permitted');
  await assert.rejects(fs.access(output), 'Use a fresh evidence directory; previous results must not be overwritten'); await fs.mkdir(output, { recursive: true });
  const files = ['index.html', 'life.html', 'sw.js', 'assets/life/source-folders.js', 'assets/life/source-folders-ui.js', 'assets/life/source-folders.css', 'assets/life/storage.js', 'assets/life/core.js', 'assets/life/workbench.js', 'assets/life/workbench-ui.js', 'assets/life/ui.js', 'assets/life/source-edit.js', 'assets/life/source-edit-ui.js', 'assets/life/source-markdown.js', 'assets/life/source-markdown.css', 'assets/platform-auth.js', 'tests/source-folders-browser.cjs', 'tests/life-sync-browser.cjs', 'tests/unified-home-browser.cjs'];
  const hashes = async () => Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await fs.readFile(path.resolve(__dirname, '..', file)))]))); report.sourceHashesBefore = await hashes();
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); report.browser = browser.version();
  async function check(name, run) {
    if (process.env.SOURCE_FOLDERS_MATCH && !new RegExp(process.env.SOURCE_FOLDERS_MATCH).test(name)) return;
    const server = new FakeCloud(), context = await makeContext(browser, server, 'source-folders-' + report.checks.length, accounts.a, { viewport: { width: 820, height: 1000 }, hasTouch: true, reducedMotion: 'reduce' });
    context.on('request', request => { const u = new URL(request.url()), body = request.postData() || ''; if ([titleA, titleB, note, raw, parentName, renamedChild].some(text => u.href.includes(text) || u.href.includes(encodeURIComponent(text)) || body.includes(text) || body.includes(JSON.stringify(text).slice(1, -1)))) report.privacyViolations.push({ check: name, destination: u.origin + u.pathname }); if (u.origin === cloud && !['GET', 'OPTIONS'].includes(request.method()) && !u.pathname.startsWith('/auth/')) report.remoteWrites.push({ check: name, method: request.method(), path: u.pathname }); });
    await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback(); report.externalRequests.push({ check: name, destination: u.origin + u.pathname }); return route.abort('blockedbyclient'); });
    context.on('page', page => { page.setDefaultTimeout(15000); page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ check: name, message: event.text() }); }); page.on('pageerror', error => report.pageErrors.push({ check: name, message: error.message })); });
    const page = await context.newPage(); console.log('RUN ' + name);
    try { await run({ page, context }); assert.equal(server.writes().length, 0); assert.equal(await page.evaluate(() => !!window.__folderPutOriginal), false, 'Targeted IDB abort hook must be removed'); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); report.closedContexts++; }
  }
  try {
    await check('nested folders classify all source versions while search, reading, editing and return preserve original evidence', async ({ page }) => {
      const f = await prepareFolders(page, true); originalsUnchanged(await snapshot(page), f.before);
      await chooseFolder(page, f.parent.id); await expectSources(page, [f.a.source.id]);
      await chooseFolder(page, 'unfiled'); await expectSources(page, [f.b.source.id]);
      await chooseFolder(page, 'all'); await saveFolder(page, { id: f.child.id, name: renamedChild, parentId: f.parent.id });
      await folderEditor(page, f.parent.id); assert.equal(await page.locator('#lifeFolderDelete').isDisabled(), true, 'A non-leaf folder cannot be deleted');
      await chooseFolder(page, f.child.id); await page.locator('#lifeSearch').fill('익명 폴더 본문'); await settle(page);
      await click(page, '#lifeFilterToggle'); await page.locator('#lifeOriginFilter').selectOption('obsidian'); await settle(page);
      const sourceControl = page.locator('.life-source-open[data-version-id="' + f.a.version.id + '"]'); await sourceControl.scrollIntoViewIfNeeded(); const returnY = await page.evaluate(() => scrollY);
      await readCard(page, f.a.source.id, f.a.version.id); const beforeEdit = await snapshot(page); await editReader(page);
      const afterEdit = await snapshot(page), latest = afterEdit.bundle.sourceVersions.filter(v => v.sourceId === f.a.source.id).at(-1);
      assert.equal(afterEdit.bundle.sources.length, 2); assert.equal(latest.sourceId, f.a.source.id); assert.equal(latest.contentText, edited); assert.equal(latest.contentHash, sha(edited)); assert.deepEqual(afterEdit.bundle.sourceVersions.find(v => v.id === f.a.version.id), f.a.version); assert.deepEqual(afterEdit.bundle.records, beforeEdit.bundle.records); assert.deepEqual(afterEdit.sourceFolders, beforeEdit.sourceFolders); assert.deepEqual(afterEdit.workbench, beforeEdit.workbench);
      await click(page, '#lifeSearchReturn'); await page.locator('#lifeFolderFilter').waitFor();
      assert.equal(await page.locator('#lifeFolderFilter').inputValue(), f.child.id); assert.equal(await page.locator('#lifeSearch').inputValue(), '익명 폴더 본문'); assert.equal(await page.locator('#lifeOriginFilter').inputValue(), 'obsidian');
      await page.waitForFunction(id => document.activeElement?.dataset.versionId === id, f.a.version.id); assert.ok(Math.abs(await page.evaluate(() => scrollY) - returnY) <= 2, 'Reader return restores the actual result position');
      assert.equal(await page.locator('.life-source-open[data-source-id="' + f.a.source.id + '"]').count(), 2, 'Exact-version search retains old and new versions');
      await click(page, '#lifeSelectionToggle'); for (const id of [f.a.version.id, latest.id]) await click(page, '.life-source-select[data-version-id="' + id + '"]');
      await assignBulk(page, f.parent.id); let state = (await snapshot(page)).sourceFolders; assert.equal(state.assignments.filter(a => a.sourceId === f.a.source.id).length, 1, 'Bulk exact-version selection is deduplicated by source ID'); assert.equal(state.assignments.find(a => a.sourceId === f.a.source.id).folderId, f.parent.id);
      await byName(page, '선택 취소'); await page.locator('#lifeSearch').fill(''); await settle(page); await chooseFolder(page, 'all');
      await assignCard(page, f.a.source.id, ''); await chooseFolder(page, 'unfiled'); await expectSources(page, [f.a.source.id, f.b.source.id]);
      await assignCard(page, f.a.source.id, f.child.id); await chooseFolder(page, 'all'); await assignCard(page, f.b.source.id, f.parent.id);
      await chooseFolder(page, f.parent.id); await expectSources(page, [f.a.source.id, f.b.source.id]);
      await saveFolder(page, { id: f.child.id, name: renamedChild, parentId: '' }); await chooseFolder(page, 'all'); await deleteFolder(page, f.parent.id);
      state = (await snapshot(page)).sourceFolders; assert.equal(state.folders.some(v => v.id === f.parent.id), false); assert.equal(state.assignments.some(v => v.sourceId === f.b.source.id), false); assert.equal(state.assignments.find(v => v.sourceId === f.a.source.id).folderId, f.child.id);
      await chooseFolder(page, 'unfiled'); await expectSources(page, [f.b.source.id]); originalsUnchanged(await snapshot(page), afterEdit);
      await page.reload(); await ready(page); await page.locator('#lifeFolderFilter:enabled').waitFor(); await chooseFolder(page, f.child.id); await expectSources(page, [f.a.source.id]); await folderEditor(page, f.child.id); assert.equal(await page.locator('#lifeFolderName').inputValue(), renamedChild);
      await captureThree(page); const beforeTrash = await snapshot(page); await readCard(page, f.a.source.id); await sourceOptions(page); await click(page, '#lifeSourceTrash'); await click(page, '#lifeSourceTrashConfirm');
      await page.locator('#lifeFolderFilter:enabled').waitFor(); await chooseFolder(page, f.child.id); await expectSources(page, []); assert.deepEqual((await snapshot(page)).sourceFolders, beforeTrash.sourceFolders, 'Trash must preserve membership');
      await openManagement(page); await click(page, '#lifeSourceTrashOpen'); await click(page, '[data-source-restore="' + f.a.source.id + '"]'); await nav(page, 'records'); await page.locator('#lifeFolderFilter:enabled').waitFor(); await chooseFolder(page, f.child.id); await expectSources(page, [f.a.source.id]);
      const final = await snapshot(page); assert.deepEqual(final.sourceFolders, beforeTrash.sourceFolders); assert.deepEqual(final.bundle.sourceVersions, beforeTrash.bundle.sourceVersions); assert.deepEqual(final.bundle.records, beforeTrash.bundle.records); for (const key of ['workbench', 'interest', 'annual', 'collection', 'discoverySettings']) assert.deepEqual(final[key], f.before[key]);
      report.observations.push({ nestedParentIncludesDescendants: true, singleSourceMembershipForBothVersions: true, sourceEditKeepsSourceId: true, searchOriginFolderFocusAndPositionReturned: true, leafDeleteOnlyUnfilesDirectSource: true, trashRestoreKeepsMembership: true, rawHashQuoteAndGroupPreserved: true });
    });

    await check('common backup and new-copy restoration remap folders, exact quotes and groups without changing either original workspace', async ({ page }) => {
      const f = await prepareFolders(page, true); await chooseFolder(page, 'all'); await assignCard(page, f.b.source.id, f.parent.id); await readCard(page, f.a.source.id); await editReader(page);
      const original = await snapshot(page), file = await commonBackup(page); assert.equal(file.format, 'life-material-library-backup-v1'); assert.deepEqual(file.sourceFolders, original.sourceFolders); assert.deepEqual(file.libraryBackup.sourceBackup.workspace, original.bundle); assert.deepEqual(file.libraryBackup.workbench, original.workbench);
      const upload = async value => { await page.locator('#wbRestoreFile').setInputFiles({ name: 'anonymous-folder-library.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) }); await page.locator('#wbRestoreInstall').waitFor(); };
      await upload(file); assert.equal(await page.locator('#wbRestoreFolderSummary').textContent(), '자료 폴더 2개'); assert.deepEqual(await snapshot(page), original, 'Preview must not install a workspace'); await byName(page, '복원 취소'); assert.equal(await page.locator('#wbRestoreInstall').count(), 0); assert.deepEqual(await snapshot(page), original);
      await upload(file); await click(page, '#wbRestoreInstall'); const copy = await waitSnapshot(page, value => value.bundle.workspaceId !== f.a.workspaceId);
      assert.notEqual(copy.bundle.workspaceId, original.bundle.workspaceId); assert.equal(copy.sourceFolders.workspaceId, copy.bundle.workspaceId); assert.equal(copy.sourceFolders.revision, 0); assert.equal(copy.sourceFolders.folders.length, original.sourceFolders.folders.length); assert.equal(copy.sourceFolders.assignments.length, original.sourceFolders.assignments.length);
      const sourceIds = new Map(original.bundle.sources.map((v, index) => [v.id, copy.bundle.sources[index].id])), versionIds = new Map(original.bundle.sourceVersions.map((v, index) => [v.id, copy.bundle.sourceVersions[index].id])), folderIds = new Map(original.sourceFolders.folders.map((v, index) => [v.id, copy.sourceFolders.folders[index].id]));
      for (const [oldId, newId] of [...sourceIds, ...versionIds, ...folderIds]) assert.notEqual(oldId, newId);
      assert.deepEqual(copy.sourceFolders.folders, original.sourceFolders.folders.map(v => ({ ...v, id: folderIds.get(v.id), parentId: v.parentId === null ? null : folderIds.get(v.parentId) }))); assert.deepEqual(copy.sourceFolders.assignments, original.sourceFolders.assignments.map(v => ({ sourceId: sourceIds.get(v.sourceId), folderId: folderIds.get(v.folderId) })));
      original.bundle.sourceVersions.forEach((v, index) => { const saved = copy.bundle.sourceVersions[index]; assert.equal(saved.sourceId, sourceIds.get(v.sourceId)); assert.equal(saved.contentText, v.contentText); assert.equal(saved.contentHash, v.contentHash); });
      const oldRecord = original.bundle.records.find(r => r.note === note), copiedRecord = copy.bundle.records.find(r => r.note === note); assert.equal(copiedRecord.text, quote); assert.deepEqual(copiedRecord.sourceRefs, oldRecord.sourceRefs.map(ref => ({ ...ref, sourceId: sourceIds.get(ref.sourceId), sourceVersionId: versionIds.get(ref.sourceVersionId) }))); const copiedQuoteVersion = copy.bundle.sourceVersions.find(v => v.id === copiedRecord.sourceRefs[0].sourceVersionId); assert.equal(copiedQuoteVersion.contentText.slice(copiedRecord.sourceRefs[0].locator.start, copiedRecord.sourceRefs[0].locator.end), quote);
      assert.deepEqual(copy.workbench.groups[0].versionIds, original.workbench.groups[0].versionIds.map(id => versionIds.get(id))); assert.notEqual(copy.workbench.groups[0].id, original.workbench.groups[0].id); assert.deepEqual(await snapshot(page, f.a.workspaceId), original);
      await records(page); await chooseFolder(page, folderIds.get(f.parent.id)); await expectSources(page, [...sourceIds.values()]); await page.reload(); await ready(page); await page.locator('#lifeFolderFilter:enabled').waitFor(); await chooseFolder(page, folderIds.get(f.child.id)); await expectSources(page, [sourceIds.get(f.a.source.id)]); assert.deepEqual((await snapshot(page)).sourceFolders, copy.sourceFolders);
      await commonBackup(page); await upload(file.libraryBackup); assert.equal(await page.locator('#wbRestoreFolderSummary').count(), 0); await click(page, '#wbRestoreInstall'); const legacy = await waitSnapshot(page, value => value.bundle.workspaceId !== copy.bundle.workspaceId); assert.deepEqual(legacy.sourceFolders.folders, []); assert.deepEqual(legacy.sourceFolders.assignments, []); assert.equal(legacy.bundle.sourceVersions.length, original.bundle.sourceVersions.length); assert.deepEqual(await snapshot(page, original.bundle.workspaceId), original); assert.deepEqual(await snapshot(page, copy.bundle.workspaceId), copy);
      report.observations.push({ commonWrapperIncludesFoldersAndExactOriginals: true, restorePreviewAndCancellationDoNotWrite: true, newSourceVersionFolderParentAssignmentIdsRemapped: true, quoteRangeAndGroupVersionRefsPreserved: true, bothPreviousWorkspacesUnchanged: true, legacyCommonBackupRestoresUnfiled: true, osFileSaved: false });
    });

    await check('two actual tabs reject a stale folder draft and preserve newer membership until explicit latest-state review and resubmission', async ({ page, context }) => {
      const f = await prepareFolders(page), before = await snapshot(page), draft = '익명 탭 A의 보존할 이름', winner = '익명 탭 B의 먼저 저장한 이름'; await folderEditor(page, f.child.id); await page.locator('#lifeFolderName').fill(draft);
      const other = await context.newPage(); await records(other); await saveFolder(other, { id: f.child.id, name: winner, parentId: f.parent.id }); await assignCard(other, f.b.source.id, f.parent.id); const committed = await snapshot(other);
      assert.equal(await page.locator('#lifeFolderName').inputValue(), draft); await click(page, '#lifeFolderSave'); await errorVisible(page); assert.equal(await page.locator('#lifeFolderName').inputValue(), draft); assert.deepEqual((await snapshot(page)).sourceFolders, committed.sourceFolders); originalsUnchanged(await snapshot(page), before);
      await click(page, '#lifeFolderReload'); assert.equal(await page.locator('#lifeFolderName').inputValue(), draft); assert.deepEqual((await snapshot(page)).sourceFolders, committed.sourceFolders, 'Latest-state review must not silently resubmit'); await click(page, '#lifeFolderSave'); const final = await waitSnapshot(page, value => value.sourceFolders.folders.find(v => v.id === f.child.id)?.name === draft);
      assert.equal(final.sourceFolders.revision, committed.sourceFolders.revision + 1); assert.deepEqual(final.sourceFolders.assignments, committed.sourceFolders.assignments); assert.deepEqual(final.sourceFolders.folders.filter(v => v.id !== f.child.id), committed.sourceFolders.folders.filter(v => v.id !== f.child.id)); originalsUnchanged(final, before); await other.close();
      report.observations.push({ actualTabs: 2, staleCASDidNotOverwrite: true, draftPreservedDuringBroadcastAndFailure: true, latestReviewDidNotWrite: true, explicitResubmissionKeepsNewerOtherMembership: true });
    });

    await check('one actual folder-profile IDB abort keeps the editable draft and original graph until an explicit retry', async ({ page }) => {
      const f = await prepareFolders(page, true), before = await snapshot(page), draft = '익명 저장 실패 후 다시 저장할 이름'; await folderEditor(page, f.child.id); await page.locator('#lifeFolderName').fill(draft); await page.locator('#lifeFolderParent').selectOption(''); await abortFolderWrite(page, true, f.a.workspaceId);
      try { await click(page, '#lifeFolderSave'); await errorVisible(page); assert.equal(await page.evaluate(() => __folderAbortCount), 1); assert.equal(await page.locator('#lifeFolderName').inputValue(), draft); assert.equal(await page.locator('#lifeFolderParent').inputValue(), ''); assert.deepEqual(await snapshot(page), before); }
      finally { await abortFolderWrite(page, false); }
      await click(page, '#lifeFolderSave'); const final = await waitSnapshot(page, value => value.sourceFolders.folders.find(v => v.id === f.child.id)?.name === draft); assert.equal(final.sourceFolders.revision, before.sourceFolders.revision + 1); assert.equal(final.sourceFolders.folders.find(v => v.id === f.child.id).parentId, null); assert.deepEqual(final.sourceFolders.assignments, before.sourceFolders.assignments); originalsUnchanged(final, before);
      report.observations.push({ actualIDBTransactionAborted: 1, narrowlyScopedMetaHookRemoved: true, exactInputAndCommittedGraphPreserved: true, explicitRetryStoredExactlyOneRevision: true });
    });
  } finally { await browser.close(); report.browserClosed = true; report.sourceHashesAfter = await hashes(); report.productsUnchangedDuringRun = JSON.stringify(report.sourceHashesBefore) === JSON.stringify(report.sourceHashesAfter); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
  for (const field of ['consoleErrors', 'pageErrors', 'externalRequests', 'privacyViolations', 'remoteWrites']) assert.deepEqual(report[field], [], field); assert.equal(report.productsUnchangedDuringRun, true); assert.ok(report.checks.length && report.checks.every(c => c.pass)); assert.equal(report.closedContexts, report.checks.length);
  console.log('Source folders: ' + report.checks.length + ' passed; no external requests, remote writes or lost originals.');
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

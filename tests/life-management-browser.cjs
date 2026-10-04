/* Management journeys through real DOM/SDK/IDB, with anonymous intercepted HTTP only.
 * npm run dev; node tests/life-management-browser.cjs
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { FakeCloud, accounts, cloud, base, openManagement } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, nav, makeContext, observe } = require('./unified-home-browser.cjs');
const { seed } = require('../scripts/check-life-collections-design.cjs');
const backupTitle = '다시 읽을 문장과 산책 메모를 출처와 함께 모아 두고 천천히 연결해 보는 자료';
const backupName = '다시-읽기와-출처를-함께-보관한-자료-백업-2026-10-04.json';
const button = async (page, name) => { await page.getByRole('button', { name, exact: true }).click(); await settle(page); };
const bundle = page => page.evaluate(async () => HaedoLife.Shell.storage.read(await HaedoLife.Shell.storage.getActive()));
const workspaces = page => page.evaluate(() => HaedoLife.Shell.storage.listWorkspaces());
// Poll the awaited value in Node. A Promise object itself must never satisfy a browser predicate.
async function waitSyncState(page, predicate, { storage = false, timeout = 15000 } = {}) {
  const deadline = Date.now() + timeout; let latest;
  while (Date.now() < deadline) {
    latest = await page.evaluate(async fromStorage => {
      const id = await HaedoLife.Shell.storage.getActive();
      return fromStorage ? HaedoLife.Shell.storage.getSyncState(id) : HaedoLife.Shell.sync.getState(id);
    }, storage);
    if (predicate(latest) === true) return latest;
    await page.waitForTimeout(30);
  }
  throw new Error('Timed out waiting for sync state; last status: ' + (latest?.status || 'unbound'));
}
async function transfer(page) { await openManagement(page); await button(page, '내보내기·사본 복원'); }
async function syncing(page) { await openManagement(page); await button(page, '기기 간 동기화'); }
async function choose(page, backup, name = backupName) {
  await page.locator('#lifeRestoreFile').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(typeof backup === 'string' ? backup : JSON.stringify(backup)) }); await settle(page);
}
async function fixture(page, { draft = false } = {}) {
  await page.goto(base + '/index.html'); await ready(page); await seed(page);
  const data = await page.evaluate(async title => {
    const storage = HaedoLife.Shell.storage, core = HaedoLife.Core;
    let value = await storage.read(await storage.getActive());
    for (const spec of [{ title: '본문 없이 주소만 보관한 읽기 자료', url: 'https://example.invalid/saved-reading', text: null, coverage: { status: 'link_only', omissions: ['본문과 사진은 확보하지 않음'] } },
      { title: value.sources[0].title, origin: value.sources[0].origin, text: '다음 날 다시 읽으며 덧붙인 새 원문 버전\r\n원래 발췌의 예전 버전은 그대로 보관합니다.', existingSourceId: value.sources[0].id, coverage: { status: 'full_text', omissions: [] } }]) {
      const prepared = await core.prepareImport({ origin: 'other', ...spec }, value);
      prepared.version.importedAt = '2026-10-04T00:00:00.000Z';
      const result = await storage.commitLocal({ workspaceId: value.workspaceId, baseRevision: value.revision, operationId: core.id(), changes: core.buildImportChanges(value, prepared, []) });
      if (result.status !== 'stored') throw new Error('Management fixture rejected');
      value = await storage.read(value.workspaceId);
    }
    const backup = core.makeBackup({ ...value, title }); backup.exportedAt = '2026-10-04T00:00:00.000Z';
    return { original: value, backup };
  }, backupTitle);
  await page.reload(); await ready(page);
  if (draft) { await button(page, '가져오기'); await page.locator('#lifeImportTitle').fill('아직 확정하지 않은 읽기 메모'); await page.locator('#lifeImportText').fill('복원 중에도 보존할 검토 내용🌱'); await button(page, '검토 내용 보관'); }
  data.stages = await page.evaluate(id => HaedoLife.Shell.storage.listStages(id), data.original.workspaceId);
  return data;
}
async function enable(page) {
  await button(page, '이 작업공간 동기화 시작');
  await page.evaluate(async () => HaedoLife.Shell.sync.syncNow(await HaedoLife.Shell.storage.getActive()));
  await waitSyncState(page, state => state?.status === 'synced');
}
async function conflict(page, server) {
  const value = await bundle(page), row = structuredClone(server.row(accounts.a.id, value.workspaceId));
  row.revision++; row.updated_at = '2026-10-04T01:00:00.000Z'; row.data.revision++;
  row.data.records[0].note = '서버에서 다시 읽고 덧붙인 생각을 보존합니다.'; row.data.records[0].revision++;
  server.rows.set(server.key(accounts.a.id, value.workspaceId), row);
  await page.evaluate(async row => {
    const storage = HaedoLife.Shell.storage, state = await storage.getSyncState(row.id);
    const clean = { id: row.id, title: row.title, revision: row.revision, updated_at: row.updated_at, data: row.data };
    await storage.setSyncConflict(row.id, state.binding, clean);
  }, row);
  await page.waitForFunction(() => [...document.querySelectorAll('#lifeSyncState button')].some(el => el.textContent === '양쪽 변경 비교'));
  return { local: value, remote: row.data };
}
async function unchanged(page, initial, ids) {
  assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), initial.original.workspaceId), initial.original);
  assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.listStages(id), initial.original.workspaceId), initial.stages);
  if (ids) assert.deepEqual((await workspaces(page)).map(w => w.workspaceId).sort(), ids);
}
async function sourceMemo(page, title, note) {
  await nav(page, 'records'); await button(page, '원천 기록');
  await page.locator('#lifeSearch').fill(title);
  await button(page, '자료 읽기: ' + title);
  const selected = await page.locator('#lifeSourceText').evaluate(el => {
    const end = Array.from(el.textContent).slice(0, 12).join('').length;
    getSelection().setBaseAndExtent(el.firstChild, 0, el.firstChild, end);
    return { start: 0, end, text: el.textContent };
  });
  await button(page, '발췌와 주제 연결');
  assert.equal(await page.locator('#lifeSourceNote').inputValue(), '', 'a previous workspace draft leaked into this reader');
  await page.locator('#lifeSourceNote').fill(note);
  return selected;
}
const stagesFor = (page, id) => page.evaluate(id => HaedoLife.Shell.storage.listStages(id), id);
function savedMemo(stages, note, selected) {
  const matches = stages.filter(stage => stage.excerpts.some(excerpt => excerpt.note === note));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].input.text, selected.text);
  assert.deepEqual(matches[0].excerpts.map(({ start, end, note: saved }) => ({ start, end, note: saved })), [{ start: selected.start, end: selected.end, note }]);
}
async function abortStageWrites(page, enabled) {
  await page.evaluate(enabled => {
    if (!window.__boundaryStagePut) window.__boundaryStagePut = IDBObjectStore.prototype.put;
    window.__boundaryStageAborts = 0;
    IDBObjectStore.prototype.put = enabled ? function (...args) {
      const request = __boundaryStagePut.apply(this, args);
      if (this.name === 'staging') { __boundaryStageAborts++; this.transaction.abort(); }
      return request;
    } : __boundaryStagePut;
  }, enabled);
}
async function main() {
  await fs.mkdir('.local/life-management', { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { checks: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, realRemoteWrites: 0, browser: browser.version() };
  async function check(name, run) {
    if (process.env.MANAGEMENT_TEST_MATCH && !new RegExp(process.env.MANAGEMENT_TEST_MATCH).test(name)) return;
    const server = new FakeCloud(), device = 'management-' + report.checks.length, context = await makeContext(browser, server, device), page = await context.newPage();
    page.setDefaultTimeout(15000); observe(page, report, name);
    try { await run({ page, server, device, context }); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
    finally { await context.close(); }
  }
  try {
    await check('restore preview identifies file, title, counts and incomplete coverage without installing; cancel preserves original and drafts', async ({ page, server }) => {
      const initial = await fixture(page, { draft: true }), ids = (await workspaces(page)).map(w => w.workspaceId).sort();
      await transfer(page); await choose(page, initial.backup);
      const preview = page.locator('#lifeRestorePreview'), text = await preview.innerText();
      assert.ok(text.includes(backupName)); assert.ok(text.includes(backupTitle));
      assert.match(text, /자료\s*7/); assert.match(text, /(?:원문\s*)?버전\s*8/); assert.match(text, /발췌\s*12/);
      assert.match(text, /본문.*(?:일부|부분)/); assert.match(text, /(?:본문 미확보|링크만)/);
      await unchanged(page, initial, ids); assert.equal(await page.evaluate(() => HaedoLife.Shell.storage.getActive()), initial.original.workspaceId);
      await button(page, '복원 취소'); assert.equal(await preview.innerText(), ''); assert.equal(await page.locator('#lifeRestoreFile').inputValue(), '');
      assert.equal(await page.getByRole('button', { name: '새 사본으로 복원', exact: true }).count(), 0);
      await unchanged(page, initial, ids); assert.equal(server.writes().length, 0);
    });
    await check('invalid file after valid preview removes the older candidate and leaves all saved work intact', async ({ page, server }) => {
      const initial = await fixture(page), ids = (await workspaces(page)).map(w => w.workspaceId).sort(); await transfer(page);
      await choose(page, initial.backup); await choose(page, '{invalid', '내용이-깨진-백업.json');
      assert.equal(await page.locator('#lifeError').isVisible(), true); assert.equal(await page.getByRole('button', { name: '새 사본으로 복원', exact: true }).count(), 0);
      await unchanged(page, initial, ids); assert.equal(server.writes().length, 0);
    });
    await check('explicit restore makes an unbound remapped copy, preserves exact source references, and returns to the previous workspace', async ({ page, server }) => {
      const initial = await fixture(page, { draft: true }); await transfer(page); await choose(page, initial.backup); await button(page, '새 사본으로 복원');
      const restored = await bundle(page); assert.notEqual(restored.workspaceId, initial.original.workspaceId); assert.equal(restored.title, backupTitle);
      assert.equal(restored.sources.length, 7); assert.equal(restored.sourceVersions.length, 8); assert.equal(restored.records.length, 12);
      assert.deepEqual(restored.sourceVersions.map(v => v.contentText).sort(), initial.original.sourceVersions.map(v => v.contentText).sort());
      assert.ok(restored.sourceVersions.every(v => !initial.original.sourceVersions.some(old => old.id === v.id)));
      for (const record of restored.records) for (const ref of record.sourceRefs) assert.equal(restored.sourceVersions.find(v => v.id === ref.sourceVersionId).contentText.slice(ref.locator.start, ref.locator.end), record.text);
      assert.equal(await page.evaluate(id => HaedoLife.Shell.storage.getSyncState(id), restored.workspaceId), null);
      assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.listStages(id), restored.workspaceId), []);
      assert.equal(await page.locator('#lifeRestoreResult').isVisible(), true); await unchanged(page, initial);
      await button(page, '이전 작업공간으로 돌아가기'); assert.equal((await bundle(page)).workspaceId, initial.original.workspaceId);
      await unchanged(page, initial); assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), restored.workspaceId), restored);
      assert.equal(server.writes().length, 0);
    });
    await check('an interrupted restore leaves the preview retryable and creates only one complete copy after retry', async ({ page, server }) => {
      const initial = await fixture(page), ids = (await workspaces(page)).map(w => w.workspaceId).sort(); await transfer(page); await choose(page, initial.backup);
      await page.evaluate(() => { const add = IDBObjectStore.prototype.add; window.__restoreAdd = add; window.__restoreAborts = 0; IDBObjectStore.prototype.add = function (value, ...rest) { if (this.name === 'bundles') { __restoreAborts++; this.transaction.abort(); throw new DOMException('Anonymous interrupted restore', 'AbortError'); } return add.call(this, value, ...rest); }; });
      await button(page, '새 사본으로 복원'); assert.ok(await page.evaluate(() => __restoreAborts > 0)); assert.equal(await page.locator('#lifeError').isVisible(), true);
      await unchanged(page, initial, ids); assert.equal((await bundle(page)).workspaceId, initial.original.workspaceId);
      assert.equal(await page.getByRole('button', { name: '새 사본으로 복원', exact: true }).isVisible(), true);
      await page.evaluate(() => { IDBObjectStore.prototype.add = __restoreAdd; }); await button(page, '새 사본으로 복원');
      assert.equal((await workspaces(page)).length, ids.length + 1); await unchanged(page, initial); assert.equal(server.writes().length, 0);
    });
    await check('a post-install read failure reports the saved copy and removes the old confirmation instead of offering duplicate installation', async ({ page, server }) => {
      const initial = await fixture(page), count = (await workspaces(page)).length; await transfer(page); await choose(page, initial.backup);
      await page.evaluate(() => {
        const add = IDBObjectStore.prototype.add, get = IDBObjectStore.prototype.get;
        window.__postRestoreOriginal = { add, get }; window.__postRestoreReadAborts = 0;
        IDBObjectStore.prototype.add = function (value, ...rest) {
          const request = add.call(this, value, ...rest);
          if (this.name === 'bundles') request.addEventListener('success', () => { window.__postRestoreFailureId = value.workspaceId; });
          return request;
        };
        IDBObjectStore.prototype.get = function (key) {
          if (this.name === 'bundles' && key === window.__postRestoreFailureId) { window.__postRestoreFailureId = null; __postRestoreReadAborts++; this.transaction.abort(); throw new DOMException('Anonymous post-install read failure', 'AbortError'); }
          return get.call(this, key);
        };
      });
      await button(page, '새 사본으로 복원');
      assert.ok(await page.evaluate(() => __postRestoreReadAborts > 0));
      await page.evaluate(() => { IDBObjectStore.prototype.add = __postRestoreOriginal.add; IDBObjectStore.prototype.get = __postRestoreOriginal.get; });
      assert.equal(await page.getByRole('button', { name: '새 사본으로 복원', exact: true }).count(), 0);
      assert.equal(await page.locator('#lifeRestoreResult').isVisible(), true); assert.equal((await workspaces(page)).length, count + 1);
      assert.notEqual((await bundle(page)).workspaceId, initial.original.workspaceId);
      await button(page, '이전 작업공간으로 돌아가기'); await unchanged(page, initial); assert.equal(server.writes().length, 0);
    });
    await check('boundary: unsaved source selections and notes are preserved separately before restore and before return', async ({ page, server }) => {
      const initial = await fixture(page), source = initial.original.sources[1];
      const first = await sourceMemo(page, source.title, '복원 전에 원문에서 작성 중인 메모🌱');
      assert.deepEqual(await stagesFor(page, initial.original.workspaceId), []);
      await transfer(page); await choose(page, initial.backup); await button(page, '새 사본으로 복원');
      const restored = await bundle(page), previousStages = await stagesFor(page, initial.original.workspaceId);
      savedMemo(previousStages, '복원 전에 원문에서 작성 중인 메모🌱', first);
      assert.deepEqual(await stagesFor(page, restored.workspaceId), []);
      const second = await sourceMemo(page, source.title, '새 사본에서 복귀 전에 작성 중인 다른 메모📚');
      await button(page, '모아보기');
      assert.deepEqual(await stagesFor(page, restored.workspaceId), []);
      await button(page, '이전 작업공간으로 돌아가기');
      assert.equal((await bundle(page)).workspaceId, initial.original.workspaceId);
      assert.deepEqual(await stagesFor(page, initial.original.workspaceId), previousStages, 'stale reader cache rewrote the previous workspace draft');
      savedMemo(await stagesFor(page, restored.workspaceId), '새 사본에서 복귀 전에 작성 중인 다른 메모📚', second);
      assert.deepEqual(await bundle(page), initial.original); assert.equal(server.writes().length, 0);
    });
    await check('boundary: source draft transaction failure blocks both restore and return until a successful retry', async ({ page, server }) => {
      const initial = await fixture(page), count = (await workspaces(page)).length, source = initial.original.sources[1];
      const first = await sourceMemo(page, source.title, '복원 실패 후에도 보존할 메모');
      await transfer(page); await choose(page, initial.backup); await abortStageWrites(page, true);
      await button(page, '새 사본으로 복원');
      assert.ok(await page.evaluate(() => __boundaryStageAborts > 0));
      assert.equal((await bundle(page)).workspaceId, initial.original.workspaceId); assert.equal((await workspaces(page)).length, count);
      assert.equal(await page.getByRole('button', { name: '새 사본으로 복원', exact: true }).isVisible(), true);
      assert.deepEqual(await stagesFor(page, initial.original.workspaceId), []);
      await abortStageWrites(page, false); await button(page, '새 사본으로 복원');
      const restored = await bundle(page); savedMemo(await stagesFor(page, initial.original.workspaceId), '복원 실패 후에도 보존할 메모', first);
      const second = await sourceMemo(page, source.title, '복귀 실패 후에도 새 사본에 남길 메모'); await button(page, '모아보기');
      await abortStageWrites(page, true); await button(page, '이전 작업공간으로 돌아가기');
      assert.ok(await page.evaluate(() => __boundaryStageAborts > 0));
      assert.equal((await bundle(page)).workspaceId, restored.workspaceId); assert.equal(await page.locator('#lifeRestoreResult').isVisible(), true);
      assert.deepEqual(await stagesFor(page, restored.workspaceId), []);
      await abortStageWrites(page, false); await button(page, '이전 작업공간으로 돌아가기');
      assert.equal((await bundle(page)).workspaceId, initial.original.workspaceId);
      savedMemo(await stagesFor(page, restored.workspaceId), '복귀 실패 후에도 새 사본에 남길 메모', second);
      assert.equal((await workspaces(page)).length, count + 1); assert.equal(server.writes().length, 0);
    });
    await check('boundary: a post-return read failure shows the previous workspace and preserves the restored copy after activation commits', async ({ page, server }) => {
      const initial = await fixture(page); await transfer(page); await choose(page, initial.backup); await button(page, '새 사본으로 복원');
      const restored = await bundle(page);
      await page.evaluate(id => {
        const put = IDBObjectStore.prototype.put, get = IDBObjectStore.prototype.get;
        window.__returnOriginal = { put, get }; window.__returnReadAborts = 0;
        IDBObjectStore.prototype.put = function (value, ...rest) {
          const request = put.call(this, value, ...rest);
          if (this.name === 'meta' && value.value === id) this.transaction.addEventListener('complete', () => { window.__returnReadFailureId = id; });
          return request;
        };
        IDBObjectStore.prototype.get = function (key) {
          if (this.name === 'bundles' && key === window.__returnReadFailureId) { window.__returnReadFailureId = null; __returnReadAborts++; this.transaction.abort(); throw new DOMException('Anonymous post-return read failure', 'AbortError'); }
          return get.call(this, key);
        };
      }, initial.original.workspaceId);
      await button(page, '이전 작업공간으로 돌아가기'); assert.ok(await page.evaluate(() => __returnReadAborts > 0));
      await page.evaluate(() => { IDBObjectStore.prototype.put = __returnOriginal.put; IDBObjectStore.prototype.get = __returnOriginal.get; });
      assert.equal((await bundle(page)).workspaceId, initial.original.workspaceId);
      assert.equal(await page.locator('#lifeRestoreResult').count(), 0); assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'topics');
      assert.match(await page.locator('#lifeError').innerText(), /이전 작업공간을 열었고.*사본도 보관/);
      await unchanged(page, initial); assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), restored.workspaceId), restored);
      assert.equal(server.writes().length, 0);
    });
    await check('sync starts only by explicit action, folds account details, and offers a clear paused/resume path without losing data', async ({ page, server }) => {
      const initial = await fixture(page); await syncing(page); const details = page.locator('#lifeSyncDetails');
      assert.equal(await details.getAttribute('open'), null); assert.equal(await details.getByText(cloud, { exact: false }).isVisible(), false);
      assert.equal(server.writes().length, 0); await details.locator('summary').focus(); await page.keyboard.press('Enter');
      assert.equal(await details.getAttribute('open'), ''); assert.ok((await details.innerText()).includes(accounts.a.email)); assert.ok((await details.innerText()).includes(cloud));
      await details.locator('summary').click(); await enable(page); assert.ok(server.writes().length >= 1);
      assert.match(await page.locator('#lifeSyncStatus').innerText(), /서버|동기화/);
      await button(page, '연결 중지'); assert.match(await page.locator('#lifeSyncStatus').innerText(), /중지/);
      assert.equal(await page.getByRole('button', { name: '이 작업공간 동기화 시작', exact: true }).isVisible(), true);
      assert.equal(await page.getByRole('button', { name: '지금 동기화', exact: true }).count(), 0); await unchanged(page, initial);
    });
    await check('sync failure preserves local data and keeps retry next to the visible status', async ({ page, server, device }) => {
      const initial = await fixture(page); await syncing(page); await enable(page); server.offline.add(device); page.expectedAuthFailure = true;
      await button(page, '지금 동기화'); assert.match(await page.locator('#lifeSyncStatus').innerText(), /실패|오류|연결|확인/);
      assert.equal(await page.getByRole('button', { name: '지금 동기화', exact: true }).isVisible(), true); await unchanged(page, initial);
      server.offline.delete(device); await button(page, '지금 동기화'); await unchanged(page, initial);
    });
    await check('conflict keeps both original-version texts and notes available beside the two preservation choices', async ({ page, server }) => {
      await fixture(page); await syncing(page); await enable(page); const sides = await conflict(page, server);
      await button(page, '양쪽 변경 비교'); const comparison = page.locator('#lifeSyncConflict');
      assert.equal(await comparison.getByRole('heading', { name: '내 변경', exact: true }).isVisible(), true);
      assert.equal(await comparison.getByRole('heading', { name: '서버 변경', exact: true }).isVisible(), true);
      const sections = comparison.locator('.life-conflict-grid > section'); assert.equal(await sections.count(), 2);
      for (let side = 0; side < 2; side++) {
        const section = sections.nth(side); await section.locator('.life-conflict-text > summary').first().click();
        assert.equal(await section.locator('.life-conflict-content').first().textContent(), sides.local.sourceVersions[0].contentText);
        await section.getByText('발췌·주제·메모 내용 확인', { exact: true }).click();
        assert.ok((await section.innerText()).includes((side ? sides.remote : sides.local).records[0].note));
      }
      assert.equal(await comparison.getByRole('button', { name: '서버 변경 받기 · 내 변경은 사본 보관', exact: true }).isVisible(), true);
      assert.equal(await comparison.getByRole('button', { name: '내 변경 보내기 · 서버 변경은 사본 보관', exact: true }).isVisible(), true);
      assert.deepEqual(await bundle(page), sides.local);
    });
    await check('a newer server revision invalidates the older comparison and requires a fresh review without creating a recovery copy', async ({ page, server }) => {
      await fixture(page); await syncing(page); await enable(page); const sides = await conflict(page, server);
      await button(page, '양쪽 변경 비교'); const count = (await workspaces(page)).length, writes = server.writes().length;
      const newer = structuredClone(server.row(accounts.a.id, sides.local.workspaceId));
      newer.revision++; newer.data.revision++; newer.data.records[0].revision++; newer.data.records[0].note = '비교 화면을 연 뒤 서버에서 추가된 세 번째 변경입니다.';
      server.rows.set(server.key(accounts.a.id, sides.local.workspaceId), newer);
      await button(page, '서버 변경 받기 · 내 변경은 사본 보관');
      assert.equal((await page.evaluate(id => HaedoLife.Shell.storage.getSyncState(id), sides.local.workspaceId)).conflict.remoteRevision, newer.revision);
      assert.equal(await page.locator('#lifeSyncConflict button').count(), 0); assert.equal((await workspaces(page)).length, count);
      assert.equal(server.writes().length, writes); assert.deepEqual(await bundle(page), sides.local);
      await button(page, '양쪽 변경 비교');
      const remote = page.locator('#lifeSyncConflict .life-conflict-grid > section').nth(1);
      await remote.getByText('발췌·주제·메모 내용 확인', { exact: true }).click(); assert.ok((await remote.innerText()).includes(newer.data.records[0].note));
    });
    await check('boundary: deleting the server workspace during comparison invalidates stale choices without writing or making a recovery copy', async ({ page, server }) => {
      await fixture(page); await syncing(page); await enable(page); const sides = await conflict(page, server); await button(page, '양쪽 변경 비교');
      const count = (await workspaces(page)).length, writes = server.writes().length;
      server.rows.delete(server.key(accounts.a.id, sides.local.workspaceId));
      await button(page, '서버 변경 받기 · 내 변경은 사본 보관');
      await waitSyncState(page, state => state?.conflict?.missing === true, { storage: true });
      assert.equal(await page.locator('#lifeSyncConflict button').count(), 0);
      assert.equal(await page.getByRole('button', { name: '자료 백업·복원', exact: true }).isVisible(), true);
      assert.equal((await workspaces(page)).length, count); assert.equal(server.writes().length, writes); assert.deepEqual(await bundle(page), sides.local);
    });
    await check('boundary: pausing while conflict resolution is reading the server removes comparison choices and offers only restart', async ({ page, server, device }) => {
      await fixture(page); await syncing(page); await enable(page); const sides = await conflict(page, server); await button(page, '양쪽 변경 비교');
      const count = (await workspaces(page)).length, writes = server.writes().length;
      let enter, release; const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
      server.heldRead = { device, id: sides.local.workspaceId, entered: enter, release: gate };
      try {
        await page.getByRole('button', { name: '서버 변경 받기 · 내 변경은 사본 보관', exact: true }).click();
        let timer;
        try { await Promise.race([entered, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Resolution never read the server')), 15000); })]); }
        finally { clearTimeout(timer); }
        await page.evaluate(id => HaedoLife.Shell.sync.pause(id), sides.local.workspaceId); release(); await settle(page);
        await waitSyncState(page, state => state?.status === 'paused');
        await page.getByRole('button', { name: '이 작업공간 동기화 시작', exact: true }).waitFor();
        assert.equal(await page.locator('#lifeSyncConflict button').count(), 0);
        assert.deepEqual(await page.locator('#lifeSyncState .life-actions button').allTextContents(), ['이 작업공간 동기화 시작']);
        assert.equal((await workspaces(page)).length, count); assert.equal(server.writes().length, writes); assert.deepEqual(await bundle(page), sides.local);
      } finally { release(); server.heldRead = null; }
    });
  } finally { await browser.close(); report.capturedAt = new Date().toISOString(); await fs.writeFile('.local/life-management/' + (process.env.MANAGEMENT_REPORT || (process.env.MANAGEMENT_TEST_MATCH ? 'browser-recheck-report.json' : 'browser-report.json')), JSON.stringify(report, null, 2) + '\n'); }
  const failed = report.checks.filter(c => !c.pass).length;
  console.log(JSON.stringify({ passed: report.checks.length - failed, failed, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, expectedErrors: report.expectedErrors, realRemoteWrites: 0 }));
  if (failed || report.consoleErrors.length || report.pageErrors.length) process.exitCode = 1;
}
module.exports = { fixture, transfer, syncing, choose, bundle, enable, conflict, button, backupTitle, backupName, waitSyncState };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

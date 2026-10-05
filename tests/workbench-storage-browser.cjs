/* Real IndexedDB/BroadcastChannel across two tabs, anonymous intercepted Auth/Sync only.
 * BASE_URL=http://127.0.0.1:4184 node tests/workbench-storage-browser.cjs
 * A separate local harness avoids depending on an in-progress UI.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, platformContext, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright } = require('./unified-home-browser.cjs');
const harnessPath = '/__workbench_storage_harness__.html';
const scripts = ['vendor/idb/idb.js', 'vendor/supabase/supabase.js', 'assets/platform-config.js', 'assets/platform-auth.js',
  'assets/life/core.js', 'assets/life/workbench.js', 'assets/life/storage.js', 'assets/life/remote.js', 'assets/platform-life-remote.js', 'assets/life/sync.js'];
const harness = '<!doctype html><html lang="ko"><meta charset="utf-8"><title>익명 구성 저장 검증</title><link rel="icon" href="data:,">' +
  '<main>격리된 저장 계층 검증</main>' + scripts.map(file => '<script src="/' + file + '"></script>').join('') + '</html>';

async function main() {
  const output = path.resolve(__dirname, '../.local/workbench/storage-report.json');
  await fs.mkdir(path.dirname(output), { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const server = new FakeCloud(), context = await browser.newContext({ serviceWorkers: 'block' });
  const report = { browser: browser.version(), capturedAt: new Date().toISOString(),
    environment: 'Linux Chromium; real IndexedDB and BroadcastChannel in two tabs; bundled SDK and intercepted anonymous Supabase HTTP; no UI or Apple-device verification',
    checks: [], consoleErrors: [], pageErrors: [], unexpectedRequests: [], realRemoteWrites: 0 };
  const pages = [];
  async function check(name, action) {
    try { const evidence = await action(); report.checks.push({ name, pass: true, ...(evidence ? { evidence } : {}) }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
  }
  async function open(label) {
    const page = await context.newPage(); pages.push(page); page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.pageErrors.push({ tab: label, message: error.message }));
    page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ tab: label, message: event.text() }); });
    await page.goto(base + harnessPath);
    await page.evaluate(async () => {
      const user = await HaedoAuth.verify();
      if (!user) throw new Error('Anonymous server-verified test account missing');
      globalThis.__workbenchStorage = HaedoLife.Storage.forAccount({ projectUrl: HaedoAuth.config.url, userId: user.id });
      await __workbenchStorage.open();
      globalThis.__workbenchEvents = [];
    });
    return page;
  }
  try {
    await platformContext(context, server, 'workbench-storage', accounts.a);
    await context.route(base + harnessPath, route => route.fulfill({ contentType: 'text/html', body: harness }));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(base).origin || url.origin === cloud) return route.fallback();
      report.unexpectedRequests.push(url.origin); return route.abort('blockedbyclient');
    });
    const first = await open('first');
    const original = await first.evaluate(async () => {
      const storage = __workbenchStorage, core = HaedoLife.Core;
      const empty = await storage.createWorkspace('익명 두 탭 구성 검증');
      const prepared = await core.prepareImport({ origin: 'naver_blog', title: '다시 읽는 원문', text: '한글 원문\r\n🌱 다시 읽는 문장', coverage: 'partial' }, empty);
      const result = await storage.commitLocal({ workspaceId: empty.workspaceId, baseRevision: empty.revision, operationId: core.id(),
        changes: core.buildImportChanges(empty, prepared, []) });
      if (result.status !== 'stored') throw new Error('Anonymous source fixture rejected');
      const bundle = await storage.read(empty.workspaceId);
      globalThis.__workbenchSync = HaedoLife.Sync.create({ storage, core, remoteFactory: HaedoLife.PlatformRemote.create });
      await __workbenchSync.start(); await __workbenchSync.enable(bundle.workspaceId); await __workbenchSync.syncNow(bundle.workspaceId);
      return bundle;
    });
    assert.equal(server.writes().length, 1, 'one explicit synthetic baseline material upload required');
    const baselineWrites = server.writes().length, baselineRemote = structuredClone(server.row(accounts.a.id, original.workspaceId));
    const second = await open('second');
    for (const [page, title] of [[first, '첫 탭의 구성'], [second, '다른 탭의 구성']]) {
      await page.evaluate(async ({ id, title }) => {
        __workbenchStorage.subscribe(id, event => __workbenchEvents.push(event));
        globalThis.__workbenchDraft = await __workbenchStorage.readWorkbench(id);
        if (__workbenchDraft.revision !== 0) throw new Error('Both readers must hold revision zero');
        __workbenchDraft.page.intro = title;
      }, { id: original.workspaceId, title });
    }
    let results;
    await check('two tabs racing from revision zero commit exactly one configuration and reject the other stale draft', async () => {
      const startAt = Date.now() + 100;
      results = await Promise.all([first, second].map(page => page.evaluate(async ({ id, startAt }) => {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, startAt - Date.now())));
        try { const state = await __workbenchStorage.saveWorkbench(id, __workbenchDraft, 0); return { status: 'saved', revision: state.revision, intro: state.page.intro }; }
        catch (error) { return { status: 'rejected', code: error.code, retainedIntro: __workbenchDraft.page.intro, retainedRevision: __workbenchDraft.revision }; }
      }, { id: original.workspaceId, startAt })));
      assert.equal(results.filter(result => result.status === 'saved').length, 1);
      const loser = results.find(result => result.status === 'rejected'); assert.equal(loser.code, 'workbench_conflict');
      assert.equal(loser.retainedRevision, 0); assert.ok(loser.retainedIntro);
      const snapshots = await Promise.all([first, second].map(page => page.evaluate(id => __workbenchStorage.readWorkbench(id), original.workspaceId)));
      assert.deepEqual(snapshots[0], snapshots[1]); assert.equal(snapshots[0].revision, 1);
      assert.equal(snapshots[0].page.intro, results.find(result => result.status === 'saved').intro);
      return { successfulWrites: 1, rejectedStaleWrites: 1, persistedRevision: 1, losingDraftRetained: true };
    });
    await check('the winning workbench revision reaches the other tab through its separate subscription', async () => {
      for (const page of [first, second]) await page.waitForFunction(id => __workbenchEvents.some(event =>
        event.type === 'workbench_changed' && event.workspaceId === id && event.revision === 1), original.workspaceId);
      const events = await Promise.all([first, second].map(page => page.evaluate(() => __workbenchEvents.filter(event => event.type === 'workbench_changed'))));
      assert.deepEqual(events.map(items => items.length), [1, 1]);
      assert.ok(results?.some(result => result.status === 'rejected'), 'subscription must include the tab that did not commit');
      return { subscribers: 2, workbenchEventsPerTab: [1, 1], losingTabReceivedBroadcast: true };
    });
    await check('configuration writes leave material, its sync state and the intercepted remote snapshot unchanged', async () => {
      await first.waitForTimeout(450); // Exceeds the existing 300 ms material-write debounce.
      await first.evaluate(id => __workbenchSync.syncNow(id), original.workspaceId);
      const snapshot = await first.evaluate(async id => ({ bundle: await __workbenchStorage.read(id), state: await __workbenchStorage.getSyncState(id) }), original.workspaceId);
      assert.deepEqual(snapshot.bundle, original); assert.equal(snapshot.state.status, 'synced');
      assert.equal(snapshot.state.outbox, null); assert.equal(snapshot.state.syncedLocalRevision, original.revision);
      assert.equal(server.writes().length, baselineWrites); assert.deepEqual(server.row(accounts.a.id, original.workspaceId), baselineRemote);
      return { explicitBaselineSyntheticWrites: baselineWrites, additionalMaterialWritesAfterWorkbenchChange: 0, pendingMaterialUpload: false };
    });
    await check('a different account scope in the same browser cannot read or save the existing account configuration', async () => {
      const foreign = await open('foreign-scope');
      const result = await foreign.evaluate(async ({ id, owner }) => {
        // Storage-owner checks are tested with an explicit B handle; this does not claim a real B login.
        const storage = HaedoLife.Storage.forAccount(owner), codes = [];
        for (const action of [() => storage.readWorkbench(id), () => storage.readWorkbenchSnapshot(id),
          () => storage.saveWorkbench(id, HaedoLife.Workbench.empty(id), 0)]) {
          try { await action(); codes.push('unexpected-success'); } catch (error) { codes.push(error.code); }
        }
        const list = await storage.listWorkspaces(); storage.dispose(); return { codes, workspaces: list.length };
      }, { id: original.workspaceId, owner: { projectUrl: cloud, userId: accounts.b.id } });
      assert.deepEqual(result.codes, ['workspace_access_denied', 'workspace_access_denied', 'workspace_access_denied']);
      assert.equal(result.workspaces, 0);
      assert.equal((await first.evaluate(id => __workbenchStorage.readWorkbench(id), original.workspaceId)).revision, 1);
      return { rejectedForeignOperations: 3, visibleForeignWorkspaces: 0, accountASavedRevision: 1 };
    });
    await check('browser execution stays inside the local and anonymous intercepted endpoints without unexpected errors', async () => {
      assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.unexpectedRequests, []);
      return { consoleErrors: 0, pageErrors: 0, unexpectedRequests: 0, realRemoteWrites: 0 };
    });
  } catch (error) {
    report.setupError = error.stack; console.error(error.stack);
  } finally {
    for (const page of pages) {
      try { await page.evaluate(() => { globalThis.__workbenchSync?.dispose(); globalThis.__workbenchStorage?.dispose(); HaedoLife.Storage.clearAccount(); }); } catch (_) {}
    }
    await context.close(); await browser.close();
    await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ passed: report.checks.filter(check => check.pass).length, failed: report.checks.filter(check => !check.pass).length,
    setupError: !!report.setupError, report: path.relative(process.cwd(), output) }));
  if (report.setupError || report.checks.some(check => !check.pass) || report.consoleErrors.length || report.pageErrors.length || report.unexpectedRequests.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

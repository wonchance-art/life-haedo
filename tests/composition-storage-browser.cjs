/* Real IndexedDB and BroadcastChannel; no authenticated provider or remote writes.
 * BASE_URL=http://127.0.0.1:4184 node tests/composition-storage-browser.cjs
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright } = require('./unified-home-browser.cjs');
const base = (process.env.BASE_URL || 'http://127.0.0.1:4184').replace(/\/$/, '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) throw new Error('Local anonymous server required');
const harnessPath = '/__composition_storage_harness__.html';
const harness = '<!doctype html><html lang="ko"><meta charset="utf-8"><title>익명 구성 저장 검사</title><link rel="icon" href="data:,"><main>저장 계층 검사</main>' +
  ['vendor/idb/idb.js', 'assets/life/core.js', 'assets/life/workbench.js', 'assets/life/storage.js'].map(file => `<script src="/${file}"></script>`).join('') + '</html>';
const owner = { projectUrl: 'https://composition-storage-test.supabase.co', userId: '11111111-1111-4111-8111-111111111111' };
async function installHelpers(page, account = owner) {
  await page.evaluate(async account => {
    const S = HaedoLife.Storage.forAccount(account), C = HaedoLife.Core, W = HaedoLife.Workbench;
    await S.open(); globalThis.S = S; globalThis.events = [];
    globalThis.binding = id => ({ ...account, remoteId: id });
    globalThis.edit = async (id, note) => {
      const state = await S.readWorkbench(id); state.reflection.note = note;
      return S.saveWorkbench(id, state, state.revision);
    };
    globalThis.sourceReady = async id => {
      await S.bindSync(id, binding(id)); const box = await S.prepareSyncUpload(id, binding(id));
      if (box) await S.ackSync(id, binding(id), box.operationId, box.expectedRevision + 1);
    };
    globalThis.fixture = async (connected = true) => {
      const empty = await S.createWorkspace('기기 사이에 이어 보는 독서 기록');
      const prepared = await C.prepareImport({ origin: 'apple_notes', title: '낯선 식물을 관찰한 토요일',
        text: '잎맥을 관찰하고 작은 변화를 기록했다.\n한글 원문과 🌱 발췌 위치를 보존한다.', coverage: 'full_text' }, empty);
      const saved = await S.commitLocal({ workspaceId: empty.workspaceId, baseRevision: 0, operationId: C.id(), changes: C.buildImportChanges(empty, prepared, []) });
      if (saved.status !== 'stored') throw new Error(saved.error?.message || 'Fixture import failed');
      const bundle = await S.read(empty.workspaceId), version = bundle.sourceVersions[0].id;
      const state = W.empty(bundle.workspaceId);
      state.page.title = '산책하며 다시 읽은 것'; state.page.intro = '서두르지 않고 연결한 생각';
      state.groups = [{ id: C.id(), title: '식물과 산책', versionIds: [version] }];
      state.page.entries = [{ id: C.id(), title: '작은 변화', parts: [{ versionId: version, enabled: true }],
        note: '내 생각은 원문과 구분한다.', pinned: true, enabled: true, showBody: true, showNote: true }];
      state.reflection = { versionIds: [version], note: '기준 메모' };
      await S.saveWorkbench(bundle.workspaceId, state, 0);
      if (connected) await sourceReady(bundle.workspaceId);
      S.subscribe(bundle.workspaceId, event => events.push(event));
      return { id: bundle.workspaceId, bundle, state: await S.readWorkbench(bundle.workspaceId) };
    };
    globalThis.compositionReady = async id => {
      await S.bindCompositionSync(id, binding(id)); const box = await S.prepareCompositionUpload(id, binding(id));
      await S.ackCompositionSync(id, binding(id), box.operationId, box.expectedRevision + 1);
      return { workspace_id: id, revision: box.expectedRevision + 1, source_revision: box.sourceRevision, data: box.data, updated_at: '2026-01-01T00:00:00Z' };
    };
    globalThis.code = async action => { try { await action(); return 'unexpected_success'; } catch (error) { return error.code; } };
  }, account);
}
async function main() {
  const output = path.resolve('.local/composition-sync/storage-report.json'); await fs.mkdir(path.dirname(output), { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ serviceWorkers: 'block' }), pages = [];
  const report = { browser: browser.version(), capturedAt: new Date().toISOString(), environment: 'Linux Chromium real IndexedDB and BroadcastChannel; anonymous explicit storage account scope, no real Auth/HTTP or Apple device verification', checks: [], consoleErrors: [], pageErrors: [], unexpectedRequests: [], remoteWrites: 0 };
  async function open(account = owner) {
    const page = await context.newPage(); pages.push(page);
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push(event.text()); });
    await page.goto(base + harnessPath); await installHelpers(page, account); return page;
  }
  async function check(name, run) {
    try { const evidence = await run(); report.checks.push({ name, pass: true, evidence }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
  }
  try {
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) { report.unexpectedRequests.push(url.origin); return route.abort('blockedbyclient'); }
      if (url.pathname === harnessPath) return route.fulfill({ contentType: 'text/html', body: harness });
      return route.continue();
    });
    const first = await open(), second = await open();
    await check('composition opt-in requires explicitly connected, current material; no implicit binding or upload', async () => {
      const result = await first.evaluate(async () => {
        const f = await fixture(false), b = binding(f.id);
        const unbound = await code(() => S.bindCompositionSync(f.id, b));
        const untouched = [await S.getSyncState(f.id), await S.getCompositionState(f.id)];
        await sourceReady(f.id); await S.bindCompositionSync(f.id, b); await S.pauseSync(f.id, b);
        const paused = await code(() => S.prepareCompositionUpload(f.id, b));
        const pausedComposition = await S.pauseCompositionSync(f.id, b);
        return { unbound, untouched, paused, disabled: !pausedComposition.enabled };
      });
      assert.deepEqual(result, { unbound: 'composition_source_pending', untouched: [null, null], paused: 'composition_source_pending', disabled: true }); return result;
    });
    await check('pending upload is immutable after local edits and reload; exact receipt advances only its captured revision', async () => {
      const initial = await first.evaluate(async () => {
        const f = await fixture(); await S.bindCompositionSync(f.id, binding(f.id));
        const box = await S.prepareCompositionUpload(f.id, binding(f.id)); await edit(f.id, '전송 뒤에도 적은 새 메모');
        const retry = await S.prepareCompositionUpload(f.id, binding(f.id));
        return { id: f.id, box, retry, latest: await S.readWorkbench(f.id) };
      });
      assert.deepEqual(initial.box, initial.retry);
      await first.reload(); await installHelpers(first);
      const result = await first.evaluate(async ({ id, box }) => {
        const retry = await S.prepareCompositionUpload(id, binding(id));
        const wrong = await code(() => S.ackCompositionSync(id, binding(id), box.operationId, 2));
        const acknowledged = await S.ackCompositionSync(id, binding(id), box.operationId, 1);
        const duplicate = await code(() => S.ackCompositionSync(id, binding(id), box.operationId, 1));
        const next = await S.prepareCompositionUpload(id, binding(id));
        return { retry, wrong, acknowledged, duplicate, next };
      }, initial);
      assert.deepEqual(result.retry, initial.box); assert.equal(result.wrong, 'stale_sync_result'); assert.equal(result.duplicate, 'stale_sync_result');
      assert.equal(result.acknowledged.status, 'pending'); assert.equal(result.acknowledged.syncedLocalRevision, initial.box.localRevision);
      assert.equal(result.next.expectedRevision, 1); assert.equal(result.next.localRevision, initial.latest.revision); assert.notEqual(result.next.operationId, initial.box.operationId);
      return { retainedAcrossReload: true, capturedRevisionOnly: true, invalidReceiptsRejected: 2 };
    });
    await check('same remote revision validates its acknowledged head even after local edits and never overwrites them', async () => {
      const result = await first.evaluate(async () => {
        const f = await fixture(), row = await compositionReady(f.id); const local = await edit(f.id, '아직 전송하지 않은 메모');
        const equal = await S.applyCompositionRemote(f.id, binding(f.id), row);
        const altered = structuredClone(row); altered.data.page.intro = '같은 서버 버전의 다른 내용';
        const mismatch = await code(() => S.applyCompositionRemote(f.id, binding(f.id), altered));
        return { equal, mismatch, local, after: await S.readWorkbench(f.id), metadata: await S.getCompositionState(f.id) };
      });
      assert.equal(result.equal.status, 'stored'); assert.equal(result.mismatch, 'remote_revision_mismatch');
      assert.deepEqual(result.after, result.local); assert.equal(result.metadata.status, 'pending'); assert.equal(result.metadata.conflict, null);
      return { staleRemoteCannotReplaceLocal: true, changedAcknowledgedPayloadRejected: true };
    });
    await check('remote source revision cannot lead local material or regress an accepted dependency', async () => {
      const result = await first.evaluate(async () => {
        const f = await fixture(), initial = await compositionReady(f.id), next = structuredClone(initial);
        next.revision = 2; next.source_revision = 2; next.data.reflection.note = '서버 새 구성';
        const future = await code(() => S.applyCompositionRemote(f.id, binding(f.id), next));
        const material = await S.read(f.id), incoming = structuredClone(material); incoming.title = '원문 최신 제목';
        await S.applySyncRemote(f.id, binding(f.id), { id: f.id, revision: 2, data: incoming });
        const applied = await S.applyCompositionRemote(f.id, binding(f.id), next);
        const oldSource = structuredClone(next); oldSource.revision = 3; oldSource.source_revision = 1;
        return { future, applied, regress: await code(() => S.applyCompositionRemote(f.id, binding(f.id), oldSource)), metadata: await S.getCompositionState(f.id) };
      });
      assert.equal(result.future, 'composition_source_pending'); assert.equal(result.applied.status, 'stored');
      assert.equal(result.regress, 'stale_sync_result'); assert.equal(result.metadata.sourceRevision, 2);
      return { futureSourceRejected: true, acceptedSourceFloor: 2, regressedSourceRejected: true };
    });
    const raced = await first.evaluate(async () => {
      const f = await fixture(), row = await compositionReady(f.id); return { ...f, row };
    });
    await second.evaluate(id => S.subscribe(id, event => events.push(event)), raced.id);
    await check('two tabs serialize competing remote applies and reject same revision with different payloads', async () => {
      const rows = ['첫 기기', '둘째 기기'].map(note => { const row = structuredClone(raced.row); row.revision = 2; row.data.reflection.note = note; return row; });
      const startAt = Date.now() + 100;
      const results = await Promise.all([first, second].map((page, index) => page.evaluate(async ({ id, row, startAt }) => {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, startAt - Date.now())));
        try { return await S.applyCompositionRemote(id, binding(id), row); } catch (error) { return { code: error.code }; }
      }, { id: raced.id, row: rows[index], startAt })));
      assert.equal(results.filter(result => result.status === 'stored').length, 1);
      assert.equal(results.filter(result => result.code === 'remote_revision_mismatch').length, 1);
      await second.waitForFunction(id => events.some(event => event.type === 'composition_sync_changed' && event.workspaceId === id), raced.id);
      const snapshots = await Promise.all([first, second].map(page => page.evaluate(id => S.readWorkbench(id), raced.id)));
      assert.deepEqual(snapshots[0], snapshots[1]); assert.equal(snapshots[0].revision, raced.state.revision + 1);
      return { committedRemoteApplies: 1, rejectedSameRevisionChanges: 1, separateTabNotification: true };
    });
    await check('racing local edits become a conflict; stale resolution cannot discard newly saved text', async () => {
      const result = await first.evaluate(async () => {
        const f = await fixture(), row = await compositionReady(f.id); row.revision = 2; row.data.reflection.note = '다른 기기의 메모';
        const local = await edit(f.id, '이 기기의 메모'); const applied = await S.applyCompositionRemote(f.id, binding(f.id), row);
        const newer = await edit(f.id, '비교 화면 뒤에 적은 문장');
        const stale = await code(() => S.resolveCompositionSync(f.id, binding(f.id), { choice: 'remote', expectedLocalRevision: local.revision, remoteRow: row }));
        return { applied, stale, newer, current: await S.readWorkbench(f.id), recoveries: await S.listCompositionRecoveries(f.id) };
      });
      assert.equal(result.applied.status, 'conflict'); assert.equal(result.stale, 'composition_conflict_changed');
      assert.deepEqual(result.current, result.newer); assert.deepEqual(result.recoveries, []);
      return { dirtyRemoteAdvanceBecomesConflict: true, newerDraftPreserved: true, staleResolutionWrites: 0 };
    });
    let recoveryFixture;
    await check('choosing remote atomically preserves unselected composition and exact material as a restorable backup', async () => {
      recoveryFixture = await first.evaluate(async () => {
        const f = await fixture(), row = await compositionReady(f.id); row.revision = 2; row.data.reflection.note = '선택한 다른 기기 메모';
        const discarded = await edit(f.id, '복구 사본에 남겨야 할 이 기기 메모'); await S.applyCompositionRemote(f.id, binding(f.id), row);
        const activeBefore = await S.getActive();
        const resolved = await S.resolveCompositionSync(f.id, binding(f.id), { choice: 'remote', expectedLocalRevision: discarded.revision, remoteRow: row });
        const recovery = await S.readCompositionRecovery(f.id, resolved.recoveryId), listed = await S.listCompositionRecoveries(f.id);
        const backup = HaedoLife.Workbench.makeBackup(recovery.bundle, recovery.workbench), restored = await HaedoLife.Workbench.restoreBackup(backup);
        return { id: f.id, resolved, recovery, discarded, material: f.bundle, listed, restored, activeBefore, activeAfter: await S.getActive() };
      });
      const r = recoveryFixture;
      assert.deepEqual(r.recovery.workbench, r.discarded); assert.deepEqual(r.recovery.bundle, r.material);
      assert.equal(r.resolved.workbench.reflection.note, '선택한 다른 기기 메모'); assert.equal(r.resolved.metadata.status, 'synced');
      assert.equal(r.resolved.workbench.revision, r.discarded.revision + 1); assert.equal(r.activeBefore, r.activeAfter);
      assert.equal(r.listed.length, 1); assert.deepEqual(Object.keys(r.listed[0]).sort(), ['createdAt', 'id', 'title']);
      assert.notEqual(r.restored.bundle.workspaceId, r.id); assert.equal(r.restored.workbench.reflection.note, r.discarded.reflection.note);
      assert.equal(r.restored.workbench.page.entries[0].parts[0].versionId, r.restored.bundle.sourceVersions[0].id);
      assert.notEqual(r.restored.bundle.sourceVersions[0].id, r.material.sourceVersions[0].id);
      return { exactUnselectedNotesPreserved: true, originalVersionReferencesPreserved: true, integratedRestoreRemapsIds: true, activeWorkspaceUnchanged: true };
    });
    await check('choosing local preserves the remote composition and prepares a fresh CAS operation', async () => {
      const result = await first.evaluate(async () => {
        const f = await fixture(), row = await compositionReady(f.id); row.revision = 2; row.data.page.entries[0].note = '복구할 원격 코멘트';
        const local = await edit(f.id, '내 변경 선택'); await S.applyCompositionRemote(f.id, binding(f.id), row);
        const resolved = await S.resolveCompositionSync(f.id, binding(f.id), { choice: 'local', expectedLocalRevision: local.revision, remoteRow: row });
        return { resolved, local, row, recovery: await S.readCompositionRecovery(f.id, resolved.recoveryId), box: await S.prepareCompositionUpload(f.id, binding(f.id)) };
      });
      assert.deepEqual(result.resolved.workbench, result.local); assert.deepEqual(result.recovery.workbench, result.row.data);
      assert.equal(result.resolved.metadata.syncedLocalRevision, -1); assert.equal(result.box.expectedRevision, 2); assert.deepEqual(result.box.data, result.local);
      return { remoteCommentPreserved: true, chosenLocalRevisionUnchanged: true, nextExpectedRemoteRevision: 2 };
    });
    await check('aborted final metadata write rolls back composition, head, and recovery together', async () => {
      const result = await first.evaluate(async () => {
        const f = await fixture(), row = await compositionReady(f.id); row.revision = 2; row.data.page.intro = '받을 원격 소개';
        await edit(f.id, '충돌한 로컬 메모'); await S.applyCompositionRemote(f.id, binding(f.id), row);
        const before = { state: await S.readWorkbench(f.id), metadata: await S.getCompositionState(f.id) };
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, ...args) {
          if (this.name === 'meta' && value?.key === `compositionSync:${f.id}`) { this.transaction.abort(); throw new DOMException('Synthetic abort', 'AbortError'); }
          return original.call(this, value, ...args);
        };
        let rejected;
        try { rejected = await code(() => S.resolveCompositionSync(f.id, binding(f.id), { choice: 'remote', expectedLocalRevision: before.state.revision, remoteRow: row })); }
        finally { IDBObjectStore.prototype.put = original; }
        return { before, rejected, after: { state: await S.readWorkbench(f.id), metadata: await S.getCompositionState(f.id) }, recoveries: await S.listCompositionRecoveries(f.id) };
      });
      assert.equal(result.rejected, 'storage_aborted'); assert.deepEqual(result.after, result.before); assert.deepEqual(result.recoveries, []);
      return { abortedWriteRolledBackAllRecords: true, phantomRecoveryCount: 0 };
    });
    await check('pausing composition rejects late acknowledgement and apply while preserving its outbox', async () => {
      const result = await first.evaluate(async () => {
        const f = await fixture(); await S.bindCompositionSync(f.id, binding(f.id)); const box = await S.prepareCompositionUpload(f.id, binding(f.id));
        await S.pauseCompositionSync(f.id, binding(f.id));
        const row = { workspace_id: f.id, revision: 1, source_revision: 1, data: box.data };
        return { box, ack: await code(() => S.ackCompositionSync(f.id, binding(f.id), box.operationId, 1)),
          apply: await code(() => S.applyCompositionRemote(f.id, binding(f.id), row)), metadata: await S.getCompositionState(f.id) };
      });
      assert.equal(result.ack, 'composition_paused'); assert.equal(result.apply, 'composition_paused'); assert.deepEqual(result.metadata.outbox, result.box);
      return { lateWritesRejected: 2, retryPayloadRetained: true };
    });
    await check('foreign account cannot inspect composition state or recovery snapshots from the same database', async () => {
      const foreign = await open({ ...owner, userId: '22222222-2222-4222-8222-222222222222' });
      const result = await foreign.evaluate(async ({ id, recoveryId }) => {
        const actions = [() => S.getCompositionState(id), () => S.listCompositionRecoveries(id), () => S.readCompositionRecovery(id, recoveryId),
          () => S.bindCompositionSync(id, binding(id)), () => S.pauseCompositionSync(id, binding(id)), () => S.prepareCompositionUpload(id, binding(id))];
        return Promise.all(actions.map(action => code(action)));
      }, { id: recoveryFixture.id, recoveryId: recoveryFixture.resolved.recoveryId });
      assert.deepEqual(result, Array(6).fill('workspace_access_denied')); return { rejectedCrossAccountOperations: result.length };
    });
    await check('corrupted revision metadata fails closed without replacing local composition', async () => {
      const result = await first.evaluate(async () => {
        const f = await fixture(); await compositionReady(f.id); const before = await S.readWorkbench(f.id);
        const db = await idb.openDB('life-tools-v1', 1), metadata = await db.get('meta', `compositionSync:${f.id}`);
        metadata.value.syncedLocalRevision = before.revision + 20; await db.put('meta', metadata); db.close();
        return { rejected: await code(() => S.getCompositionState(f.id)), before, after: await S.readWorkbench(f.id), save: await code(() => edit(f.id, '실패해야 하는 쓰기')) };
      });
      assert.equal(result.rejected, 'invalid_composition_metadata'); assert.equal(result.save, 'invalid_composition_metadata'); assert.deepEqual(result.after, result.before);
      return { inconsistentMetadataRejected: true, localContentPreserved: true };
    });
    await check('browser reports no unexpected errors or external requests', async () => {
      assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.unexpectedRequests, []);
      return { consoleErrors: 0, pageErrors: 0, externalRequests: 0, remoteWrites: 0 };
    });
  } catch (error) { report.setupError = error.stack; console.error(error.stack); }
  finally {
    for (const page of pages) { try { await page.evaluate(() => globalThis.S?.dispose()); } catch (_) {} }
    await context.close(); await browser.close(); await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ passed: report.checks.filter(check => check.pass).length, failed: report.checks.filter(check => !check.pass).length, setupError: !!report.setupError, report: path.relative(process.cwd(), output) }));
  if (report.setupError || report.checks.some(check => !check.pass) || report.consoleErrors.length || report.pageErrors.length || report.unexpectedRequests.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

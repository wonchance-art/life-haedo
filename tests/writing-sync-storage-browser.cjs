/* Real IndexedDB + BroadcastChannel with anonymous samples; no production connection. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright } = require('./unified-home-browser.cjs');
const base = (process.env.BASE_URL || 'http://127.0.0.1:4184').replace(/\/$/, '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) throw new Error('Local anonymous server required');
const harnessPath = '/__writing_storage_harness__.html';
const harness = '<!doctype html><html lang="ko"><meta charset="utf-8"><title>초안 저장 검사</title><link rel="icon" href="data:,"><main>익명 초안 저장 검사</main>' +
  ['vendor/idb/idb.js', 'assets/life/core.js', 'assets/life/workbench.js', 'assets/life/writing.js', 'assets/life/storage.js'].map(file => `<script src="/${file}"></script>`).join('') + '</html>';
const owner = { projectUrl: 'https://writing-storage-test.supabase.co', userId: '11111111-1111-4111-8111-111111111111' };
async function installHelpers(page, account = owner) {
  await page.evaluate(async account => {
    globalThis.S = HaedoLife.Storage.forAccount(account); globalThis.C = HaedoLife.Core; globalThis.W = HaedoLife.Writing; globalThis.events = [];
    await S.open(); globalThis.binding = id => ({ ...account, remoteId: id });
    globalThis.code = async action => { try { await action(); return 'unexpected_success'; } catch (error) { return error.code; } };
    globalThis.sourceReady = async id => {
      await S.bindSync(id, binding(id)); const box = await S.prepareSyncUpload(id, binding(id));
      if (box) await S.ackSync(id, binding(id), box.operationId, box.expectedRevision + 1);
    };
    globalThis.fixture = async (ready = true) => {
      const bundle = await S.createWorkspace('산책하며 적은 생각');
      const stage = W.createDraft(bundle); stage.title = '도시의 나무를 보는 방식'; stage.text = '오늘 걷던 길에서 작은 나무를 발견했다. 🌳\n한글 원문은 그대로 남긴다.';
      const saved = await S.saveStage(stage); if (ready) await sourceReady(bundle.workspaceId);
      S.subscribe(bundle.workspaceId, event => events.push(event)); return { id: bundle.workspaceId, stage: saved };
    };
    globalThis.edit = async (stageId, text) => { const stage = await S.getStage(stageId); stage.text = text; return S.saveStage(stage); };
    globalThis.readyWriting = async f => {
      await S.bindWritingSync(f.id, f.stage.stageId, binding(f.id)); const box = await S.prepareWritingUpload(f.id, f.stage.stageId, binding(f.id));
      await S.ackWritingSync(f.id, f.stage.stageId, binding(f.id), box.operationId, box.expectedRevision + 1);
      return { workspace_id: f.id, draft_id: f.stage.stageId, revision: box.expectedRevision + 1, source_revision: box.sourceRevision, data: box.data };
    };
    globalThis.applyLocal = async f => {
      const { bundle, stage } = await S.readWritingSnapshot(f.id, f.stage.stageId), prepared = await W.prepareSave(bundle, stage);
      const result = await S.commitLocal({ workspaceId: f.id, baseRevision: bundle.revision, operationId: C.id(), stageId: stage.stageId,
        stageRevision: stage.revision, stageResult: prepared.stageResult, changes: prepared.changes });
      if (result.status !== 'stored') throw Error('Fixture writing commit failed: ' + result.error?.code);
      return S.getStage(stage.stageId);
    };
  }, account);
}
async function main() {
  const output = path.resolve('.local/writing-sync/storage-report.json'); await fs.mkdir(path.dirname(output), { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ serviceWorkers: 'block' }), pages = [];
  const report = { browser: browser.version(), capturedAt: new Date().toISOString(), environment: 'Linux Chromium, real IndexedDB and BroadcastChannel; mock account, no real Auth/HTTP or Apple verification', checks: [], consoleErrors: [], pageErrors: [], unexpectedRequests: [] };
  async function open(account = owner) {
    const page = await context.newPage(); pages.push(page);
    page.on('pageerror', e => report.pageErrors.push(e.message)); page.on('console', e => { if (e.type() === 'error') report.consoleErrors.push(e.text()); });
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
      if (url.pathname === harnessPath) return route.fulfill({ contentType: 'text/html', body: harness }); return route.continue();
    });
    const first = await open(), second = await open();
    await check('selection requires synced originals and applies only to writing, not import drafts', async () => {
      const r = await first.evaluate(async () => {
        const f = await fixture(false), b = binding(f.id), id = f.stage.stageId;
        const blocked = await code(() => S.bindWritingSync(f.id, id, b)); const untouched = await S.getWritingSyncState(f.id, id);
        const pause = await S.pauseWritingSync(f.id, id, b); await sourceReady(f.id);
        const imported = await S.saveStage({ stageId: C.id(), workspaceId: f.id, revision: 0, state: 'draft', input: { text: '가져오기 전용' }, excerpts: [] });
        const rejectedImport = await code(() => S.bindWritingSync(f.id, imported.stageId, b)); await S.deleteStage(imported.stageId);
        await S.bindWritingSync(f.id, id, b); const list = await S.listWritingSyncStates(f.id);
        return { blocked, untouched, pause, rejectedImport, selected: list.length, deletedImport: await S.getStage(imported.stageId) };
      });
      assert.deepEqual(r, { blocked: 'writing_source_pending', untouched: null, pause: null, rejectedImport: 'writing_draft_not_found', selected: 1, deletedImport: null }); return r;
    });
    await check('outbox survives later edits and reload; ack advances only captured revision', async () => {
      const initial = await first.evaluate(async () => {
        const f = await fixture(); await S.bindWritingSync(f.id, f.stage.stageId, binding(f.id));
        const box = await S.prepareWritingUpload(f.id, f.stage.stageId, binding(f.id)); await edit(f.stage.stageId, '전송 후에도 새로 적은 한글');
        return { ...f, box, retry: await S.prepareWritingUpload(f.id, f.stage.stageId, binding(f.id)) };
      }); assert.deepEqual(initial.box, initial.retry);
      await first.reload(); await installHelpers(first);
      const r = await first.evaluate(async f => {
        const id = f.stage.stageId, b = binding(f.id), retry = await S.prepareWritingUpload(f.id, id, b);
        const wrong = await code(() => S.ackWritingSync(f.id, id, b, f.box.operationId, 3));
        const ack = await S.ackWritingSync(f.id, id, b, f.box.operationId, 1); const next = await S.prepareWritingUpload(f.id, id, b);
        const applied = await S.applyWritingRemote(f.id, id, b, { workspace_id: f.id, draft_id: id, revision: 1, source_revision: 1, data: f.box.data });
        return { retry, wrong, ack, next, applied, stage: await S.getStage(id) };
      }, initial);
      assert.deepEqual(r.retry, initial.box); assert.equal(r.wrong, 'stale_sync_result'); assert.equal(r.ack.status, 'pending'); assert.equal(r.ack.syncedLocalRevision, 1);
      assert.equal(r.next.expectedRevision, 1); assert.equal(r.next.localRevision, 2); assert.equal(r.stage.text, '전송 후에도 새로 적은 한글'); assert.equal(r.applied.status, 'stored'); return { persistedImmutableReceipt: true, latestDraftKept: true };
    });
    await check('draft edits and pending metadata commit atomically; quota rollback preserves old text', async () => {
      const r = await first.evaluate(async () => {
        const f = await fixture(); await readyWriting(f); const before = await S.readWritingSnapshot(f.id, f.stage.stageId), metadata = await S.getWritingSyncState(f.id, f.stage.stageId);
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, ...args) {
          if (this.name === 'meta' && value?.key === `writingSync:${f.id}:${f.stage.stageId}`) { this.transaction.abort(); throw new DOMException('Synthetic quota', 'QuotaExceededError'); }
          return original.call(this, value, ...args);
        };
        let rejected; try { rejected = await code(() => edit(f.stage.stageId, '저장 실패한 입력')); } finally { IDBObjectStore.prototype.put = original; }
        return { before, metadata, rejected, after: await S.readWritingSnapshot(f.id, f.stage.stageId), afterMetadata: await S.getWritingSyncState(f.id, f.stage.stageId) };
      }); assert.equal(r.rejected, 'storage_quota'); assert.deepEqual(r.after, r.before); assert.deepEqual(r.afterMetadata, r.metadata); return { atomicQuotaRollback: true };
    });
    await check('explicit remote install never overwrites existing draft and requires source floor', async () => {
      const r = await first.evaluate(async () => {
        const f = await fixture(), data = W.recoverDraft(f.stage); data.revision = 9; data.text = '서버에서 선택하여 받은 초안';
        const row = { workspace_id: f.id, draft_id: data.stageId, revision: 4, source_revision: 2, data };
        const future = await code(() => S.installWritingRemote(f.id, binding(f.id), row)); row.source_revision = 1;
        const installed = await S.installWritingRemote(f.id, binding(f.id), row);
        const repeated = await code(() => S.installWritingRemote(f.id, binding(f.id), row));
        const changed = structuredClone(row); changed.data.text = '동일 버전 변조';
        const mismatch = await code(() => S.applyWritingRemote(f.id, data.stageId, binding(f.id), changed));
        return { future, installed, repeated, mismatch, initial: await S.getStage(f.stage.stageId) };
      }); assert.equal(r.future, 'writing_source_pending'); assert.equal(r.installed.stage.revision, 1); assert.equal(r.installed.metadata.remoteRevision, 4);
      assert.equal(r.repeated, 'writing_draft_exists'); assert.equal(r.mismatch, 'remote_revision_mismatch'); assert.notEqual(r.initial.stageId, r.installed.stage.stageId); return { explicitSeparateInstall: true, versionChecks: true };
    });
    await check('normal conflict preserves loser as unlinked ordinary draft with exact base references', async () => {
      const r = await first.evaluate(async () => {
        const original = await fixture(); await applyLocal(original); const bundle = await S.read(original.id), draft = W.createDraft(bundle, { sourceId: bundle.sources[0].id });
        const saved = await S.saveStage(draft), f = { id: original.id, stage: saved }; await sourceReady(f.id); const row = await readyWriting(f);
        row.revision++; row.data.text = '다른 기기의 이어쓴 문장'; const local = await edit(saved.stageId, '이 기기에서 남긴 문장');
        await S.applyWritingRemote(f.id, saved.stageId, binding(f.id), row);
        const resolved = await S.resolveWritingSync(f.id, saved.stageId, binding(f.id), { choice: 'remote', expectedLocalRevision: local.revision, remoteRow: row });
        const recovery = await S.getStage(resolved.recoveryStageId);
        return { local, resolved, recovery, recoveryMetadata: await S.getWritingSyncState(f.id, recovery.stageId), exported: W.toText(recovery), originals: (await S.read(f.id)).sourceVersions.length };
      }); assert.equal(r.resolved.metadata.status, 'synced'); assert.equal(r.resolved.stage.text, '다른 기기의 이어쓴 문장'); assert.equal(r.recovery.text, r.local.text);
      assert.equal(r.recovery.revision, 1); assert.equal(r.recovery.sourceId, r.local.sourceId); assert.equal(r.recovery.baseSourceVersionId, r.local.baseSourceVersionId);
      assert.equal(r.recovery.baseSourceRevision, r.local.baseSourceRevision); assert.equal(r.recoveryMetadata, null); assert.ok(r.exported.includes(r.local.text)); assert.equal(r.originals, 1); return { losingInputAndBasePreserved: true, sourceWrites: 0 };
    });
    await check('multi-tab local edit invalidates stale resolution; valid local choice keeps remote text as new draft', async () => {
      const f = await first.evaluate(async () => { const f = await fixture(); f.row = await readyWriting(f); f.row.revision++; f.row.data.text = '원격 보존 대상'; await edit(f.stage.stageId, '로컬 선택 대상'); await S.applyWritingRemote(f.id, f.stage.stageId, binding(f.id), f.row); f.local = await S.getStage(f.stage.stageId); return f; });
      await second.evaluate(async f => { S.subscribe(f.id, e => events.push(e)); await edit(f.stage.stageId, '비교 뒤 다른 탭 입력'); }, f);
      const r = await first.evaluate(async f => {
        const id = f.stage.stageId, b = binding(f.id), stale = await code(() => S.resolveWritingSync(f.id, id, b, { choice: 'local', expectedLocalRevision: f.local.revision, remoteRow: f.row }));
        await S.setWritingConflict(f.id, id, b, f.row); const latest = await S.getStage(id);
        const resolved = await S.resolveWritingSync(f.id, id, b, { choice: 'local', expectedLocalRevision: latest.revision, remoteRow: f.row });
        return { stale, latest, resolved, recovery: await S.getStage(resolved.recoveryStageId), box: await S.prepareWritingUpload(f.id, id, b) };
      }, f); assert.equal(r.stale, 'writing_conflict_changed'); assert.deepEqual(r.resolved.stage, r.latest); assert.equal(r.recovery.text, '원격 보존 대상'); assert.equal(r.box.expectedRevision, 2);
      await second.waitForFunction(id => events.some(e => e.type === 'writing_draft_changed' && e.workspaceId === id), f.id); return { staleChoiceRejected: true, broadcastReceived: true, localWinnerPreservesRemote: true };
    });
    await check('applied marker is atomic with saved originals and waits for their sync', async () => {
      const r = await first.evaluate(async () => {
        const f = await fixture(); await readyWriting(f); events.length = 0; const applied = await applyLocal(f), metadata = await S.getWritingSyncState(f.id, f.stage.stageId);
        const blocked = await code(() => S.prepareWritingUpload(f.id, f.stage.stageId, binding(f.id)));
        await sourceReady(f.id); const box = await S.prepareWritingUpload(f.id, f.stage.stageId, binding(f.id));
        const edited = { ...applied, state: 'draft' }; delete edited.appliedResult;
        return { applied, metadata, blocked, box, resurrection: await code(() => S.saveStage(edited)), notified: events.some(e => e.type === 'writing_draft_changed' && e.stageId === f.stage.stageId) };
      }); assert.equal(r.applied.state, 'applied'); assert.equal(r.metadata.status, 'pending'); assert.equal(r.blocked, 'writing_source_pending'); assert.equal(r.box.data.state, 'applied'); assert.equal(r.box.sourceRevision, 2);
      assert.equal(r.resurrection, 'stage_conflict'); assert.equal(r.notified, true); return { originalAndTerminalAtomic: true, noDraftResurrection: true };
    });
    await check('remote applied conflict forks text without reviving same ID or modifying originals', async () => {
      const r = await first.evaluate(async () => {
        const f = await fixture(), row = await readyWriting(f); const applied = await applyLocal(f); await sourceReady(f.id);
        // Simulate the other device's applied response while this device still has its dirty draft.
        const db = await idb.openDB('life-tools-v1', 1), local = { ...f.stage, revision: applied.revision, text: '보관 이후에도 남긴 새 생각' };
        await db.put('staging', local); db.close();
        row.revision++; row.source_revision = 2; row.data = applied; await S.setWritingConflict(f.id, f.stage.stageId, binding(f.id), row);
        const before = await S.read(f.id), wrong = await code(() => S.resolveWritingSync(f.id, f.stage.stageId, binding(f.id), { choice: 'local', expectedLocalRevision: local.revision, remoteRow: row }));
        const resolved = await S.resolveWritingSync(f.id, f.stage.stageId, binding(f.id), { choice: 'fork', expectedLocalRevision: local.revision, remoteRow: row });
        return { before, after: await S.read(f.id), wrong, resolved, recovery: await S.getStage(resolved.recoveryStageId) };
      }); assert.equal(r.wrong, 'writing_conflict'); assert.equal(r.resolved.stage.state, 'applied'); assert.equal(r.resolved.metadata.status, 'synced');
      assert.equal(r.recovery.state, 'draft'); assert.equal(r.recovery.sourceId, null); assert.equal(r.recovery.appliedResult, undefined); assert.equal(r.recovery.text, '보관 이후에도 남긴 새 생각'); assert.deepEqual(r.before, r.after); return { canonicalAppliedPreserved: true, detachedRecovery: true, originalsUnchanged: true };
    });
    await check('local applied conflict keeps terminal marker and forks remote text for later deliberate save', async () => {
      const r = await first.evaluate(async () => {
        const f = await fixture(), row = await readyWriting(f); const applied = await applyLocal(f); await sourceReady(f.id);
        row.revision++; row.data.text = '다른 기기의 미보관 문장'; await S.setWritingConflict(f.id, f.stage.stageId, binding(f.id), row);
        const resolved = await S.resolveWritingSync(f.id, f.stage.stageId, binding(f.id), { choice: 'fork', expectedLocalRevision: applied.revision, remoteRow: row });
        return { applied, resolved, recovery: await S.getStage(resolved.recoveryStageId), box: await S.prepareWritingUpload(f.id, f.stage.stageId, binding(f.id)) };
      }); assert.deepEqual(r.resolved.stage, r.applied); assert.equal(r.resolved.metadata.status, 'pending'); assert.equal(r.box.expectedRevision, 2); assert.equal(r.box.data.state, 'applied');
      assert.equal(r.recovery.text, '다른 기기의 미보관 문장'); assert.equal(r.recovery.sourceId, null); return { pendingClosingMarker: true, otherTextDetached: true };
    });
    await check('applied source requires exact version pair and matching text, even at satisfied floor', async () => {
      const r = await first.evaluate(async () => {
        const f = await fixture(), applied = await applyLocal(f); await sourceReady(f.id);
        const other = W.recoverDraft({ ...f.stage, text: applied.text }); other.revision = 1; other.state = 'applied'; other.appliedResult = { ...applied.appliedResult };
        const row = { workspace_id: f.id, draft_id: other.stageId, revision: 1, source_revision: 2, data: other };
        const wrongVersion = structuredClone(row); wrongVersion.data.appliedResult.sourceVersionId = C.id();
        const wrongText = structuredClone(row); wrongText.data.text = '연결된 버전과 다른 본문';
        const missing = await code(() => S.installWritingRemote(f.id, binding(f.id), wrongVersion));
        const mismatch = await code(() => S.installWritingRemote(f.id, binding(f.id), wrongText));
        const good = await S.installWritingRemote(f.id, binding(f.id), row); return { missing, mismatch, state: good.stage.state };
      }); assert.deepEqual(r, { missing: 'writing_source_pending', mismatch: 'writing_source_pending', state: 'applied' }); return r;
    });
    await check('failed recovery write rolls back chosen draft, head and metadata together', async () => {
      const r = await first.evaluate(async () => {
        const f = await fixture(), row = await readyWriting(f); row.revision++; row.data.text = '원격 선택 내용'; const local = await edit(f.stage.stageId, '로컬 보존 내용');
        await S.setWritingConflict(f.id, f.stage.stageId, binding(f.id), row);
        const before = { stages: await S.listStages(f.id), meta: await S.getWritingSyncState(f.id, f.stage.stageId) }, original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, ...args) {
          if (this.name === 'meta' && value?.key === `writingSync:${f.id}:${f.stage.stageId}`) { this.transaction.abort(); throw new DOMException('Synthetic abort', 'AbortError'); }
          return original.call(this, value, ...args);
        };
        let rejected; try { rejected = await code(() => S.resolveWritingSync(f.id, f.stage.stageId, binding(f.id), { choice: 'remote', expectedLocalRevision: local.revision, remoteRow: row })); } finally { IDBObjectStore.prototype.put = original; }
        return { before, rejected, after: { stages: await S.listStages(f.id), meta: await S.getWritingSyncState(f.id, f.stage.stageId) } };
      }); assert.equal(r.rejected, 'storage_aborted'); assert.deepEqual(r.before, r.after); return { recoveryAndWinnerAtomic: true };
    });
    let protectedDraft;
    await check('pause and missing head reject late writes; selected drafts cannot be silently deleted', async () => {
      protectedDraft = await first.evaluate(async () => {
        const f = await fixture(); await S.bindWritingSync(f.id, f.stage.stageId, binding(f.id)); const box = await S.prepareWritingUpload(f.id, f.stage.stageId, binding(f.id));
        await S.pauseWritingSync(f.id, f.stage.stageId, binding(f.id));
        const paused = await code(() => S.ackWritingSync(f.id, f.stage.stageId, binding(f.id), box.operationId, 1));
        const deleted = await code(() => S.deleteStage(f.stage.stageId)); await S.bindWritingSync(f.id, f.stage.stageId, binding(f.id));
        await S.setWritingConflict(f.id, f.stage.stageId, binding(f.id), null);
        const missing = await code(() => S.prepareWritingUpload(f.id, f.stage.stageId, binding(f.id)));
        return { ...f, paused, deleted, missing, metadata: await S.getWritingSyncState(f.id, f.stage.stageId), box };
      }); assert.equal(protectedDraft.paused, 'writing_paused'); assert.equal(protectedDraft.deleted, 'writing_selected'); assert.equal(protectedDraft.missing, 'writing_conflict');
      assert.deepEqual(protectedDraft.metadata.outbox, protectedDraft.box); return { lateWriteRejected: true, missingNotRecreated: true, selectedNotDeleted: true };
    });
    await check('fixed account prevents cross-account draft state, snapshots and list access', async () => {
      const foreign = await open({ ...owner, userId: '22222222-2222-4222-8222-222222222222' });
      const r = await foreign.evaluate(async f => Promise.all([
        () => S.getWritingSyncState(f.id, f.stage.stageId), () => S.listWritingSyncStates(f.id), () => S.readWritingSnapshot(f.id, f.stage.stageId),
        () => S.bindWritingSync(f.id, f.stage.stageId, binding(f.id)), () => S.prepareWritingUpload(f.id, f.stage.stageId, binding(f.id))
      ].map(action => code(action))), protectedDraft); assert.deepEqual(r, Array(5).fill('workspace_access_denied')); return { crossAccountOperationsRejected: 5 };
    });
    await check('two tabs serialize competing remote payloads at one server revision', async () => {
      const f = await first.evaluate(async () => { const f = await fixture(); f.row = await readyWriting(f); return f; });
      const rows = ['첫 서버 응답', '둘째 서버 응답'].map(text => { const row = structuredClone(f.row); row.revision++; row.data.text = text; return row; });
      const startAt = Date.now() + 100;
      const results = await Promise.all([first, second].map((page, index) => page.evaluate(async ({ f, row, startAt }) => {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, startAt - Date.now())));
        try { return await S.applyWritingRemote(f.id, f.stage.stageId, binding(f.id), row); } catch (error) { return { code: error.code }; }
      }, { f, row: rows[index], startAt })));
      assert.equal(results.filter(r => r.status === 'stored').length, 1); assert.equal(results.filter(r => r.code === 'remote_revision_mismatch').length, 1);
      const copies = await Promise.all([first, second].map(page => page.evaluate(id => S.getStage(id), f.stage.stageId)));
      assert.deepEqual(copies[0], copies[1]); assert.equal(copies[0].revision, 2); return { acceptedPayloads: 1, mismatchingPayloadsRejected: 1 };
    });
    await check('failed terminal metadata write rolls back original, stage and operation receipt', async () => {
      const r = await first.evaluate(async () => {
        const f = await fixture(); await readyWriting(f); const before = await S.readWritingSnapshot(f.id, f.stage.stageId), prepared = await W.prepareSave(before.bundle, before.stage);
        const request = { workspaceId: f.id, baseRevision: before.bundle.revision, operationId: C.id(), stageId: f.stage.stageId,
          stageRevision: before.stage.revision, changes: prepared.changes, stageResult: prepared.stageResult };
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, ...args) {
          if (this.name === 'meta' && value?.key === `writingSync:${f.id}:${f.stage.stageId}`) { this.transaction.abort(); throw new DOMException('Synthetic quota', 'QuotaExceededError'); }
          return original.call(this, value, ...args);
        };
        let rejected; try { rejected = await S.commitLocal(request); } finally { IDBObjectStore.prototype.put = original; }
        const after = await S.readWritingSnapshot(f.id, f.stage.stageId), retried = await S.commitLocal(request), duplicate = await S.commitLocal(request);
        return { before, after, rejected, retried, duplicate, sourceCount: (await S.read(f.id)).sources.length };
      }); assert.equal(r.rejected.status, 'rejected'); assert.equal(r.rejected.error.code, 'storage_quota'); assert.deepEqual(r.after, r.before);
      assert.equal(r.retried.status, 'stored'); assert.deepEqual(r.duplicate, r.retried); assert.equal(r.sourceCount, 1); return { originalStageReceiptAtomic: true, retryStoredOnce: true };
    });
    await check('malformed local metadata and draft kind replacement fail closed without text loss', async () => {
      const r = await first.evaluate(async () => {
        const f = await fixture(); await readyWriting(f);
        const replacement = { stageId: f.stage.stageId, workspaceId: f.id, revision: f.stage.revision, state: 'draft', input: { text: '가져오기 덮어쓰기' }, excerpts: [] };
        const wrongKind = await code(() => S.saveStage(replacement)), before = await S.getStage(f.stage.stageId), db = await idb.openDB('life-tools-v1', 1);
        const entry = await db.get('meta', `writingSync:${f.id}:${f.stage.stageId}`); entry.value.syncedLocalRevision = before.revision + 10; await db.put('meta', entry); db.close();
        const read = await code(() => S.getWritingSyncState(f.id, f.stage.stageId)), save = await code(() => edit(f.stage.stageId, '메타 오류 후 입력'));
        return { wrongKind, before, read, save, after: await S.getStage(f.stage.stageId) };
      }); assert.equal(r.wrongKind, 'stage_conflict'); assert.equal(r.read, 'invalid_writing_metadata'); assert.equal(r.save, 'invalid_writing_metadata'); assert.deepEqual(r.before, r.after); return { invalidMetadataPreservesText: true, kindCannotBypassSync: true };
    });
    await check('no console/page errors or external requests', async () => {
      assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.unexpectedRequests, []); return { console: 0, page: 0, external: 0 };
    });
  } catch (error) { report.setupError = error.stack; console.error(error.stack); }
  finally {
    for (const page of pages) { try { await page.evaluate(() => globalThis.S?.dispose()); } catch (_) {} }
    await context.close(); await browser.close(); await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ passed: report.checks.filter(c => c.pass).length, failed: report.checks.filter(c => !c.pass).length, setupError: !!report.setupError, report: path.relative(process.cwd(), output) }));
  if (report.setupError || report.checks.some(c => !c.pass) || report.consoleErrors.length || report.pageErrors.length || report.unexpectedRequests.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

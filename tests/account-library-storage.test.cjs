"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const Core = require("../assets/life/core.js"), Workbench = require("../assets/life/workbench.js");
const F = require("../assets/life/source-folders.js"), C = require("../assets/life/collection.js"), N = require("../assets/life/nine-board.js");
const R = require("../assets/life/source-reference.js"), M = require("../assets/life/library-meta.js");
const { createStorage } = require("../assets/life/storage.js");
const copy = value => structuredClone(value), key = value => JSON.stringify(value);
const owner = { projectUrl: "https://library-unit.supabase.co", userId: "synthetic-owner" };
const foreign = { ...owner, userId: "synthetic-other" };
// Serialized decision and rollback fixture. Native IndexedDB and transport are
// independently exercised by the account-library browser journeys.
function adapter() {
  const rows = new Map(), paths = new Map(), control = { fail: null, failCompletion: false, afterWrite: null, transactions: [], writes: [] }; let tail = Promise.resolve();
  const idb = { async openDB(_name, _version, callbacks) {
    let closed = false;
    const db = {
      objectStoreNames: { contains: name => rows.has(name) },
      createObjectStore(name, options) { rows.set(name, new Map()); paths.set(name, options.keyPath); return { createIndex() {} }; },
      close() { closed = true; },
      transaction(names, mode) {
        if (closed) throw new DOMException('closed', 'InvalidStateError');
        control.transactions.push({ names: [...names], mode });
        let resolve, reject, ended = false, written = 0, working;
        const done = new Promise((yes, no) => { resolve = yes; reject = no; }), previous = tail;
        tail = done.catch(() => {});
        function abort(error = new DOMException('aborted', 'AbortError')) { if (!ended) { ended = true; reject(error); } }
        const ready = previous.then(() => {
          if (ended) return;
          working = new Map(names.map(name => [name, copy(rows.get(name))]));
          setImmediate(() => {
            if (ended) return;
            if (mode === 'readwrite' && written && control.failCompletion) { control.failCompletion = false; abort(); return; }
            ended = true; if (mode === 'readwrite') for (const [name, data] of working) rows.set(name, data); resolve();
          });
        });
        async function run(name, method, value) {
          await ready; if (ended) throw new DOMException('inactive', 'AbortError');
          const store = working.get(name);
          if (method === 'get') return copy(store.get(key(value)));
          if (method === 'getAll') return copy([...store.values()]);
          if (method === 'getAllKeys') return [...store.keys()].map(value => JSON.parse(value));
          assert.equal(mode, 'readwrite'); const path = paths.get(name), id = method === 'delete' ? value : Array.isArray(path) ? path.map(field => value[field]) : value[path];
          control.writes.push({ name, method, id }); written++;
          if (control.fail?.({ name, method, id, value })) { control.fail = null; const error = new DOMException('quota', 'QuotaExceededError'); abort(error); throw error; }
          if (method === 'delete') store.delete(key(id));
          else { if (method === 'add' && store.has(key(id))) throw new DOMException('duplicate', 'ConstraintError'); store.set(key(id), copy(value)); }
          control.afterWrite?.({ name, method, id, value }); return id;
        }
        return { done, abort, objectStore(name) { return { get: value => run(name, 'get', value), getAll: () => run(name, 'getAll'), getAllKeys: () => run(name, 'getAllKeys'),
          put: value => run(name, 'put', value), add: value => run(name, 'add', value), delete: value => run(name, 'delete', value),
          index(field) { return { async getAll(value) { return (await run(name, 'getAll')).filter(row => row[field] === value); } }; } }; } };
      }
    };
    if (!rows.size) callbacks.upgrade(db, 0, 1); return db;
  } };
  return { rows, control, idb };
}

async function fixture(t, channelFactory = null) {
  const f = adapter(), options = { idb: f.idb, core: Core, workbench: Workbench, sourceFolders: F, collection: C, libraryMeta: M, channelFactory, account: owner };
  const a = createStorage(options), b = createStorage(options), other = createStorage({ ...options, account: foreign });
  t.after(() => { a.dispose(); b.dispose(); other.dispose(); });
  let bundle = await a.createWorkspace("합성 계정 자료");
  const prepared = await Core.prepareImport({ origin: "obsidian", title: "불변 원문", text: "\uFEFF# 원문\r\n정확한 😀 구절\r\n", authorRelation: "other", coverage: "full_text" }, bundle);
  const saved = await a.commitLocal({ workspaceId: bundle.workspaceId, operationId: Core.id(), baseRevision: 0, changes: Core.buildImportChanges(bundle, prepared) });
  assert.equal(saved.status, "stored"); bundle = await a.read(bundle.workspaceId);
  const w = bundle.workspaceId, binding = { ...owner, remoteId: w };
  return { ...f, a, b, other, options, bundle, w, binding, prepared };
}
async function sourceReady(f) {
  await f.a.bindSync(f.w, f.binding); const outbox = await f.a.prepareSyncUpload(f.w, f.binding);
  await f.a.ackSync(f.w, f.binding, outbox.operationId, outbox.expectedRevision + 1);
}
async function populated(f) {
  let folders = F.createFolder(await f.a.readSourceFolders(f.w), { name: "연구", parentId: null });
  folders = F.assignSources(folders, [f.prepared.source.id], folders.folders[0].id);
  await f.a.saveSourceFolders(f.w, folders, folders.revision);
  const collection = await f.a.readCollection(f.w), stamp = "2026-10-23T00:00:00.000Z";
  collection.items.push({ id: Core.id(), type: "book", title: "집중력", creator: "합성 저자", url: "https://example.invalid/book", note: "저장된 메모", tags: ["학습"], details: { year: "2026" }, archived: false, createdAt: stamp, updatedAt: stamp });
  await f.a.saveCollection(f.w, collection, collection.revision);
  const reference = await R.build({ bundle: f.bundle, sourceId: f.prepared.source.id, versionId: f.prepared.version.id, locator: { start: 3, end: 5 } });
  const nine = N.empty(f.w), board = N.create(Core.id); board.title = "정확한 근거"; board.areas[0].items.push(N.evidenceSnapshot({ kind: "source", value: reference }));
  nine.format = "life-nine-board-v2"; nine.boards.push(board); await f.a.saveNineBoard(f.w, nine, 0);
  return (await f.a.readLibraryMetaSnapshot(f.w)).metadata;
}
const row = (w, data, revision = 1, sourceRevision = 1) => ({ workspace_id: w, revision, source_revision: sourceRevision, data: copy(data) });
const content = state => ({ ...state, revision: 0, sourceFolders: { ...state.sourceFolders, revision: 0 }, collection: { ...state.collection, revision: 0 }, nineBoard: { ...state.nineBoard, revision: 0 } });

test("source adoption preserves local bytes and chooses exact acknowledgement, pristine CAS migration or conflict", async t => {
  for (const mode of ["exact", "pristine", "different"]) await t.test(mode, async t => {
    const f = await fixture(t), before = copy(f.rows.get("bundles"));
    const remote = { id: f.w, revision: 7, data: { ...copy(f.bundle), revision: 999 } };
    if (mode !== "exact") remote.data.title = "서버 자료";
    const adopted = await f.a.adoptSyncRemote(f.w, f.binding, remote, { pristine: mode === "pristine" });
    assert.deepEqual(f.rows.get("bundles"), before);
    assert.equal(adopted.status, mode === "exact" ? "synced" : mode === "pristine" ? "pending" : "conflict");
    assert.equal(adopted.syncedLocalRevision, mode === "exact" ? f.bundle.revision : -1);
    if (mode === "exact") assert.equal(await f.a.prepareSyncUpload(f.w, f.binding), null);
    if (mode === "pristine") {
      const pending = await f.a.prepareSyncUpload(f.w, f.binding);
      assert.equal(pending.expectedRevision, 7); assert.deepEqual(pending.data, f.bundle);
      // A changed server head is a CAS conflict; the local migration is not overwritten.
      await f.a.setSyncConflict(f.w, f.binding, { ...remote, revision: 8 });
      assert.deepEqual(await f.a.read(f.w), f.bundle);
    }
    const current = await f.a.getSyncState(f.w); await f.a.pauseSync(f.w, f.binding);
    const resumed = await f.a.adoptSyncRemote(f.w, f.binding, remote, { pristine: true });
    assert.equal(resumed.enabled, true); assert.deepEqual(resumed.outbox, current.outbox); assert.deepEqual(resumed.conflict, current.conflict);
  });
});

test("silent installation preserves active pointer while legacy default activates; adoption ownership and abort are atomic", async t => {
  const f = await fixture(t), originalActive = await f.a.getActive();
  const next = Core.createWorkspace({ title: "받은 자료" }), binding = { ...owner, remoteId: next.workspaceId }, input = { id: next.workspaceId, revision: 2, data: next };
  const pending = f.a.installSyncRemote(input, binding, { activate: false }); input.data.title = "요청 이후 변경";
  const installed = await pending; assert.equal(installed.title, "받은 자료"); assert.equal(await f.a.getActive(), originalActive);
  const another = Core.createWorkspace({ title: "명시적으로 받기" });
  await f.a.installSyncRemote({ id: another.workspaceId, revision: 1, data: another }, { ...owner, remoteId: another.workspaceId });
  assert.equal(await f.a.getActive(), another.workspaceId);
  const remote = { id: f.w, revision: 1, data: f.bundle };
  await assert.rejects(f.other.adoptSyncRemote(f.w, { ...foreign, remoteId: f.w }, remote), { code: "workspace_access_denied" });
  await assert.rejects(f.a.adoptSyncRemote(f.w, { ...foreign, remoteId: f.w }, remote), { code: "account_mismatch" });
  const before = copy(f.rows); f.control.failCompletion = true;
  await assert.rejects(f.a.adoptSyncRemote(f.w, f.binding, remote), { code: "storage_aborted" }); assert.deepEqual(f.rows, before);
  f.control.afterWrite = () => { f.control.afterWrite = null; f.a.dispose(); };
  await assert.rejects(f.a.adoptSyncRemote(f.w, f.binding, remote), { code: "storage_scope_closed" }); assert.deepEqual(f.rows, before);
});

test("account library eligibility includes ordinary owned imports and backups but excludes old and new automatic recoveries", async t => {
  const f = await fixture(t); await sourceReady(f);
  const restored = await Core.restoreBackup(Core.makeBackup(f.bundle)); await f.a.installWorkspace(restored);
  const other = await f.other.createWorkspace("다른 계정"), unowned = createStorage({ ...f.options, account: undefined }); t.after(() => unowned.dispose());
  const unknown = await unowned.createWorkspace("알 수 없는 소유자");
  const remote = { id: f.w, revision: 2, data: { ...copy(f.bundle), title: "서버 변경" } };
  await f.a.setSyncConflict(f.w, f.binding, remote);
  const recovery = await Core.restoreBackup(Core.makeBackup(remote.data));
  await f.a.resolveSync(f.w, f.binding, { choice: "local", expectedLocalRevision: f.bundle.revision, remoteRow: remote, copy: recovery });
  let list = await f.a.listAccountLibraries();
  assert.equal(list.find(item => item.workspaceId === f.w).eligible, true);
  assert.equal(list.find(item => item.workspaceId === restored.workspaceId).eligible, true);
  assert.deepEqual(list.find(item => item.workspaceId === recovery.workspaceId), { workspaceId: recovery.workspaceId, title: recovery.title, revision: recovery.revision, eligible: false, exclusion: "recovery" });
  assert.equal(list.some(item => [other.workspaceId, unknown.workspaceId].includes(item.workspaceId)), false);
  // Pre-feature recovery store references still protect copies without a new role marker.
  f.rows.get("meta").delete(key(`libraryRole:${recovery.workspaceId}`));
  assert.equal((await f.a.listAccountLibraries()).find(item => item.workspaceId === recovery.workspaceId).eligible, false);
  const marked = await f.a.createWorkspace("자동 준비 회복 사본");
  f.rows.get("meta").set(key(`libraryRole:${marked.workspaceId}`), { key: `libraryRole:${marked.workspaceId}`, value: { kind: "recovery" } });
  assert.equal((await f.a.listAccountLibraries()).find(item => item.workspaceId === marked.workspaceId).eligible, false);
  await assert.rejects(unowned.listAccountLibraries(), { code: "auth_scope_required" });
});

test("subscribeAll is account-scoped advisory framing and unsubscribes/closed scopes receive no later changes", async t => {
  const channels = new Map(), sent = [];
  const factory = name => { const peers = channels.get(name) || new Set(); channels.set(name, peers);
    const channel = { onmessage: null, postMessage(value) { sent.push(copy(value)); for (const peer of peers) if (peer !== channel) peer.onmessage?.({ data: copy(value) }); }, close() { peers.delete(channel); } };
    peers.add(channel); return channel; };
  const f = await fixture(t, factory); await f.b.open(); await f.other.open();
  const local = [], same = [], wrong = [], stop = f.a.subscribeAll(event => local.push(event));
  f.b.subscribeAll(event => same.push(event)); f.other.subscribeAll(event => wrong.push(event)); sent.length = 0;
  const next = await f.a.createWorkspace("새 계정 자료");
  assert.deepEqual(local, [{ type: "changed", workspaceId: next.workspaceId, revision: 0 }]); assert.deepEqual(same, local); assert.deepEqual(wrong, []);
  assert.equal(sent.length, 1); assert.deepEqual(Object.keys(sent[0]).sort(), ["revision", "sender", "type", "workspaceId"]);
  stop(); const size = local.length; f.b.dispose();
  await f.a.createWorkspace("다음 자료"); assert.equal(local.length, size); assert.equal(same.length, 1);
  await assert.rejects(f.b.listAccountLibraries(), { code: "storage_scope_closed" });
});

test("library metadata snapshot is a side-effect-free exact whitelist with monotonic child-revision sum", async t => {
  const f = await fixture(t), initial = copy(f.rows), from = f.control.transactions.length;
  assert.deepEqual(await f.a.readLibraryMetaSnapshot(f.w), { bundle: f.bundle, metadata: M.empty(f.w) });
  assert.deepEqual(f.rows, initial); assert.deepEqual(f.control.transactions.slice(from), [{ names: ["bundles", "meta"], mode: "readonly" }]);
  for (const suffix of ["annual", "page-drafts", "discovery-actions", "naver-capture", "private-capture"]) f.rows.get("meta").set(key(`${suffix}:${f.w}`), { key: `${suffix}:${f.w}`, value: { secret: suffix } });
  const before = copy(f.rows), state = await populated(f), snap = await f.a.readLibraryMetaSnapshot(f.w);
  assert.equal(state.revision, 3); assert.deepEqual(Object.keys(state).sort(), ["collection", "format", "nineBoard", "revision", "sourceFolders", "workspaceId"]);
  assert.deepEqual(snap.bundle, f.bundle); assert.deepEqual(f.rows.get("bundles"), before.get("bundles"));
  for (const [k, value] of before.get("meta")) assert.deepEqual(f.rows.get("meta").get(k), value);
  assert.equal(state.nineBoard.boards[0].areas[0].items[0].reference.value.sourceVersionId, f.prepared.version.id);
  const vector = copy(state); vector.sourceFolders.folders[0].name = "반환 사본 수정";
  assert.deepEqual((await f.a.readLibraryMetaSnapshot(f.w)).metadata, state);
  await assert.rejects(f.other.readLibraryMetaSnapshot(f.w), { code: "workspace_access_denied" });
});

test("metadata lost acknowledgement replays an immutable outbox; later child edits remain pending after old ack", async t => {
  const f = await fixture(t); await sourceReady(f); const state = await populated(f);
  await f.a.bindLibraryMetaSync(f.w, f.binding); const outbox = await f.a.prepareLibraryMetaUpload(f.w, f.binding);
  assert.deepEqual(outbox.data, state); assert.equal(outbox.sourceRevision, 1);
  const reloaded = createStorage(f.options); t.after(() => reloaded.dispose());
  assert.deepEqual(await reloaded.prepareLibraryMetaUpload(f.w, f.binding), outbox);
  let folders = await f.b.readSourceFolders(f.w); folders = F.updateFolder(folders, folders.folders[0].id, { name: "응답 유실 뒤 수정", parentId: null });
  await f.b.saveSourceFolders(f.w, folders, folders.revision);
  assert.deepEqual(await reloaded.prepareLibraryMetaUpload(f.w, f.binding), outbox);
  const before = copy(f.rows);
  await assert.rejects(f.a.ackLibraryMetaSync(f.w, f.binding, Core.id(), 1), { code: "stale_sync_result" }); assert.deepEqual(f.rows, before);
  f.control.failCompletion = true;
  await assert.rejects(f.a.ackLibraryMetaSync(f.w, f.binding, outbox.operationId, 1), { code: "storage_aborted" }); assert.deepEqual(f.rows, before);
  const ack = await reloaded.ackLibraryMetaSync(f.w, f.binding, outbox.operationId, 1);
  assert.equal(ack.status, "pending"); assert.equal(ack.syncedLocalRevision, 3);
  const second = await f.a.prepareLibraryMetaUpload(f.w, f.binding); assert.notEqual(second.operationId, outbox.operationId);
  assert.equal(second.expectedRevision, 1); assert.equal(second.localRevision, 4); assert.equal(second.data.sourceFolders.folders[0].name, "응답 유실 뒤 수정");
  const saved = await f.a.ackLibraryMetaSync(f.w, f.binding, second.operationId, 2); assert.equal(saved.status, "synced");
  assert.equal(await f.a.prepareLibraryMetaUpload(f.w, f.binding), null); assert.deepEqual(await f.a.read(f.w), f.bundle);
});

test("first metadata and saved Workbench receive only adopt pristine counters and exact empty payload", async t => {
  const f = await fixture(t); await sourceReady(f);
  const metadata = M.empty(f.w); metadata.sourceFolders = F.createFolder(metadata.sourceFolders, { name: "서버 폴더", parentId: null });
  metadata.sourceFolders.revision = 91; metadata.collection.revision = 51; metadata.nineBoard.revision = 77; metadata.revision = 100;
  await f.a.bindLibraryMetaSync(f.w, f.binding);
  const remote = row(f.w, metadata, 8), original = copy(remote), events = [];
  f.a.subscribe(f.w, event => events.push(event));
  const adopted = await f.a.adoptLibraryMetaRemote(f.w, f.binding, remote); assert.deepEqual(adopted, { status: "stored", revision: 3 }); assert.deepEqual(remote, original);
  const current = (await f.a.readLibraryMetaSnapshot(f.w)).metadata; assert.deepEqual(content(current), content(metadata));
  assert.deepEqual([current.sourceFolders.revision, current.collection.revision, current.nineBoard.revision], [1, 1, 1]);
  assert.deepEqual(events.map(event => event.type), ["source_folders_changed", "collection_changed", "nine_board_changed", "library_meta_sync_changed"]);
  assert.equal((await f.a.getLibraryMetaState(f.w)).status, "synced");
  const unchanged = copy(f.rows); assert.equal((await f.a.adoptLibraryMetaRemote(f.w, f.binding, remote)).status, "conflict"); assert.deepEqual(f.rows, unchanged);
  const wb = Workbench.empty(f.w); wb.page.title = "서버 저장 구성"; wb.revision = 40;
  await f.a.bindCompositionSync(f.w, f.binding);
  assert.deepEqual(await f.a.adoptCompositionRemote(f.w, f.binding, row(f.w, wb, 5)), { status: "stored", revision: 1 });
  assert.deepEqual(await f.a.readWorkbench(f.w), { ...wb, revision: 1 });
  assert.equal((await f.a.getCompositionState(f.w)).status, "synced");
  const newer = copy(f.rows); assert.equal((await f.a.adoptCompositionRemote(f.w, f.binding, row(f.w, wb, 5))).status, "conflict"); assert.deepEqual(f.rows, newer);
});

test("first receive refuses deliberately edited empty metadata/Workbench and preserves immutable pending operations", async t => {
  for (const domain of ["library", "workbench"]) await t.test(domain, async t => {
    const f = await fixture(t); await sourceReady(f);
    if (domain === "library") {
      const empty = await f.a.readCollection(f.w); await f.a.saveCollection(f.w, empty, 0);
      await f.a.bindLibraryMetaSync(f.w, f.binding); const before = copy(f.rows);
      assert.equal((await f.a.adoptLibraryMetaRemote(f.w, f.binding, row(f.w, M.empty(f.w)))).status, "conflict"); assert.deepEqual(f.rows, before);
      const outbox = await f.a.prepareLibraryMetaUpload(f.w, f.binding); const pending = copy(f.rows);
      assert.equal((await f.a.adoptLibraryMetaRemote(f.w, f.binding, row(f.w, M.empty(f.w)))).status, "conflict"); assert.deepEqual(f.rows, pending);
      await f.a.pauseLibraryMetaSync(f.w, f.binding); await f.a.bindLibraryMetaSync(f.w, f.binding);
      assert.deepEqual((await f.a.getLibraryMetaState(f.w)).outbox, outbox);
    } else {
      const empty = await f.a.readWorkbench(f.w); await f.a.saveWorkbench(f.w, empty, 0);
      await f.a.bindCompositionSync(f.w, f.binding); const before = copy(f.rows);
      assert.equal((await f.a.adoptCompositionRemote(f.w, f.binding, row(f.w, Workbench.empty(f.w)))).status, "conflict"); assert.deepEqual(f.rows, before);
    }
  });
});

test("remote metadata changes conflict with local edits; either choice keeps nonchosen metadata and exact Core recovery", async t => {
  for (const choice of ["local", "remote"]) await t.test(choice, async t => {
    const f = await fixture(t); await sourceReady(f); const saved = await populated(f);
    await f.a.bindLibraryMetaSync(f.w, f.binding); const outbox = await f.a.prepareLibraryMetaUpload(f.w, f.binding); await f.a.ackLibraryMetaSync(f.w, f.binding, outbox.operationId, 1);
    const c = await f.a.readCollection(f.w); c.items[0].note = "내 최신 메모"; await f.a.saveCollection(f.w, c, c.revision);
    const mine = (await f.a.readLibraryMetaSnapshot(f.w)).metadata, remote = row(f.w, saved, 2); remote.data.sourceFolders.folders[0].name = "다른 기기 폴더";
    assert.equal((await f.a.applyLibraryMetaRemote(f.w, f.binding, row(f.w, saved))).status, "stored");
    assert.equal((await f.a.getLibraryMetaState(f.w)).status, "pending");
    assert.equal((await f.a.applyLibraryMetaRemote(f.w, f.binding, remote)).status, "conflict");
    const before = copy(f.rows); f.control.failCompletion = true;
    await assert.rejects(f.a.resolveLibraryMetaSync(f.w, f.binding, { choice, expectedLocalRevision: mine.revision, remoteRow: remote }), { code: "storage_aborted" }); assert.deepEqual(f.rows, before);
    const result = await f.a.resolveLibraryMetaSync(f.w, f.binding, { choice, expectedLocalRevision: mine.revision, remoteRow: remote });
    const recovery = await f.a.readLibraryMetaRecovery(f.w, result.recoveryId);
    assert.deepEqual(recovery.bundle, f.bundle); assert.deepEqual(recovery.metadata, choice === "remote" ? mine : remote.data);
    assert.equal((await f.a.listLibraryMetaRecoveries(f.w))[0].id, result.recoveryId);
    const kept = (await f.a.readLibraryMetaSnapshot(f.w)).metadata;
    assert.deepEqual(content(kept), content(choice === "remote" ? remote.data : mine));
    assert.equal((await f.a.getLibraryMetaState(f.w)).status, choice === "remote" ? "synced" : "pending");
    await assert.rejects(f.other.readLibraryMetaRecovery(f.w, result.recoveryId), { code: "workspace_access_denied" });
    await f.a.setLibraryMetaConflict(f.w, f.binding, null); const missing = copy(f.rows);
    await assert.rejects(f.a.resolveLibraryMetaSync(f.w, f.binding, { choice, expectedLocalRevision: kept.revision, remoteRow: null }), { code: "remote_missing" }); assert.deepEqual(f.rows, missing);
  });
});

test("metadata transaction aborts at every child/head/state write without partial apply or success events", async t => {
  const f = await fixture(t); await sourceReady(f); await f.a.bindLibraryMetaSync(f.w, f.binding);
  const metadata = M.empty(f.w); metadata.sourceFolders = F.createFolder(metadata.sourceFolders, { name: "수신 폴더", parentId: null });
  const remote = row(f.w, metadata), events = []; f.a.subscribe(f.w, event => events.push(event));
  for (const prefix of ["source-folders:", "collection:", "nine-board:", "libraryMetaHead:", "libraryMetaSync:", "completion"]) {
    const before = copy(f.rows); events.length = 0;
    if (prefix === "completion") f.control.failCompletion = true;
    else f.control.fail = ({ name, id }) => name === "meta" && id.startsWith(prefix);
    await assert.rejects(f.a.adoptLibraryMetaRemote(f.w, f.binding, remote), { code: prefix === "completion" ? "storage_aborted" : "storage_quota" });
    assert.deepEqual(f.rows, before); assert.deepEqual(events, []);
  }
  assert.equal((await f.a.adoptLibraryMetaRemote(f.w, f.binding, remote)).status, "stored");
  const before = copy(f.rows), next = row(f.w, metadata, 2); next.data.sourceFolders.folders[0].name = "계정 교체 전 입력";
  f.control.afterWrite = ({ name, id }) => { if (name === "meta" && id.startsWith("collection:")) { f.control.afterWrite = null; f.a.dispose(); } };
  await assert.rejects(f.a.applyLibraryMetaRemote(f.w, f.binding, next), { code: "storage_scope_closed" }); assert.deepEqual(f.rows, before);
});

test("source readiness, stale heads, exact reference mismatch and projection overflow reject without metadata mutation", async t => {
  const f = await fixture(t); await sourceReady(f); const state = await populated(f); await f.a.bindLibraryMetaSync(f.w, f.binding);
  const outbox = await f.a.prepareLibraryMetaUpload(f.w, f.binding); await f.a.ackLibraryMetaSync(f.w, f.binding, outbox.operationId, 1);
  const before = copy(f.rows), malformed = row(f.w, state, 2);
  malformed.data.nineBoard.boards[0].areas[0].items[0].reference.value.quote = "xx";
  await assert.rejects(f.a.applyLibraryMetaRemote(f.w, f.binding, malformed)); assert.deepEqual(f.rows, before);
  await assert.rejects(f.a.applyLibraryMetaRemote(f.w, f.binding, row(f.w, state, 2, 2)), { code: "composition_source_pending" }); assert.deepEqual(f.rows, before);
  const changed = { ...copy(state), revision: 50 }; changed.collection.items[0].note = "같은 서버 revision 다른 내용";
  await assert.rejects(f.a.applyLibraryMetaRemote(f.w, f.binding, row(f.w, changed)), { code: "remote_revision_mismatch" }); assert.deepEqual(f.rows, before);
  const updated = await Core.prepareImport({ origin: "obsidian", title: "추가 자료", text: "새 원문" }, f.bundle);
  await f.a.commitLocal({ workspaceId: f.w, operationId: Core.id(), baseRevision: f.bundle.revision, changes: Core.buildImportChanges(f.bundle, updated) });
  const pending = copy(f.rows); await assert.rejects(f.a.prepareLibraryMetaUpload(f.w, f.binding), { code: "composition_source_pending" }); assert.deepEqual(f.rows, pending);
  const k = `collection:${f.w}`, collection = copy(f.rows.get("meta").get(key(k))); collection.value.revision = Number.MAX_SAFE_INTEGER;
  f.rows.get("meta").set(key(k), collection); const overflow = copy(f.rows);
  await assert.rejects(f.a.readLibraryMetaSnapshot(f.w), { code: "invalid_library_meta_metadata" }); assert.deepEqual(f.rows, overflow);
});

test("actual material handoff recovery is excluded while ordinary explicit receive remains eligible; role failure rolls back", async t => {
  const f = await fixture(t), MW = require("../assets/life/material-writing.js"), MC = require("../assets/life/material-continuity.js");
  const plan = MW.create(Core.id); plan.title = "명시적으로 받은 준비";
  const remote = { id: Core.id(), revision: 1, data: MC.snapshot(f.bundle, plan, null) };
  const installed = await f.a.installMaterialContinuity(remote);
  assert.equal((await f.a.listAccountLibraries()).find(item => item.workspaceId === installed.workspaceId).eligible, true);
  const target = { workspaceId: installed.workspaceId, planId: installed.planId };
  const snapshot = await f.a.readMaterialContinuitySnapshot(target.workspaceId, target.planId), newer = copy(remote);
  newer.revision = 2; newer.data.plan.question = "다른 기기의 질문";
  const before = copy(f.rows); f.control.fail = ({ name, id }) => name === "meta" && id.startsWith("libraryRole:");
  await assert.rejects(f.a.installMaterialContinuity(newer, { target, expectedFingerprint: snapshot.fingerprint, preserveLocal: true }), { code: "storage_quota" });
  assert.deepEqual(f.rows, before);
  const changed = await f.a.installMaterialContinuity(newer, { target, expectedFingerprint: snapshot.fingerprint, preserveLocal: true });
  assert.equal((await f.a.listAccountLibraries()).find(item => item.workspaceId === changed.recoveryWorkspaceId).eligible, false);
  assert.equal((await f.a.listAccountLibraries()).find(item => item.workspaceId === installed.workspaceId).eligible, true);
});

test("metadata errors, paused state and cross-account operations never discard durable pending content", async t => {
  const f = await fixture(t); await sourceReady(f); await populated(f); await f.a.bindLibraryMetaSync(f.w, f.binding);
  const outbox = await f.a.prepareLibraryMetaUpload(f.w, f.binding);
  let error = await f.a.setLibraryMetaError(f.w, f.binding, { code: "network_error", message: "연결 실패" });
  assert.equal(error.status, "error"); assert.deepEqual(error.outbox, outbox);
  assert.equal((await f.a.getLibraryMetaState(f.w)).status, "error");
  error = await f.a.setLibraryMetaError(f.w, f.binding, null); assert.equal(error.status, "pending");
  const paused = await f.a.pauseLibraryMetaSync(f.w, f.binding); assert.equal(paused.enabled, false); assert.deepEqual(paused.outbox, outbox);
  const before = copy(f.rows);
  await assert.rejects(f.a.prepareLibraryMetaUpload(f.w, f.binding), { code: "composition_paused" }); assert.deepEqual(f.rows, before);
  for (const attempt of [
    () => f.other.getLibraryMetaState(f.w), () => f.other.readLibraryMetaSnapshot(f.w),
    () => f.other.bindLibraryMetaSync(f.w, { ...foreign, remoteId: f.w }),
    () => f.other.listLibraryMetaRecoveries(f.w)
  ]) await assert.rejects(attempt(), { code: "workspace_access_denied" });
  await assert.rejects(f.a.bindLibraryMetaSync(f.w, { ...foreign, remoteId: f.w }), { code: "account_mismatch" }); assert.deepEqual(f.rows, before);
  await f.a.bindLibraryMetaSync(f.w, f.binding); assert.deepEqual((await f.a.getLibraryMetaState(f.w)).outbox, outbox);
});

async function initialEmptyRace(f, domain) {
  await sourceReady(f);
  const composition = domain === "workbench";
  const api = {
    bind: composition ? "bindCompositionSync" : "bindLibraryMetaSync",
    prepare: composition ? "prepareCompositionUpload" : "prepareLibraryMetaUpload",
    adopt: composition ? "adoptCompositionRemote" : "adoptLibraryMetaRemote",
    get: composition ? "getCompositionState" : "getLibraryMetaState",
    conflict: composition ? "setCompositionConflict" : "setLibraryMetaConflict"
  };
  await f.a[api.bind](f.w, f.binding);
  const outbox = await f.a[api.prepare](f.w, f.binding);
  assert.equal(outbox.expectedRevision, 0); assert.equal(outbox.localRevision, 0);
  return { ...api, outbox, remote: row(f.w, outbox.data, 1, outbox.sourceRevision) };
}

test("simultaneous canonical-empty first-write losers converge only their exact pending operation atomically", async t => {
  for (const domain of ["workbench", "metadata"]) await t.test(domain, async t => {
    const f = await fixture(t), race = await initialEmptyRace(f, domain), sourceBefore = copy(await f.a.read(f.w));
    // Infrastructure counters in a valid remote snapshot do not change its canonical content.
    race.remote.data.revision = 90;
    if (domain === "metadata") for (const name of ["sourceFolders", "collection", "nineBoard"]) race.remote.data[name].revision = 30;
    const remoteBefore = copy(race.remote), opts = { outboxOperationId: race.outbox.operationId }, events = [];
    f.a.subscribe(f.w, event => events.push(event));
    const pending = f.a[race.adopt](f.w, f.binding, race.remote, opts);
    opts.outboxOperationId = Core.id(); race.remote.data.revision = 999;
    const result = await pending; assert.equal(result.status, "stored");
    const sync = await f.a[race.get](f.w);
    assert.equal(sync.outbox, null); assert.equal(sync.conflict, null); assert.equal(sync.remoteRevision, 1); assert.equal(sync.sourceRevision, 1); assert.equal(sync.status, "synced");
    assert.equal(sync.syncedLocalRevision, domain === "workbench" ? 1 : 3);
    const prefix = domain === "workbench" ? "compositionHead:" : "libraryMetaHead:";
    assert.deepEqual(f.rows.get("meta").get(key(prefix + f.w)).value, remoteBefore);
    assert.deepEqual(await f.a.read(f.w), sourceBefore);
    assert.equal(events.filter(event => event.type === (domain === "workbench" ? "composition_sync_changed" : "library_meta_sync_changed")).length, 1);
    assert.equal(await f.a[race.prepare](f.w, f.binding), null);
    // A later replay cannot erase or re-acknowledge a completed initial operation.
    const before = copy(f.rows);
    assert.equal((await f.a[race.adopt](f.w, f.binding, remoteBefore, { outboxOperationId: race.outbox.operationId })).status, "conflict");
    assert.deepEqual(f.rows, before);
  });
});

test("empty-first-write convergence refuses later edits, other operations/content/heads/source revisions and missing rows", async t => {
  for (const domain of ["workbench", "metadata"]) for (const scenario of ["later-edit", "wrong-operation", "remote-content", "remote-head", "source-advanced", "conflict", "no-option", "missing", "invalid-option"]) await t.test(domain + ":" + scenario, async t => {
    const f = await fixture(t), race = await initialEmptyRace(f, domain), options = { outboxOperationId: race.outbox.operationId };
    if (scenario === "later-edit") {
      if (domain === "workbench") { const value = await f.a.readWorkbench(f.w); value.page.intro = "첫 전송 뒤 입력"; await f.a.saveWorkbench(f.w, value, value.revision); }
      else { const value = await f.a.readCollection(f.w); await f.a.saveCollection(f.w, value, value.revision); }
    }
    if (scenario === "wrong-operation") options.outboxOperationId = Core.id();
    if (scenario === "remote-content") {
      if (domain === "workbench") race.remote.data.page.intro = "서로 다른 서버 구성";
      else race.remote.data.sourceFolders = F.createFolder(race.remote.data.sourceFolders, { name: "서로 다른 폴더", parentId: null });
    }
    if (scenario === "remote-head") race.remote.revision = 2;
    if (scenario === "source-advanced") {
      const bundle = await f.a.read(f.w), added = await Core.prepareImport({ origin: "obsidian", title: "나중 원문", text: "원문 기준을 올린 자료" }, bundle);
      assert.equal((await f.a.commitLocal({ workspaceId: f.w, operationId: Core.id(), baseRevision: bundle.revision, changes: Core.buildImportChanges(bundle, added) })).status, "stored");
      const source = await f.a.prepareSyncUpload(f.w, f.binding); await f.a.ackSync(f.w, f.binding, source.operationId, 2);
    }
    if (scenario === "conflict") await f.a[race.conflict](f.w, f.binding, race.remote);
    if (scenario === "invalid-option") options.extra = true;
    const before = copy(f.rows), events = []; f.a.subscribe(f.w, event => events.push(event));
    if (scenario === "missing") await assert.rejects(f.a[race.adopt](f.w, f.binding, null, options), { code: "invalid_remote_snapshot" });
    else if (scenario === "invalid-option") await assert.rejects(f.a[race.adopt](f.w, f.binding, race.remote, options), { code: "invalid_request" });
    else assert.equal((await f.a[race.adopt](f.w, f.binding, race.remote, scenario === "no-option" ? {} : options)).status, "conflict");
    assert.deepEqual(f.rows, before); assert.deepEqual(events, []);
    assert.deepEqual((await f.a[race.get](f.w)).outbox, race.outbox);
  });
});

test("initial-empty CAS convergence rolls back every metadata/receipt write and failed completion without losing the outbox", async t => {
  for (const domain of ["workbench", "metadata"]) await t.test(domain, async t => {
    const f = await fixture(t), race = await initialEmptyRace(f, domain), options = { outboxOperationId: race.outbox.operationId }, events = [];
    const prefixes = domain === "workbench" ? ["workbench:", "compositionHead:", "compositionSync:"] : ["source-folders:", "collection:", "nine-board:", "libraryMetaHead:", "libraryMetaSync:"];
    f.a.subscribe(f.w, event => events.push(event));
    for (const prefix of [...prefixes, "completion"]) {
      const before = copy(f.rows); events.length = 0;
      if (prefix === "completion") f.control.failCompletion = true;
      else f.control.fail = ({ name, id }) => name === "meta" && id.startsWith(prefix);
      await assert.rejects(f.a[race.adopt](f.w, f.binding, race.remote, options), { code: prefix === "completion" ? "storage_aborted" : "storage_quota" });
      assert.deepEqual(f.rows, before); assert.deepEqual(events, []); assert.deepEqual((await f.a[race.get](f.w)).outbox, race.outbox);
    }
    assert.equal((await f.a[race.adopt](f.w, f.binding, race.remote, options)).status, "stored");
  });
});

"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const Core = require("../assets/life/core.js"), Workbench = require("../assets/life/workbench.js");
const F = require("../assets/life/source-folders.js"), Edit = require("../assets/life/source-edit.js");
const { createStorage } = require("../assets/life/storage.js");
const copy = value => structuredClone(value), key = value => JSON.stringify(value);
const account = { projectUrl: "https://folders-test.supabase.co", userId: "anonymous-a" };
const foreign = { ...account, userId: "anonymous-b" };
const rowKey = w => `source-folders:${JSON.stringify([account.projectUrl, account.userId])}:${w}`;
// Serialized application-level fault adapter, not an IndexedDB event-loop claim.
// Independent browser journeys use real SDK/IndexedDB transactions.
function adapter() {
  const rows = new Map(), paths = new Map(), control = { fail: null, failCompletion: false, writes: [] }; let tail = Promise.resolve();
  const idb = { async openDB(_name, _version, callbacks) {
    let closed = false;
    const db = {
      objectStoreNames: { contains: name => rows.has(name) },
      createObjectStore(name, options) { rows.set(name, new Map()); paths.set(name, options.keyPath); return { createIndex() {} }; },
      close() { closed = true; },
      transaction(names, mode) {
        if (closed) throw new DOMException('closed', 'InvalidStateError');
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
          return id;
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

async function fixture(channelFactory = null) {
  const db = adapter(), options = { idb: db.idb, core: Core, workbench: Workbench, sourceFolders: F, channelFactory, account };
  const a = createStorage(options), b = createStorage(options), other = createStorage({ ...options, account: foreign });
  let bundle = await a.createWorkspace("익명 폴더 검수");
  const imported = [];
  for (const title of ["첫 자료", "둘째 자료"]) {
    const p = await Core.prepareImport({ origin: "obsidian", title, text: "\uFEFF# 익명 원문\r\n같은 😀 구절\r\n" }, bundle);
    await a.commitLocal({ workspaceId: bundle.workspaceId, operationId: Core.id(), baseRevision: bundle.revision, changes: Core.buildImportChanges(bundle, p) });
    imported.push(p); bundle = await a.read(bundle.workspaceId);
  }
  const w = bundle.workspaceId;
  let folders = F.createFolder(F.empty(w), { name: "연구", parentId: null });
  const first = folders.folders.at(-1).id;
  folders = F.createFolder(folders, { name: "언어", parentId: first });
  const child = folders.folders.at(-1).id;
  return { ...db, a, b, other, options, bundle, w, imported, folders, first, child,
    close() { a.close(); b.close(); other.close(); } };
}
const assign = (f, state = f.folders, which = 0, folder = f.child) => F.assignSources(state, [f.imported[which].source.id], folder);

test("read-only snapshots and folder saves preserve bundles, Workbench and exact source/composition upload data", async t => {
  const f = await fixture(); t.after(f.close);
  const before = copy(f.rows), empty = F.empty(f.w);
  assert.deepEqual(await f.a.readSourceFolders(f.w), empty);
  const snapshot = await f.a.readLibraryBackupSnapshot(f.w);
  assert.deepEqual(snapshot, { bundle: f.bundle, workbench: Workbench.empty(f.w), sourceFolders: empty });
  assert.deepEqual(f.rows, before);
  const input = assign(f), saved = await f.a.saveSourceFolders(f.w, input, 0);
  assert.equal(saved.revision, 1); assert.equal(input.revision, 0);
  assert.deepEqual(await f.a.readSourceFoldersSnapshot(f.w), { bundle: f.bundle, sourceFolders: saved });
  assert.deepEqual(await f.a.readWorkbenchSnapshot(f.w), { bundle: f.bundle, workbench: snapshot.workbench });
  assert.deepEqual(f.rows.get("bundles"), before.get("bundles"));
  const oldMeta = before.get("meta"), meta = f.rows.get("meta");
  for (const [k, v] of oldMeta) assert.deepEqual(meta.get(k), v);
  assert.equal(meta.size, oldMeta.size + 1);
  assert.deepEqual(meta.get(key(rowKey(f.w))).value, saved);
  const binding = { ...account, remoteId: f.w };
  await f.a.bindSync(f.w, binding);
  const sourceUpload = await f.a.prepareSyncUpload(f.w, binding);
  assert.deepEqual(sourceUpload.data, f.bundle);
  await f.a.ackSync(f.w, binding, sourceUpload.operationId, 1);
  let wb = await f.a.readWorkbench(f.w); wb.page.title = "익명 구성";
  wb = await f.a.saveWorkbench(f.w, wb, wb.revision);
  await f.a.bindCompositionSync(f.w, binding);
  const composition = await f.a.prepareCompositionUpload(f.w, binding);
  assert.deepEqual(composition.data, wb); assert.equal(Object.hasOwn(composition.data, "sourceFolders"), false);
  assert.equal(JSON.stringify(Core.makeBackup(f.bundle)).includes(F.FORMAT), false);
});

test("independent tabs enforce CAS and capture caller input before awaiting storage", async t => {
  const f = await fixture(); t.after(f.close);
  const first = assign(f), second = F.updateFolder(assign(f), f.child, { name: "다른 탭 입력", parentId: f.first });
  const results = await Promise.allSettled([f.a.saveSourceFolders(f.w, first, 0), f.b.saveSourceFolders(f.w, second, 0)]);
  assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
  assert.equal(results.find(row => row.status === "rejected").reason.code, "source_folders_conflict");
  assert.equal(second.folders.at(-1).name, "다른 탭 입력");
  const current = await f.a.readSourceFolders(f.w), input = F.updateFolder(current, f.child, { name: "저장 순간", parentId: f.first });
  const pending = f.a.saveSourceFolders(f.w, input, current.revision); input.folders.at(-1).name = "이후 입력";
  assert.equal((await pending).folders.at(-1).name, "저장 순간");
  await assert.rejects(f.a.saveSourceFolders(f.w, { ...current, revision: current.revision + 1 }, current.revision), { code: "source_folders_conflict" });
});

test("new trash/missing assignments fail while identical old pairs survive; explicit unassignment stays possible", async t => {
  const f = await fixture(); t.after(f.close);
  let saved = await f.a.saveSourceFolders(f.w, assign(f), 0);
  let bundle = await f.a.read(f.w);
  await f.b.commitLocal({ workspaceId: f.w, operationId: Core.id(), baseRevision: bundle.revision,
    changes: Core.buildSourceStateChanges(bundle, f.imported[0].source.id, "trash") });
  const moved = F.assignSources(saved, [f.imported[0].source.id], f.first), before = copy(f.rows);
  await assert.rejects(f.a.saveSourceFolders(f.w, moved, saved.revision), { code: "source_trashed" });
  assert.deepEqual(f.rows, before);
  saved = await f.a.saveSourceFolders(f.w, F.updateFolder(saved, f.child, { name: "유지한 폴더", parentId: f.first }), saved.revision);
  assert.equal(F.folderFor(saved, f.imported[0].source.id), f.child);
  // Model an incoming source snapshot temporarily lacking an old local source.
  bundle = await f.a.read(f.w); const missing = f.imported[0].source.id;
  bundle.sources = bundle.sources.filter(row => row.id !== missing);
  bundle.sourceVersions = bundle.sourceVersions.filter(row => row.sourceId !== missing);
  bundle.links = bundle.links.filter(row => !row.entityRefs?.some(ref => ref.entityId === missing));
  Core.validateWorkspace(bundle); f.rows.get("bundles").set(key(f.w), copy(bundle));
  assert.deepEqual(await f.a.readSourceFolders(f.w), saved);
  await assert.rejects(f.a.saveSourceFolders(f.w, F.assignSources(saved, [missing], f.first), saved.revision), { code: "source_folders_missing_reference" });
  await assert.rejects(f.a.saveSourceFolders(f.w, F.assignSources(saved, [Core.id()], f.first), saved.revision), { code: "source_folders_missing_reference" });
  assert.throws(() => F.makeBackup(bundle, Workbench.empty(f.w), saved), { code: "source_folders_missing_reference" });
  saved = await f.a.saveSourceFolders(f.w, F.assignSources(saved, [missing], null), saved.revision);
  assert.equal(F.folderFor(saved, missing), null);
});

test("account/workspace guards and corrupt local profiles fail closed without replacing data", async t => {
  const f = await fixture(); t.after(f.close);
  const otherWorkspace = await f.a.createWorkspace("別 공간");
  for (const fn of [() => f.other.readSourceFolders(f.w), () => f.other.readSourceFoldersSnapshot(f.w), () => f.other.readLibraryBackupSnapshot(f.w), () => f.other.saveSourceFolders(f.w, f.folders, 0)])
    await assert.rejects(fn(), { code: "workspace_access_denied" });
  await assert.rejects(f.a.saveSourceFolders(otherWorkspace.workspaceId, f.folders, 0), { code: "workspace_mismatch" });
  assert.deepEqual(await f.a.readSourceFolders(otherWorkspace.workspaceId), F.empty(otherWorkspace.workspaceId));
  const base = createStorage({ ...f.options, account: undefined }); t.after(() => base.close());
  await assert.rejects(base.readSourceFolders(f.w), { code: "auth_scope_required" });
  await assert.rejects(base.installLibraryCopy({ bundle: f.bundle, workbench: Workbench.empty(f.w), sourceFolders: f.folders }), { code: "auth_scope_required" });
  f.rows.get("meta").set(key(rowKey(f.w)), { key: rowKey(f.w), value: { ...f.folders, unexpected: true } });
  const before = copy(f.rows);
  await assert.rejects(f.a.readSourceFolders(f.w), { code: "source_folders_invalid" });
  assert.deepEqual(f.rows, before);
  f.a.dispose();
  await assert.rejects(f.a.readSourceFolders(f.w), { code: "storage_scope_closed" });
  await assert.rejects(f.a.saveSourceFolders(f.w, f.folders, 0), { code: "storage_scope_closed" });
});

test("write failures and commit aborts preserve the prior graph and emit no successful notification", async t => {
  const f = await fixture(); t.after(f.close); const events = [];
  f.a.subscribe(f.w, event => events.push(event));
  for (const mode of ["write", "completion"]) {
    const before = copy(f.rows);
    if (mode === "write") f.control.fail = ({ name, id }) => name === "meta" && id === rowKey(f.w);
    else f.control.failCompletion = true;
    await assert.rejects(f.a.saveSourceFolders(f.w, assign(f), 0), { code: mode === "write" ? "storage_quota" : "storage_aborted" });
    assert.deepEqual(f.rows, before); assert.deepEqual(events, []);
  }
  const saved = await f.a.saveSourceFolders(f.w, assign(f), 0);
  assert.deepEqual(events, [{ type: "source_folders_changed", workspaceId: f.w, revision: saved.revision }]);
});

test("folder broadcasts carry only revision framing within the account and a closed pending save cannot write", async t => {
  const channels = new Map(), sent = [];
  const factory = name => {
    const group = channels.get(name) || new Set(); channels.set(name, group);
    const channel = { onmessage: null, postMessage(value) {
      sent.push(copy(value)); for (const peer of group) if (peer !== channel) peer.onmessage?.({ data: copy(value) });
    }, close() { group.delete(channel); } };
    group.add(channel); return channel;
  };
  const f = await fixture(factory); t.after(f.close);
  await f.b.open(); await f.other.open();
  const own = [], peer = [], foreignEvents = [];
  f.a.subscribe(f.w, event => own.push(event)); f.b.subscribe(f.w, event => peer.push(event));
  f.other.subscribe(f.w, event => foreignEvents.push(event)); sent.length = 0;
  const saved = await f.a.saveSourceFolders(f.w, assign(f), 0);
  const expected = { type: "source_folders_changed", workspaceId: f.w, revision: saved.revision };
  assert.deepEqual(own, [expected]); assert.deepEqual(peer, [expected]); assert.deepEqual(foreignEvents, []);
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0]).sort(), ["revision", "sender", "type", "workspaceId"]);
  const before = copy(f.rows), pending = f.b.saveSourceFolders(f.w, F.updateFolder(saved, f.child, { name: "未 저장", parentId: f.first }), saved.revision);
  f.b.dispose(); await assert.rejects(pending, { code: "storage_scope_closed" }); assert.deepEqual(f.rows, before);
});

test("new and legacy library backups remap exact IDs and install all metadata atomically with rollback at every write", async t => {
  const f = await fixture(); t.after(f.close);
  const saved = await f.a.saveSourceFolders(f.w, assign(f), 0);
  const snapshot = await f.a.readLibraryBackupSnapshot(f.w), wrapper = F.makeBackup(snapshot.bundle, snapshot.workbench, saved);
  const original = copy(wrapper), candidate = await F.restoreBackup(wrapper);
  assert.deepEqual(wrapper, original); assert.notEqual(candidate.bundle.workspaceId, f.w);
  assert.equal(candidate.sourceFolders.revision, 0);
  assert.notEqual(candidate.sourceFolders.folders[0].id, f.first);
  const source = candidate.bundle.sources.find(row => row.title === f.imported[0].source.title);
  assert.equal(candidate.sourceFolders.assignments[0].sourceId, source.id);
  assert.equal(F.list(candidate.sourceFolders).find(row => row.id === F.folderFor(candidate.sourceFolders, source.id)).label, "연구 / 언어");
  const legacy = await F.restoreBackup(Workbench.makeBackup(f.bundle, snapshot.workbench));
  assert.deepEqual(legacy.sourceFolders, F.empty(legacy.bundle.workspaceId));
  for (const point of ["bundle", "owner", "workbench", "folders", "active", "completion"]) {
    const before = copy(f.rows), w = candidate.bundle.workspaceId;
    if (point === "completion") f.control.failCompletion = true;
    else f.control.fail = ({ name, method, id }) => point === "bundle" ? name === "bundles" && method === "add" : name === "meta" &&
      (point === "owner" ? id === `owner:${w}` : point === "workbench" ? id === `workbench:${w}` : point === "folders" ? id === rowKey(w) : id.startsWith("activeWorkspace:"));
    await assert.rejects(f.a.installLibraryCopy(candidate), { code: point === "completion" ? "storage_aborted" : "storage_quota" });
    assert.deepEqual(f.rows, before);
  }
  const installed = await f.a.installLibraryCopy(candidate);
  assert.deepEqual(installed, candidate);
  assert.deepEqual(await f.a.readLibraryBackupSnapshot(candidate.bundle.workspaceId), candidate);
  assert.equal(await f.a.getActive(), candidate.bundle.workspaceId);
  assert.deepEqual(await f.a.read(f.w), f.bundle);
  await assert.rejects(f.a.installLibraryCopy(candidate), { code: "workspace_exists" });
  const bad = copy(legacy); bad.sourceFolders = F.createFolder(bad.sourceFolders, { name: "잘못된 연결", parentId: null });
  const folder = bad.sourceFolders.folders[0].id; bad.sourceFolders = F.assignSources(bad.sourceFolders, [Core.id()], folder);
  const before = copy(f.rows);
  await assert.rejects(f.a.installLibraryCopy(bad), { code: "source_folders_missing_reference" }); assert.deepEqual(f.rows, before);
  f.control.fail = ({ name, id }) => {
    if (name === "meta" && id === `owner:${legacy.bundle.workspaceId}`) { f.control.fail = null; f.b.dispose(); }
    return false;
  };
  await assert.rejects(f.b.installLibraryCopy(legacy), { code: "storage_scope_closed" });
  assert.deepEqual(f.rows, before);
});

test("same-source immutable edits inherit membership without changing original bodies or Workbench", async t => {
  const f = await fixture(); t.after(f.close);
  const saved = await f.a.saveSourceFolders(f.w, assign(f), 0), source = f.imported[0].source;
  const edit = await Edit.prepare(f.bundle, Edit.edit(Edit.begin(f.bundle, source.id), { text: "# 내 명시 수정\r\n새 본문😀" }));
  await f.a.commitLocal({ workspaceId: f.w, operationId: Core.id(), baseRevision: f.bundle.revision, changes: edit.changes });
  const snapshot = await f.a.readLibraryBackupSnapshot(f.w);
  assert.equal(edit.source.id, source.id);
  assert.deepEqual(snapshot.sourceFolders, saved);
  assert.equal(F.folderFor(snapshot.sourceFolders, edit.source.id), f.child);
  assert.deepEqual(snapshot.bundle.sourceVersions.find(row => row.id === f.imported[0].version.id), f.imported[0].version);
  assert.deepEqual(snapshot.workbench, Workbench.empty(f.w));
});

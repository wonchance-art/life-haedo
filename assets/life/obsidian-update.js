/* Explicit Obsidian snapshot updates: immutable originals, no deletion or inferred moves. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./core.js') : root.HaedoLife.Core,
    typeof module === 'object' && module.exports ? require('./obsidian-package.js') : root.HaedoLife.ObsidianPackage);
  (root.HaedoLife ||= {}).ObsidianUpdate = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (Core, Package) {
  'use strict';
  const contexts = new WeakMap(), documents = new WeakMap(), clone = value => structuredClone(value);
  const fail = message => { throw Object.assign(new Error(message), { code: 'invalid_obsidian_update' }); };
  const fingerprint = v => JSON.stringify([v.format, v.contentText, v.contentHash, v.coverage.status, v.coverage.omissions, v.originalAuthor ?? null, v.originalCreatedAt ?? null]);
  const repoPattern = /^https:\/\/github\.com\/[^/?#]+\/[^/?#]+$/;
  function path(source) {
    const p = source.sourceKey;
    if (typeof p !== 'string' || !p || p.startsWith('/') || /[\\\u0000-\u001f]/.test(p) || p.split('/').some(x => !x || x === '.' || x === '..')) fail('Obsidian 원문 경로를 확인해 주세요.');
    return p;
  }
  function inspect(bundle, repositoryUrl) {
    Core.validateWorkspace(bundle);
    const entries = [], byVersion = new Map(), byPath = new Map(), versionsBySource = new Map();
    for (const version of bundle.sourceVersions) { if (!versionsBySource.has(version.sourceId)) versionsBySource.set(version.sourceId, []); versionsBySource.get(version.sourceId).push(version); }
    for (const source of bundle.sources.filter(s => s.origin === 'obsidian')) {
      const key = path(source), prefix = repositoryUrl + '/blob/';
      if (!source.url?.startsWith(prefix) || !new RegExp('^[a-f0-9]{40}/').test(source.url.slice(prefix.length)) ||
        source.url.slice(prefix.length + 41) !== key.split('/').map(encodeURIComponent).join('/')) fail('같은 저장소의 정확한 커밋·경로를 가진 원문만 비교할 수 있습니다.');
      const versions = versionsBySource.get(source.id) || [];
      if (versions.length !== 1) fail('원문마다 한 개의 정확 버전을 가진 Obsidian 사본을 사용해 주세요. 기존 자료는 변경하지 않았습니다.');
      const entry = { source, version: versions[0], path: key }; entries.push(entry); byVersion.set(entry.version.id, entry);
      if (!byPath.has(key)) byPath.set(key, []); byPath.get(key).push(entry);
    }
    // Only explicit update edges designate a newer original. Hash/name similarities do not.
    const superseded = new Set();
    for (const link of bundle.links.filter(l => l.kind === 'obsidian_update' && Array.isArray(l.sourceRefs) && l.sourceRefs.length === 2)) {
      const [oldRef, newRef] = link.sourceRefs, oldEntry = byVersion.get(oldRef.sourceVersionId), newEntry = byVersion.get(newRef.sourceVersionId);
      if (oldEntry && newEntry && oldEntry.path === newEntry.path && oldEntry.source.id !== newEntry.source.id) superseded.add(oldEntry.version.id);
    }
    const current = new Map();
    for (const [key, all] of byPath) {
      const tips = all.filter(e => !superseded.has(e.version.id));
      if (tips.length !== 1) fail('같은 경로의 원문 후보가 여러 개입니다. 이전 사본의 연결을 먼저 확인해 주세요.');
      current.set(key, tips[0]);
    }
    return { entries, current, byVersion };
  }
  async function documentFrom(value) {
    const owned = clone(value);
    if (!repoPattern.test(owned.repositoryUrl || '')) fail('Obsidian 저장소 주소를 확인해 주세요.');
    for (const key of ['notes', 'files']) if (owned[key]) {
      // Hash verification owns its input before yielding. Keep graph IDs for exact old references.
      await Core.restoreBackup(Core.makeBackup(owned[key])); inspect(owned[key], owned.repositoryUrl);
    }
    if (!owned.notes && !owned.files) fail('원문 자료가 담긴 파일을 선택해 주세요.');
    const handle = Object.freeze({ repositoryUrl: owned.repositoryUrl, ref: owned.ref || null,
      counts: Object.freeze(Object.fromEntries(['notes', 'files'].filter(k => owned[k]).map(k => [k, owned[k].sources.length]))) });
    documents.set(handle, owned); return handle;
  }
  async function read(file, { next = false } = {}) {
    if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > Package.LIMIT) fail('256MiB 이하의 Obsidian 패키지 또는 갱신 사본 JSON을 선택해 주세요.');
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (head[0] === 0x50 && head[1] === 0x4b) return documentFrom(await Package.read(file));
    if (next) fail('새 자료에는 원문·해시·경로를 검증하는 Obsidian 변환 ZIP을 선택해 주세요.');
    if (file.size > Package.FILE_LIMIT) fail('JSON 사본은 64MiB 이하로 나누어 주세요.');
    let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())); } catch (_) { fail('JSON 사본을 읽지 못했습니다. 원본은 유지됩니다.'); }
    if (value.format === 'life-obsidian-update-v1') {
      if (!value.backups || typeof value.backups !== 'object') fail('갱신 사본의 자료를 확인해 주세요.');
      const restored = {};
      for (const key of ['notes', 'files']) if (value.backups[key]) restored[key] = await Core.restoreBackup(value.backups[key]);
      return documentFrom({ ...restored, repositoryUrl: value.repositoryUrl, ref: value.ref });
    }
    if (value.format === 'life-tools-backup-v1') {
      const notes = await Core.restoreBackup(value), source = notes.sources.find(s => s.origin === 'obsidian');
      const repositoryUrl = source?.url?.split('/blob/')[0];
      return documentFrom({ notes, repositoryUrl });
    }
    fail('검증된 Obsidian ZIP, 갱신 사본 JSON 또는 자료 JSON을 선택해 주세요.');
  }
  function compare(previousHandle, incomingHandle) {
    const before = documents.get(previousHandle), after = documents.get(incomingHandle);
    if (!before || !after || before.repositoryUrl !== after.repositoryUrl) fail('같은 저장소의 이전·새 자료를 선택해 주세요.');
    const rows = [], indexes = {};
    for (const key of ['notes', 'files']) {
      const oldIndex = before[key] ? inspect(before[key], before.repositoryUrl) : { current: new Map() };
      const newIndex = after[key] ? inspect(after[key], after.repositoryUrl) : { current: new Map() };
      indexes[key] = { oldIndex, newIndex };
      const missingByFingerprint = new Map();
      for (const [oldPath, entry] of oldIndex.current) if (!newIndex.current.has(oldPath)) { const hash = fingerprint(entry.version); if (!missingByFingerprint.has(hash)) missingByFingerprint.set(hash, []); missingByFingerprint.get(hash).push(oldPath); }
      for (const [p, next] of newIndex.current) {
        const old = oldIndex.current.get(p), kind = !old ? 'added' : fingerprint(old.version) === fingerprint(next.version) ? 'unchanged' : 'changed';
        const possibleMoves = kind === 'added' ? (missingByFingerprint.get(fingerprint(next.version)) || []) : [];
        rows.push(Object.freeze({ id: String(rows.length), workspace: key, path: p, kind, possibleMoves: Object.freeze(possibleMoves), beforeHash: old?.version.contentHash || null, afterHash: next.version.contentHash }));
      }
      for (const [p, old] of oldIndex.current) if (!newIndex.current.has(p)) rows.push(Object.freeze({ id: String(rows.length), workspace: key, path: p, kind: 'missing', possibleMoves: Object.freeze([]), beforeHash: old.version.contentHash, afterHash: null }));
    }
    const handle = Object.freeze({ rows: Object.freeze(rows), repositoryUrl: before.repositoryUrl, previousRef: before.ref, nextRef: after.ref });
    contexts.set(handle, { before, after, indexes }); return handle;
  }
  function reviewRow(handle, rowId) {
    const context = contexts.get(handle), row = handle?.rows.find(r => r.id === rowId);
    if (!context || !row) fail('비교할 항목을 다시 선택해 주세요.');
    const { oldIndex, newIndex } = context.indexes[row.workspace];
    const detail = entry => entry ? { source: clone(entry.source), version: clone(entry.version) } : null;
    return { before: detail(oldIndex.current.get(row.path)), after: detail(newIndex.current.get(row.path)) };
  }
  async function createCopy(handle, selected) {
    const context = contexts.get(handle);
    if (!context || !Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length) fail('추가·수정 항목을 하나 이상 선택해 주세요.');
    const chosen = selected.map(id => handle.rows.find(r => r.id === id));
    if (chosen.some(r => !r || !['added', 'changed'].includes(r.kind))) fail('추가·수정 항목만 선택할 수 있습니다.');
    const { before, after, indexes } = context, backups = {}, copies = []; let added = 0, changed = 0, links = 0, pendingLinks = 0;
    for (const key of ['notes', 'files']) {
      if (!before[key] && !chosen.some(r => r.workspace === key)) continue;
      const base = clone(before[key] || Core.createWorkspace({ title: after[key].title })), now = new Date().toISOString();
      const mapping = new Map(), selectedVersions = new Set(), { oldIndex, newIndex } = indexes[key];
      for (const row of chosen.filter(r => r.workspace === key)) {
        const incoming = newIndex.current.get(row.path), old = oldIndex.current.get(row.path), source = { ...clone(incoming.source), id: Core.id(), revision: 1 }, version = { ...clone(incoming.version), id: Core.id(), revision: 1 };
        version.sourceId = source.id; base.sources.push(source); base.sourceVersions.push(version);
        mapping.set(incoming.version.id, { sourceId: source.id, sourceVersionId: version.id }); selectedVersions.add(incoming.version.id);
        if (old) { base.links.push({ id: Core.id(), kind: 'obsidian_update', note: row.path, sourceRefs: [{ sourceId: old.source.id, sourceVersionId: old.version.id, locator: null }, { sourceId: source.id, sourceVersionId: version.id, locator: null }], entityRefs: [], revision: 1, createdAt: now, updatedAt: now }); changed++; }
        else added++;
      }
      for (const [p, incoming] of newIndex.current) if (!mapping.has(incoming.version.id)) {
        const old = oldIndex.current.get(p);
        if (old && fingerprint(old.version) === fingerprint(incoming.version)) mapping.set(incoming.version.id, { sourceId: old.source.id, sourceVersionId: old.version.id });
      }
      for (const link of (after[key]?.links || []).filter(l => l.kind === 'obsidian_link' && selectedVersions.has(l.sourceRefs[0]?.sourceVersionId))) {
        if (link.entityRefs?.length || link.sourceRefs.some(ref => !mapping.has(ref.sourceVersionId))) { pendingLinks++; continue; }
        const mapped = clone(link); mapped.id = Core.id(); mapped.revision = 1;
        mapped.sourceRefs = mapped.sourceRefs.map(ref => ({ ...ref, ...mapping.get(ref.sourceVersionId) })); base.links.push(mapped); links++;
      }
      base.title = base.title + ' · 갱신 사본'; Core.validateWorkspace(base);
      // Restore gives the complete old+new graph fresh IDs and verifies all original text hashes.
      const copy = await Core.restoreBackup(Core.makeBackup(base)); copies.push(copy); backups[key] = Core.makeBackup(copy);
    }
    return { document: { format: 'life-obsidian-update-v1', repositoryUrl: before.repositoryUrl, ref: after.ref, backups }, copies,
      summary: { added, changed, links, pendingLinks, workspaces: copies.length, preservedMissing: handle.rows.filter(r => r.kind === 'missing').length } };
  }
  function createService({ storage, isCurrent = () => true } = {}) {
    if (!storage?.isAccountScoped || !storage.account || typeof storage.installWorkspaces !== 'function') fail('로그인한 계정의 저장소에서 갱신 사본을 복원해 주세요.');
    const account = JSON.stringify(storage.account); let disposed = false, candidate = null, installed = null, installing = false, generation = 0, preparing = false;
    const guard = () => { if (disposed || !isCurrent() || JSON.stringify(storage.account) !== account) fail('계정이 바뀌었습니다. 자료는 변경하지 않았습니다.'); };
    return Object.freeze({
      async prepare(handle, selected) { guard(); if (preparing || installing) fail('파일 처리 중입니다.'); const token = generation; preparing = true; try { const value = await createCopy(handle, selected); guard(); if (token !== generation) fail('파일 선택이 바뀌었습니다. 다시 비교해 주세요.'); candidate = value; installed = null; return clone(value); } finally { preparing = false; } },
      async install() { guard(); if (!candidate) fail('새 사본을 먼저 준비해 주세요.'); if (installed) return clone(installed); if (installing) fail('사본 복원이 진행 중입니다.');
        installing = true; try { const value = await storage.installWorkspaces(clone(candidate.copies)); installed = clone(value); guard(); return clone(installed); } finally { installing = false; } },
      cancel() { generation++; candidate = null; installed = null; },
      dispose() { disposed = true; generation++; candidate = null; installed = null; }
    });
  }
  return Object.freeze({ read, compare, reviewRow, createCopy, createService });
});

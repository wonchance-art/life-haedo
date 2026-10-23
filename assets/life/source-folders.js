/* Local source-level folders. Originals and exact source-version references
 * are never rewritten; portable copies delegate their validation to Workbench. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  (root.HaedoLife ||= {}).SourceFolders = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const FORMAT = 'life-source-folders-v1', BACKUP_FORMAT = 'life-material-library-backup-v1';
  const MAX_BYTES = 2 * 1024 * 1024;
  const LIMITS = Object.freeze({ folders: 200, depth: 5, name: 120, assignments: 20000, bulk: 200, bytes: MAX_BYTES });
  const clone = value => structuredClone(value);
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
  function fail(condition, code = 'source_folders_invalid') {
    if (condition) return;
    const messages = {
      source_folders_invalid: '폴더 이름과 구조, 선택한 대상을 확인해 주세요.',
      source_folders_too_large: '폴더 보관 한도를 넘었습니다. 기존 분류는 유지했습니다.',
      source_folders_missing_reference: '분류할 자료를 찾을 수 없습니다. 최신 자료 목록을 확인해 주세요.',
      source_folders_not_empty: '하위 폴더를 먼저 옮긴 다음 이 폴더를 삭제해 주세요.',
      workspace_mismatch: '자료와 폴더의 작업공간이 다릅니다.',
      invalid_backup: '자료실 백업의 항목과 형식을 확인해 주세요.',
      unsupported_backup: '지원하는 자료실 통합 백업을 선택해 주세요.',
      id_collision: '새 폴더 식별자를 만들지 못했습니다. 다시 시도해 주세요.',
      dependency_unavailable: '자료실 모듈을 불러오지 못했습니다.'
    };
    throw Object.assign(new Error(messages[code] || messages.source_folders_invalid), { code });
  }
  function fields(value, keys, code = 'source_folders_invalid') {
    fail(value !== null && typeof value === 'object' && !Array.isArray(value) &&
      [null, Object.prototype].includes(Object.getPrototypeOf(value)), code);
    const own = Reflect.ownKeys(value);
    fail(own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key) &&
      Object.getOwnPropertyDescriptor(value, key)?.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')), code);
  }
  function array(value, max) {
    fail(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype);
    fail(value.length <= max, 'source_folders_too_large');
    fail(Reflect.ownKeys(value).length === value.length + 1 && Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
    }).every(Boolean));
  }
  function identifier(value) { fail(typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)); }
  function name(value) {
    fail(typeof value === 'string' && value.length > 0 && value.length <= LIMITS.name && value === value.trim());
    fail(!/[\u0000-\u001f\u007f-\u009f/\\]/u.test(value));
    for (let index = 0; index < value.length; index++) {
      const unit = value.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(++index);
        fail(next >= 0xdc00 && next <= 0xdfff);
      } else fail(unit < 0xdc00 || unit > 0xdfff);
    }
    return value;
  }
  function savedName(value) {
    fail(typeof value === 'string' && !/[\u0000-\u001f\u007f-\u009f/\\]/u.test(value));
    return name(value.trim());
  }
  const nameKey = value => value.normalize('NFC').toLowerCase();
  function core() {
    const api = root.HaedoLife?.Core || (typeof require === 'function' && require('./core.js'));
    fail(api?.id && api?.validateWorkspace, 'dependency_unavailable'); return api;
  }
  function workbench() {
    const api = root.HaedoLife?.Workbench || (typeof require === 'function' && require('./workbench.js'));
    fail(api?.makeBackup && api?.restoreBackup, 'dependency_unavailable'); return api;
  }
  function graph(state) {
    const map = new Map(state.folders.map(folder => [folder.id, folder]));
    const depths = new Map();
    for (const folder of state.folders) {
      let current = folder, depth = 0;
      const seen = new Set();
      while (current) {
        fail(!seen.has(current.id)); seen.add(current.id);
        fail(++depth <= LIMITS.depth);
        if (current.parentId === null) break;
        fail(map.has(current.parentId)); current = map.get(current.parentId);
      }
      depths.set(folder.id, depth);
    }
    return { map, depths };
  }
  function validate(state) {
    fields(state, ['format', 'workspaceId', 'revision', 'folders', 'assignments']);
    fail(state.format === FORMAT); identifier(state.workspaceId);
    fail(Number.isSafeInteger(state.revision) && state.revision >= 0);
    array(state.folders, LIMITS.folders); array(state.assignments, LIMITS.assignments);
    const ids = new Set(), siblings = new Map();
    for (const folder of state.folders) {
      fields(folder, ['id', 'name', 'parentId']); identifier(folder.id);
      // These values belong to the filter API, never to a selectable folder.
      fail(!['all', 'unfiled'].includes(folder.id) && !ids.has(folder.id)); ids.add(folder.id);
      name(folder.name); if (folder.parentId !== null) identifier(folder.parentId);
      const names = siblings.get(folder.parentId) || new Set(), key = nameKey(folder.name);
      fail(!names.has(key)); names.add(key); siblings.set(folder.parentId, names);
    }
    graph(state);
    const sources = new Set();
    for (const assignment of state.assignments) {
      fields(assignment, ['sourceId', 'folderId']); identifier(assignment.sourceId); identifier(assignment.folderId);
      fail(!sources.has(assignment.sourceId) && ids.has(assignment.folderId)); sources.add(assignment.sourceId);
    }
    fail(bytes(state) <= MAX_BYTES, 'source_folders_too_large');
    // Short legacy-compatible IDs become UUIDs in a fresh restored copy.
    // Budget that representation too, without changing any saved identifier.
    const uuid = '00000000-0000-4000-8000-000000000000';
    const restoredBudget = { format: FORMAT, workspaceId: uuid, revision: 0,
      folders: state.folders.map(folder => ({ id: uuid, name: folder.name, parentId: folder.parentId === null ? null : uuid })),
      assignments: state.assignments.map(() => ({ sourceId: uuid, folderId: uuid })) };
    fail(bytes(restoredBudget) <= MAX_BYTES, 'source_folders_too_large');
    return state;
  }
  function empty(workspaceId) { return validate({ format: FORMAT, workspaceId, revision: 0, folders: [], assignments: [] }); }
  function validateReferences(bundle, state) {
    core().validateWorkspace(bundle); validate(state);
    fail(bundle.workspaceId === state.workspaceId, 'workspace_mismatch');
    const sources = new Set(bundle.sources.map(source => source.id));
    fail(state.assignments.every(assignment => sources.has(assignment.sourceId)), 'source_folders_missing_reference');
    return state;
  }
  function folder(state, id) {
    identifier(id); const selected = state.folders.find(item => item.id === id); fail(!!selected); return selected;
  }
  function freshId(used) {
    for (let attempt = 0; attempt < 1024; attempt++) {
      const id = core().id(); identifier(id);
      if (!used.has(id) && !['all', 'unfiled'].includes(id)) { used.add(id); return id; }
    }
    fail(false, 'id_collision');
  }
  function createFolder(state, input) {
    validate(state); fields(input, ['name', 'parentId']);
    if (input.parentId !== null) folder(state, input.parentId);
    const copy = clone(state), used = new Set([state.workspaceId, ...state.folders.map(item => item.id), ...state.assignments.map(item => item.sourceId)]);
    copy.folders.push({ id: freshId(used), name: savedName(input.name), parentId: input.parentId });
    return validate(copy);
  }
  function updateFolder(state, id, input) {
    validate(state); folder(state, id); fields(input, ['name', 'parentId']);
    if (input.parentId !== null) folder(state, input.parentId);
    const copy = clone(state), selected = folder(copy, id);
    selected.name = savedName(input.name); selected.parentId = input.parentId;
    return validate(copy);
  }
  function removeFolder(state, id) {
    validate(state); folder(state, id);
    fail(!state.folders.some(item => item.parentId === id), 'source_folders_not_empty');
    const copy = clone(state);
    copy.folders = copy.folders.filter(item => item.id !== id);
    copy.assignments = copy.assignments.filter(item => item.folderId !== id);
    return validate(copy);
  }
  function assignSources(state, sourceIds, folderId) {
    validate(state); array(sourceIds, LIMITS.bulk);
    const selected = new Set();
    for (const id of sourceIds) { identifier(id); fail(!selected.has(id)); selected.add(id); }
    if (folderId !== null) folder(state, folderId);
    const copy = clone(state);
    copy.assignments = copy.assignments.filter(item => !selected.has(item.sourceId));
    if (folderId !== null) for (const sourceId of sourceIds) copy.assignments.push({ sourceId, folderId });
    return validate(copy);
  }
  function folderFor(state, sourceId) {
    validate(state); identifier(sourceId);
    return state.assignments.find(item => item.sourceId === sourceId)?.folderId || null;
  }
  function compileMatcher(state, filter) {
    validate(state);
    if (filter !== 'all' && filter !== 'unfiled') folder(state, filter);
    if (filter === 'all') return sourceId => { identifier(sourceId); return true; };
    if (filter === 'unfiled') {
      const assigned = new Set(state.assignments.map(item => item.sourceId));
      return sourceId => { identifier(sourceId); return !assigned.has(sourceId); };
    }
    const { map } = graph(state);
    const included = new Set();
    for (const selected of state.folders) {
      let current = selected.id;
      for (let depth = 0; current !== null && depth < LIMITS.depth; depth++) {
        if (current === filter) { included.add(selected.id); break; }
        current = map.get(current).parentId;
      }
    }
    const sources = new Set(state.assignments.filter(item => included.has(item.folderId)).map(item => item.sourceId));
    // The predicate owns only sets of primitive IDs; later mutations to the
    // profile, its arrays or parent links cannot change an in-flight render.
    return sourceId => { identifier(sourceId); return sources.has(sourceId); };
  }
  function matches(state, sourceId, filter) { return compileMatcher(state, filter)(sourceId); }
  function list(state) {
    validate(state);
    const children = new Map(), result = [];
    for (const folder of state.folders) {
      const siblings = children.get(folder.parentId) || []; siblings.push(folder); children.set(folder.parentId, siblings);
    }
    function visit(parentId, ancestors) {
      for (const folder of children.get(parentId) || []) {
        const names = ancestors.concat(folder.name);
        result.push({ ...folder, depth: names.length, label: names.join(' / ') });
        visit(folder.id, names);
      }
    }
    visit(null, []); return result;
  }
  function makeBackup(bundle, state, folders) {
    validateReferences(bundle, folders);
    return { format: BACKUP_FORMAT, schemaVersion: 1, exportedAt: new Date().toISOString(),
      sourceFolders: clone(folders), libraryBackup: workbench().makeBackup(bundle, state) };
  }
  async function restoreBackup(input) {
    let data = input;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (_) { fail(false, 'invalid_backup'); }
    }
    // Validate our own schema before cloning: cloning must not erase an unknown
    // symbol/prototype or invoke an accessor and turn it into accepted JSON.
    const format = data && Object.getOwnPropertyDescriptor(data, 'format');
    fail(format && Object.hasOwn(format, 'value'), 'invalid_backup');
    const legacy = format.value === 'life-workbench-backup-v1';
    if (!legacy) {
      fields(data, ['format', 'schemaVersion', 'exportedAt', 'sourceFolders', 'libraryBackup'], 'invalid_backup');
      fail(data.format === BACKUP_FORMAT && data.schemaVersion === 1, 'unsupported_backup');
      fail(typeof data.exportedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(data.exportedAt) &&
        Number.isFinite(Date.parse(data.exportedAt)), 'invalid_backup');
      validateReferences(data.libraryBackup?.sourceBackup?.workspace, data.sourceFolders);
    }
    // Own every input half before delegation reaches asynchronous source hashing.
    let snapshot;
    try { snapshot = clone(data); } catch (_) { fail(false, 'invalid_backup'); }
    if (legacy) {
      const restored = await workbench().restoreBackup(snapshot);
      return { ...restored, sourceFolders: empty(restored.bundle.workspaceId) };
    }
    const original = snapshot.libraryBackup?.sourceBackup?.workspace;
    const restored = await workbench().restoreBackup(snapshot.libraryBackup);
    const sourceIds = new Map(original.sources.map((source, index) => [source.id, restored.bundle.sources[index].id]));
    const used = new Set();
    for (const value of [original, restored.bundle]) {
      used.add(value.workspaceId);
      for (const collection of ['sources', 'sourceVersions', 'records', 'links', 'resumeHints', 'tombstones'])
        for (const item of value[collection]) { used.add(item.id); if (item.entityId) used.add(item.entityId); }
    }
    // Workbench owns its own richer reference schema; include all its string
    // values solely to avoid accidental identifier reuse, never to infer links.
    function reserve(value) {
      if (typeof value === 'string') used.add(value);
      else if (Array.isArray(value)) for (const item of value) reserve(item);
      else if (value && typeof value === 'object') for (const item of Object.values(value)) reserve(item);
    }
    reserve(snapshot.sourceFolders); reserve(snapshot.libraryBackup.workbench); reserve(restored.workbench);
    const folderIds = new Map(snapshot.sourceFolders.folders.map(item => [item.id, freshId(used)]));
    const sourceFolders = { format: FORMAT, workspaceId: restored.bundle.workspaceId, revision: 0,
      folders: snapshot.sourceFolders.folders.map(item => ({ id: folderIds.get(item.id), name: item.name,
        parentId: item.parentId === null ? null : folderIds.get(item.parentId) })),
      assignments: snapshot.sourceFolders.assignments.map(item => ({ sourceId: sourceIds.get(item.sourceId), folderId: folderIds.get(item.folderId) })) };
    validateReferences(restored.bundle, sourceFolders);
    return { ...restored, sourceFolders };
  }
  return Object.freeze({ FORMAT, BACKUP_FORMAT, LIMITS, MAX_BYTES, empty, validate, validateReferences,
    createFolder, updateFolder, removeFolder, assignSources, folderFor, matches, compileMatcher, list, makeBackup, restoreBackup });
});

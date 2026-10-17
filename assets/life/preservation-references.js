/* Explicit private preservation closure. Reuses the existing source, post and nine-board validators. */
(function (root, factory) {
  const api = factory(root);
  (root.HaedoLife ||= {}).PreservationReferences = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const LIMITS = Object.freeze({ posts: 20, photos: 200, json: 16 * 1024 * 1024, bytes: 256 * 1024 * 1024 });
  const C = () => root.HaedoLife?.Core || require('./core.js');
  const P = () => root.HaedoLife?.PhotoPost || require('./photo-post.js');
  const R = () => root.HaedoLife?.SourceReference || require('./source-reference.js');
  const N = () => root.HaedoLife?.NineBoard || require('./nine-board.js');
  const clone = value => structuredClone(value);
  const fail = message => { throw Object.assign(new Error(message), { code: 'invalid_preservation_references' }); };
  const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  function fields(value, keys) {
    if (!plain(value) || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('글·근거 보존 파일의 형식을 확인해 주세요.');
  }
  function identifier(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail('보존할 자료의 식별자를 확인해 주세요.');
    return value;
  }
  function identifiers(values, max) {
    if (!Array.isArray(values) || values.length > max) fail('선택한 글과 구성의 개수를 확인해 주세요.');
    const result = new Set();
    for (const value of values) { identifier(value); if (result.has(value)) fail('같은 항목을 중복 선택하지 않았는지 확인해 주세요.'); result.add(value); }
    return result;
  }
  const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const serializable = value => ({ ...value, posts: value.posts.map(row => ({ ...row, doc: { ...row.doc, photos: row.doc.photos.map(({ blob, ...metadata }) => metadata) } })) });
  function limits(value) {
    const photos = value.posts.flatMap(row => row.doc.photos);
    const size = new TextEncoder().encode(JSON.stringify(serializable(value))).length;
    if (value.posts.length > LIMITS.posts || photos.length > LIMITS.photos || size > LIMITS.json || size + photos.reduce((total, photo) => total + photo.size, 0) > LIMITS.bytes) {
      fail('글·근거 보존은 글 20개, 사진 200개, 설명 16 MiB, 전체 256 MiB까지 가능합니다.');
    }
  }
  function input(value) {
    fields(value, ['bundle', 'posts', 'nineBoard']);
    C().validateWorkspace(value.bundle); N().validate(value.nineBoard);
    if (value.bundle.workspaceId !== value.nineBoard.workspaceId || !Array.isArray(value.posts)) fail('같은 작업공간의 글과 구성을 선택해 주세요.');
    const rows = new Map();
    for (const row of value.posts) {
      fields(row, ['doc', 'evidence']); identifier(row.doc?.id);
      if (rows.has(row.doc.id)) fail('중복된 글이 포함되어 있습니다.');
      rows.set(row.doc.id, row);
    }
    return rows;
  }
  function evidence(row, workspaceId) {
    P().validate(row.doc); fields(row.evidence, ['revision', 'refs']);
    if (row.doc.status !== 'saved' || row.doc.revision < 1) fail('저장한 글을 선택해 주세요. 작성 중인 초안은 포함하지 않았습니다.');
    if (!Number.isSafeInteger(row.evidence.revision) || row.evidence.revision < 0 || !Array.isArray(row.evidence.refs) || row.evidence.refs.length > 64) fail('글의 원문 근거 형식을 확인해 주세요.');
    for (const ref of row.evidence.refs) {
      R().validate(ref);
      if (typeof ref.url !== 'string') fail('원문 출처 주소의 형식을 확인해 주세요.');
      if (ref.workspaceId !== workspaceId) fail('다른 작업공간의 원문 근거를 함께 보관하지 않았습니다.');
    }
  }
  async function project(value, selection, title, selectedDates = false) {
    const pool = input(value), workspaceId = value.bundle.workspaceId;
    fields(selection, ['postIds', 'boardIds']);
    const postIds = identifiers(selection.postIds, LIMITS.posts), boardIds = identifiers(selection.boardIds, N().LIMITS.boards);
    if (!postIds.size && !boardIds.size) fail('보존할 글 또는 9칸 구성을 선택해 주세요.');
    const boards = value.nineBoard.boards.filter(board => boardIds.has(board.id));
    if (boards.length !== boardIds.size) fail('선택한 9칸 구성을 찾을 수 없습니다.');
    const sourceRefs = [], postRefs = [];
    for (const board of boards) for (const area of board.areas) for (const item of area.items) if (item.reference) {
      const ref = item.reference.value;
      if (ref.workspaceId !== workspaceId) fail('다른 작업공간의 9칸 근거입니다. 원문이 있는 공간에서 보존해 주세요.');
      if (item.reference.kind === 'source') sourceRefs.push(ref);
      else { postIds.add(ref.postId); postRefs.push(ref); }
    }
    const posts = value.posts.filter(row => postIds.has(row.doc.id));
    if (posts.length !== postIds.size) fail('9칸이 참조하거나 선택한 정확한 저장 글을 찾을 수 없습니다.');
    for (const row of posts) { evidence(row, workspaceId); sourceRefs.push(...row.evidence.refs); }
    for (const ref of postRefs) await R().resolvePost({ workspaceId, post: pool.get(ref.postId).doc }, ref);
    const sources = new Set(), versions = new Set();
    for (const ref of sourceRefs) { R().validate(ref); if (typeof ref.url !== 'string') fail('원문 출처 주소의 형식을 확인해 주세요.'); sources.add(ref.sourceId); versions.add(ref.sourceVersionId); }
    const bundle = { ...value.bundle, title, revision: 0,
      sources: value.bundle.sources.filter(source => sources.has(source.id)),
      sourceVersions: value.bundle.sourceVersions.filter(version => versions.has(version.id)),
      records: [], links: [], resumeHints: [], tombstones: [] };
    if (selectedDates) {
      // Unrelated workspace edits must not enter the selected file or invalidate its review fingerprint.
      const dates = [...bundle.sources.flatMap(source => [source.createdAt, source.updatedAt]),
        ...bundle.sourceVersions.map(version => version.importedAt), ...posts.flatMap(row => [row.doc.createdAt, row.doc.updatedAt])].sort();
      bundle.createdAt = dates[0] || '1970-01-01T00:00:00.000Z';
      bundle.updatedAt = dates.at(-1) || bundle.createdAt;
    }
    C().validateWorkspace(bundle);
    // Reuse exact UTF-16, source-version, SHA-256 and snapshot checks. Repeated refs need one verification.
    const checked = new Set();
    for (const ref of sourceRefs) {
      const key = JSON.stringify(canonical(ref));
      if (!checked.has(key)) { await R().resolve(bundle, ref); checked.add(key); }
    }
    const result = { bundle, posts, nineBoard: { ...value.nineBoard, revision: 0, boards } };
    limits(result);
    return result;
  }
  async function select(snapshot, selection) {
    // Own all fields before hashing yields; a caller cannot replace an input while it is being checked.
    const owned = clone(snapshot), chosen = clone(selection);
    return project(owned, chosen, '선택한 원문', true);
  }
  async function validate(payload) {
    const owned = clone(payload); input(owned);
    const projected = await project(owned, { postIds: owned.posts.map(row => row.doc.id), boardIds: owned.nineBoard.boards.map(board => board.id) }, owned.bundle.title);
    if (JSON.stringify(canonical(serializable(owned))) !== JSON.stringify(canonical(serializable(projected)))) fail('선택한 근거에 필요하지 않은 자료가 포함되어 있습니다.');
    return projected;
  }
  async function copy(payload, options = {}) {
    const settings = { ...options }; if (Object.keys(settings).some(key => !['fresh', 'title'].includes(key))) fail('복원 설정을 확인해 주세요.');
    const owned = await validate(payload), fresh = settings.fresh || C().id;
    if (typeof fresh !== 'function') fail('새 사본의 식별자를 만들 수 없습니다.');
    const occupied = new Set([owned.bundle.workspaceId]);
    for (const source of owned.bundle.sources) occupied.add(source.id);
    for (const version of owned.bundle.sourceVersions) occupied.add(version.id);
    for (const row of owned.posts) { occupied.add(row.doc.id); for (const photo of row.doc.photos) occupied.add(photo.id); }
    for (const board of owned.nineBoard.boards) { occupied.add(board.id); for (const area of board.areas) occupied.add(area.id); }
    const nextId = () => { const id = identifier(fresh()); if (occupied.has(id)) fail('새 사본의 식별자가 중복되었습니다.'); occupied.add(id); return id; };
    const workspaceId = nextId(), sourceIds = Object.create(null), versionIds = Object.create(null), postIds = new Map();
    const bundle = C().createWorkspace({ workspaceId, title: settings.title === undefined ? '복원한 글·근거' : settings.title });
    bundle.sources = owned.bundle.sources.map(source => ({ ...source, id: (sourceIds[source.id] = nextId()), revision: 1 }));
    bundle.sourceVersions = owned.bundle.sourceVersions.map(version => ({ ...version, id: (versionIds[version.id] = nextId()), sourceId: sourceIds[version.sourceId], revision: 1 }));
    const remap = ref => R().remap(ref, { workspaceId, sourceIds, versionIds });
    const posts = owned.posts.map(row => {
      const doc = clone(row.doc), oldId = doc.id, photos = new Map();
      doc.id = nextId(); postIds.set(oldId, doc.id); doc.revision = 1; doc.replaces = null;
      doc.photos = doc.photos.map(photo => { const id = nextId(); photos.set(photo.id, id); return { ...photo, id }; });
      doc.ops = doc.ops.map(op => typeof op.insert === 'string' ? op : { ...op, insert: { photo: { ...op.insert.photo, id: photos.get(op.insert.photo.id) } } });
      return { doc, evidence: { revision: 1, refs: row.evidence.refs.map(remap) } };
    });
    const boards = N().copies(owned.nineBoard.boards, nextId);
    for (const board of boards) for (const area of board.areas) for (const item of area.items) if (item.reference) {
      const ref = item.reference;
      if (ref.kind === 'source') ref.value = remap(ref.value);
      else ref.value = { ...ref.value, workspaceId, postId: postIds.get(ref.value.postId), postRevision: 1 };
    }
    return validate({ bundle, posts, nineBoard: { ...owned.nineBoard, workspaceId, revision: 0, boards } });
  }
  return Object.freeze({ LIMITS, select, validate, copy });
});

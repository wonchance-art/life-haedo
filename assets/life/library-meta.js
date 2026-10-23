/* Account library metadata projection. Child identities and exact references are
 * retained; source bodies, drafts and unrelated private profiles are not added. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).LibraryMeta = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const FORMAT = 'life-library-meta-v1', MAX_BYTES = 8 * 1024 * 1024, CHILD_BYTES = 2 * 1024 * 1024;
  const fail = (condition, code = 'invalid_library_meta') => {
    if (!condition) throw Object.assign(new Error(code === 'library_meta_too_large' ? '자료실 분류 정보의 보관 한도를 넘었습니다. 기존 자료는 유지했습니다.' : '자료실 분류 정보와 정확한 참조를 확인해 주세요.'), { code });
  };
  function model(name, file) {
    const value = root.HaedoLife?.[name] || (typeof require === 'function' && require('./' + file + '.js'));
    fail(value?.empty && value?.validate, 'dependency_unavailable'); return value;
  }
  const folders = () => model('SourceFolders', 'source-folders');
  const collection = () => model('Collection', 'collection');
  const nine = () => model('NineBoard', 'nine-board');
  const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
  // Validate before existing child validators/JSON cloning can invoke an
  // accessor, drop a symbol or silently turn a sparse array into nulls.
  function json(value, depth = 0, seen = new Set(), budget = { nodes: 0 }) {
    fail(++budget.nodes <= 250000 && depth <= 24);
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') { fail(Number.isFinite(value)); return; }
    fail(value && typeof value === 'object' && !seen.has(value)); seen.add(value);
    const array = Array.isArray(value);
    fail(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype) || !array && Object.getPrototypeOf(value) === null);
    const keys = Reflect.ownKeys(value);
    if (array) fail(value.length <= 100000 && keys.length === value.length + 1);
    for (const key of keys) {
      if (array && key === 'length') continue;
      fail(typeof key === 'string' && (!array || /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length));
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      fail(descriptor.enumerable && Object.hasOwn(descriptor, 'value'));
      json(descriptor.value, depth + 1, seen, budget);
    }
    seen.delete(value);
  }
  function validate(value) {
    json(value);
    const keys = ['format', 'workspaceId', 'revision', 'sourceFolders', 'collection', 'nineBoard'];
    fail(value && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
    fail(value.format === FORMAT && identifier(value.workspaceId) && Number.isSafeInteger(value.revision) && value.revision >= 0);
    for (const [child, childModel] of [[value.sourceFolders, folders()], [value.collection, collection()], [value.nineBoard, nine()]]) {
      childModel.validate(child); fail(child.workspaceId === value.workspaceId, 'workspace_mismatch');
      fail(bytes(child) <= CHILD_BYTES, 'library_meta_too_large');
    }
    fail(bytes(value) <= MAX_BYTES, 'library_meta_too_large'); return value;
  }
  function empty(workspaceId) {
    return validate({ format: FORMAT, workspaceId, revision: 0, sourceFolders: folders().empty(workspaceId),
      collection: collection().empty(workspaceId), nineBoard: nine().empty(workspaceId) });
  }
  function validateReferences(bundle, value) {
    validate(value);
    const core = root.HaedoLife?.Core || (typeof require === 'function' && require('./core.js'));
    fail(core?.validateWorkspace, 'dependency_unavailable'); core.validateWorkspace(bundle);
    fail(bundle.workspaceId === value.workspaceId, 'workspace_mismatch');
    const sources = new Set(bundle.sources.map(source => source.id));
    const versions = new Map(bundle.sourceVersions.map(version => [version.id, version]));
    for (const board of value.nineBoard.boards) for (const area of board.areas) for (const item of area.items) {
      if (item.reference?.kind !== 'source') continue;
      const ref = item.reference.value;
      // Intentional historical missing/cross-workspace references remain exact
      // references. Never substitute a current version or another saved post.
      if (ref.workspaceId !== bundle.workspaceId || !versions.has(ref.sourceVersionId)) continue;
      const version = versions.get(ref.sourceVersionId);
      fail(sources.has(ref.sourceId) && version.sourceId === ref.sourceId && version.contentHash === ref.contentHash &&
        typeof version.contentText === 'string' && ref.locator.end <= version.contentText.length &&
        version.contentText.slice(ref.locator.start, ref.locator.end) === ref.quote, 'library_meta_reference_mismatch');
    }
    return value;
  }
  return Object.freeze({ FORMAT, MAX_BYTES, empty, validate, validateReferences });
});

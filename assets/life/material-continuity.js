/* One explicitly selected preparation and its exact private source closure. No I/O. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).MaterialContinuity = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const FORMAT = 'life-material-continuity-v1', MAX_BYTES = 16 * 1024 * 1024;
  const dependency = name => root.HaedoLife?.[name] || require({ Core: './core.js', MaterialWriting: './material-writing.js', SourceReference: './source-reference.js' }[name]);
  const clone = value => structuredClone(value);
  const fail = message => { throw Object.assign(new Error(message), { code: 'invalid_material_continuity' }); };
  const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  function fields(value, keys) {
    if (!plain(value) || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('준비 이어쓰기의 형식을 확인해 주세요. 원래 입력은 유지합니다.');
  }
  function identifier(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail('정확한 자료와 준비의 식별자를 확인해 주세요.');
    return value;
  }
  function uuid(value) { if (typeof value !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)) fail('글의 이어쓰기 연결을 확인해 주세요.'); }
  function jsonValue(value, path = new Set(), depth = 0) {
    if (depth > 32) fail('준비 이어쓰기의 중첩 형식을 확인해 주세요.');
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value === 'string') { if (/[\uD800-\uDFFF]/u.test(value)) fail('준비와 원문의 문자 인코딩을 확인해 주세요.'); return; }
    if (!plain(value) && !Array.isArray(value) || path.has(value)) fail('준비 이어쓰기는 순환 참조 없는 자료만 지원합니다.');
    path.add(value);
    if (Array.isArray(value)) {
      if (Reflect.ownKeys(value).length !== value.length + 1) fail('빠지거나 추가된 목록 항목을 확인해 주세요.');
      for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('준비 목록의 형식을 확인해 주세요.');
        jsonValue(descriptor.value, path, depth + 1);
      }
    } else for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('지원하지 않는 숨은 준비 항목입니다.');
      jsonValue(descriptor.value, path, depth + 1);
    }
    path.delete(value);
  }
  function outputRefs(output) {
    if (output === null) return [];
    fields(output, output?.state === 'saved' ? ['state', 'postId', 'claimId', 'revision', 'refs'] : ['state', 'postId', 'claimId']);
    if (!['writing', 'saved'].includes(output.state)) fail('글의 이어쓰기 상태를 확인해 주세요.');
    uuid(output.postId); uuid(output.claimId);
    if (output.state === 'writing') return [];
    if (!Number.isSafeInteger(output.revision) || output.revision < 1 || !Array.isArray(output.refs) || output.refs.length > 64) fail('저장한 글의 정확한 버전과 근거를 확인해 주세요.');
    for (const ref of output.refs) dependency('SourceReference').validate(ref);
    return output.refs;
  }
  function needed(plan, output) {
    const refs = outputRefs(output), versions = new Map();
    function include(sourceId, versionId, contentHash) {
      const prior = versions.get(versionId);
      if (prior && (prior.sourceId !== sourceId || prior.contentHash !== contentHash)) fail('같은 정확한 원문 버전의 해시가 다릅니다. 최신 버전으로 바꾸지 않았습니다.');
      versions.set(versionId, { sourceId, contentHash });
    }
    for (const material of plan.materials) include(material.sourceId, material.sourceVersionId, material.contentHash);
    for (const ref of refs) include(ref.sourceId, ref.sourceVersionId, ref.contentHash);
    return { versions, sources: new Set([...versions.values()].map(value => value.sourceId)), refs };
  }
  function validate(payload) {
    jsonValue(payload);
    fields(payload, ['format', 'bundle', 'plan', 'output']);
    if (payload.format !== FORMAT) fail('지원하지 않는 준비 이어쓰기 형식입니다.');
    const { bundle, plan, output } = payload;
    dependency('Core').validateWorkspace(bundle);
    dependency('MaterialWriting').validate({ ...dependency('MaterialWriting').empty(bundle.workspaceId), plans: [plan] });
    if (plan.output !== null) fail('이 기기의 글 연결은 준비 전송에 넣을 수 없습니다.');
    if (['records', 'links', 'resumeHints', 'tombstones'].some(key => bundle[key].length)) fail('선택한 준비와 관계없는 기록은 전송하지 않습니다.');
    const closure = needed(plan, output);
    if (bundle.sources.length !== closure.sources.size || bundle.sourceVersions.length !== closure.versions.size || bundle.sources.some(source => !closure.sources.has(source.id))) fail('선택한 준비에 필요한 정확한 원문만 포함해 주세요.');
    for (const version of bundle.sourceVersions) {
      const expected = closure.versions.get(version.id);
      if (!expected || version.sourceId !== expected.sourceId || version.contentHash !== expected.contentHash) fail('선택한 정확한 원문 버전과 해시가 일치하지 않습니다.');
    }
    for (const ref of closure.refs) if (ref.workspaceId !== bundle.workspaceId) fail('저장한 글의 근거가 다른 작업공간을 가리킵니다.');
    if (new TextEncoder().encode(JSON.stringify(payload)).length > MAX_BYTES) fail('원문을 포함한 준비 한 개는 UTF-8 기준 16 MiB까지 이어 쓸 수 있습니다.');
    return payload;
  }
  function snapshot(bundle, plan, output = null) {
    dependency('Core').validateWorkspace(bundle);
    dependency('MaterialWriting').validate({ ...dependency('MaterialWriting').empty(bundle.workspaceId), plans: [plan] });
    const selectedPlan = clone(plan), selectedOutput = clone(output); selectedPlan.output = null;
    const closure = needed(selectedPlan, selectedOutput);
    const sources = bundle.sources.filter(source => closure.sources.has(source.id));
    const sourceVersions = bundle.sourceVersions.filter(version => closure.versions.has(version.id));
    const dates = [plan.createdAt, plan.updatedAt, ...sources.flatMap(source => [source.createdAt, source.updatedAt]), ...sourceVersions.map(version => version.importedAt)].sort();
    const selected = { ...bundle, title: '자료 글쓰기 준비의 원문', revision: 0, createdAt: dates[0], updatedAt: dates.at(-1),
      sources, sourceVersions, records: [], links: [], resumeHints: [], tombstones: [] };
    return validate(clone({ format: FORMAT, bundle: selected, plan: selectedPlan, output: selectedOutput }));
  }
  async function hash(text) {
    const crypto = root.crypto?.subtle ? root.crypto : typeof require === 'function' ? require('node:crypto').webcrypto : null;
    if (!crypto?.subtle) fail('안전한 연결에서 원문 해시를 확인한 뒤 다시 시도해 주세요.');
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function verify(payload) {
    // Validate before cloning as well: structuredClone must not invoke input accessors.
    validate(payload); const owned = clone(payload);
    for (const version of owned.bundle.sourceVersions) if (version.contentText !== null && await hash(version.contentText) !== version.contentHash) fail('전송할 정확한 원문 본문과 해시가 다릅니다. 원래 자료는 유지합니다.');
    const refs = [...owned.plan.blocks.filter(block => block.kind === 'quote').map(block => block.reference), ...outputRefs(owned.output)];
    for (const ref of refs) await dependency('SourceReference').resolve(owned.bundle, ref);
    return owned;
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    return plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  }
  async function fingerprint(payload) {
    const owned = await verify(payload);
    // Source collections are sets; outline/material ordering remains meaningful.
    for (const key of ['sources', 'sourceVersions']) owned.bundle[key].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return hash(JSON.stringify(canonical(owned)));
  }
  function remap(payload, workspaceId, idFn = dependency('Core').id) {
    validate(payload); identifier(workspaceId);
    if (typeof idFn !== 'function') fail('받을 준비의 식별자를 만들 수 없습니다.');
    const data = clone(payload), mapping = { workspaceId: { from: data.bundle.workspaceId, to: workspaceId },
      sourceIds: Object.create(null), versionIds: Object.create(null), planIds: Object.create(null), materialIds: Object.create(null), blockIds: Object.create(null) };
    const used = new Set([workspaceId]);
    function next(oldId, map) {
      const value = identifier(idFn(oldId)); if (used.has(value)) fail('받을 준비의 새 식별자가 중복되었습니다.');
      used.add(value); map[oldId] = value; return value;
    }
    data.bundle.workspaceId = workspaceId;
    for (const source of data.bundle.sources) source.id = next(source.id, mapping.sourceIds);
    for (const version of data.bundle.sourceVersions) { version.id = next(version.id, mapping.versionIds); version.sourceId = mapping.sourceIds[version.sourceId]; }
    data.plan.id = next(data.plan.id, mapping.planIds);
    for (const material of data.plan.materials) { material.id = next(material.id, mapping.materialIds); material.sourceId = mapping.sourceIds[material.sourceId]; material.sourceVersionId = mapping.versionIds[material.sourceVersionId]; }
    const reference = ref => dependency('SourceReference').remap(ref, { workspaceId, sourceIds: mapping.sourceIds, versionIds: mapping.versionIds });
    for (const block of data.plan.blocks) { block.id = next(block.id, mapping.blockIds); if (block.kind === 'quote') { block.materialId = mapping.materialIds[block.materialId]; block.reference = reference(block.reference); } }
    if (data.output?.state === 'saved') data.output.refs = data.output.refs.map(reference);
    validate(data); return { data, mapping };
  }
  return Object.freeze({ FORMAT, MAX_BYTES, snapshot, validate, verify, fingerprint, remap });
});

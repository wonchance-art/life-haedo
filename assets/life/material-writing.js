/* Private source comparison and ordered writing preparation. No storage or network. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).MaterialWriting = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const FORMAT = 'life-material-writing-v1';
  const LIMITS = Object.freeze({ plans: 20, materials: 16, blocks: 128, quotes: 64,
    title: 500, question: 50000, note: 50000, text: 50000, json: 2 * 1024 * 1024 });
  const dependency = name => root.HaedoLife?.[name] || require({ Core: './core.js', PhotoPost: './photo-post.js', SourceReference: './source-reference.js', BlogEvidence: './blog-evidence.js' }[name]);
  const clone = value => structuredClone(value);
  const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const fail = message => { throw Object.assign(new Error(message), { code: 'invalid_material_writing' }); };
  function fields(value, keys) {
    if (!plain(value) || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('글쓰기 준비의 형식을 확인해 주세요. 원래 자료와 입력은 유지합니다.');
  }
  function id(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail('준비·자료·문단의 식별자를 확인해 주세요.');
    return value;
  }
  function unique(value, occupied) {
    id(value); if (occupied.has(value)) fail('준비·자료·문단의 식별자가 중복됐습니다.'); occupied.add(value);
  }
  function text(value, max) {
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(value)) fail('입력의 문자와 길이를 확인해 주세요. 내용을 줄이거나 고친 뒤 다시 시도해 주세요.');
  }
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('글쓰기 준비의 날짜를 확인해 주세요.');
  }
  function list(value, max) {
    if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).some(key => key !== 'length' && !(typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length))) fail('준비·자료·문단의 개수와 순서를 확인해 주세요.');
    for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) fail('빠진 항목이 있는 준비는 보관할 수 없습니다.');
  }
  function materialShape(value) {
    fields(value, ['id', 'sourceId', 'sourceVersionId', 'contentHash', 'note']);
    id(value.id); id(value.sourceId); id(value.sourceVersionId); text(value.note, LIMITS.note);
    if (value.contentHash !== null && (typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentHash))) fail('선택한 원문 버전의 해시를 확인해 주세요.');
  }
  const normalized = value => value.replace(/\r\n?/g, '\n');
  function content(plan) {
    const ops = [], refs = []; let hasContent = false;
    for (const block of plan.blocks) {
      if (block.kind === 'quote') {
        const quoted = dependency('BlogEvidence').draft(block.reference);
        // The single-quote composer appends an empty thought field. Outline
        // paragraphs supply their own spacing; preserve every other quote op.
        const last = quoted.ops.at(-1);
        const quoteOps = last?.insert === '\n\n' && Reflect.ownKeys(last).length === 1 ? quoted.ops.slice(0, -1) : quoted.ops;
        ops.push(...quoteOps); refs.push(clone(block.reference)); hasContent ||= !!block.reference.quote.trim();
      } else {
        const value = normalized(block.text); hasContent ||= !!value.trim();
        if (block.kind === 'heading') {
          const lines = value.split('\n'); if (value.endsWith('\n')) lines.pop();
          for (const line of lines) { if (line) ops.push({ insert: line }); ops.push({ insert: '\n', attributes: { header: 2 } }); }
        } else ops.push({ insert: value.endsWith('\n') ? value : value + '\n' });
      }
    }
    if (!ops.length) ops.push({ insert: '\n' });
    return { ops, refs, hasContent };
  }
  function documentFor(plan, makeId) {
    if (typeof makeId !== 'function') fail('새 글의 식별자를 만들 수 없습니다.');
    const projected = content(plan), doc = dependency('PhotoPost').create(makeId, plan.createdAt);
    doc.title = plan.title; doc.updatedAt = plan.updatedAt; doc.ops = projected.ops;
    dependency('PhotoPost').validate(doc);
    return { doc, refs: projected.refs, hasContent: projected.hasContent };
  }
  function validate(state) {
    fields(state, ['format', 'workspaceId', 'revision', 'plans']);
    if (state.format !== FORMAT || !Number.isSafeInteger(state.revision) || state.revision < 0) fail('글쓰기 준비의 형식과 저장 기준을 확인해 주세요.');
    id(state.workspaceId); list(state.plans, LIMITS.plans);
    const occupied = new Set([state.workspaceId]);
    for (const plan of state.plans) {
      fields(plan, ['id', 'title', 'question', 'createdAt', 'updatedAt', 'materials', 'blocks', 'output']);
      unique(plan.id, occupied); text(plan.title, LIMITS.title); text(plan.question, LIMITS.question); date(plan.createdAt); date(plan.updatedAt);
      if (plan.updatedAt < plan.createdAt) fail('수정 시각이 준비를 만든 시각보다 빠릅니다.');
      list(plan.materials, LIMITS.materials); list(plan.blocks, LIMITS.blocks);
      const materials = new Map();
      for (const value of plan.materials) { materialShape(value); unique(value.id, occupied); materials.set(value.id, value); }
      let quotes = 0;
      for (const block of plan.blocks) {
        fields(block, block?.kind === 'quote' ? ['id', 'kind', 'materialId', 'reference'] : ['id', 'kind', 'text']);
        unique(block.id, occupied);
        if (block.kind === 'heading' || block.kind === 'paragraph') text(block.text, LIMITS.text);
        else if (block.kind === 'quote') {
          if (++quotes > LIMITS.quotes) fail('한 준비에는 인용 블록을 64개까지 담을 수 있습니다.');
          id(block.materialId); dependency('SourceReference').validate(block.reference);
          const value = materials.get(block.materialId), ref = block.reference;
          if (!value || ref.workspaceId !== state.workspaceId || ref.sourceId !== value.sourceId || ref.sourceVersionId !== value.sourceVersionId || ref.contentHash !== value.contentHash) fail('채택한 인용의 자료·정확 버전·해시가 일치하지 않습니다. 자료를 빼기 전에 그 인용을 먼저 정리해 주세요.');
        } else fail('제목·문단·인용 블록만 글에 담을 수 있습니다.');
      }
      if (plan.output !== null) { fields(plan.output, ['postId']); id(plan.output.postId); }
      // Blank plans remain editable. Nonempty plans and their quotation/source
      // labels must fit the unchanged PhotoPost text/ops limits before saving.
      documentFor(plan, () => 'material-writing-validation');
    }
    if (new TextEncoder().encode(JSON.stringify(state)).length > LIMITS.json) fail('글쓰기 준비 전체는 2 MiB까지 보관할 수 있습니다.');
    return state;
  }
  function empty(workspaceId) { id(workspaceId); return { format: FORMAT, workspaceId, revision: 0, plans: [] }; }
  function create(idFn, now = new Date().toISOString()) {
    if (typeof idFn !== 'function') fail('새 준비의 식별자를 만들 수 없습니다.');
    const plan = { id: id(idFn()), title: '', question: '', createdAt: now, updatedAt: now, materials: [], blocks: [], output: null };
    date(now); return plan;
  }
  function resolveMaterial(bundle, value) {
    dependency('Core').validateWorkspace(bundle); materialShape(value);
    const source = bundle.sources.find(row => row.id === value.sourceId), version = bundle.sourceVersions.find(row => row.id === value.sourceVersionId);
    if (!source || !version) return { status: 'missing' };
    if (version.sourceId !== source.id || version.contentHash !== value.contentHash) return { status: 'mismatch' };
    // Hash/UTF-16 quote verification against actual bytes is performed by the
    // existing SourceReference and storage handoff, never inferred by this model.
    return { status: 'available', source: clone(source), version: clone(version) };
  }
  function material(bundle, sourceId, versionId, idFn) {
    dependency('Core').validateWorkspace(bundle); id(sourceId); id(versionId);
    if (typeof idFn !== 'function') fail('새 자료의 식별자를 만들 수 없습니다.');
    const source = bundle.sources.find(row => row.id === sourceId), version = bundle.sourceVersions.find(row => row.id === versionId && row.sourceId === sourceId);
    if (!source || !version) fail('선택한 정확한 원문 버전을 찾지 못했습니다. 최신 버전으로 바꾸지 않았습니다.');
    if (!dependency('Core').isSourceActive(bundle, sourceId)) fail('휴지통에 있는 자료입니다. 복원한 뒤 새 자료로 선택해 주세요.');
    const result = { id: id(idFn()), sourceId, sourceVersionId: versionId, contentHash: version.contentHash, note: '' };
    materialShape(result); return result;
  }
  function project(state, planId, idFn) {
    validate(state); id(planId);
    const owned = clone(state), plan = owned.plans.find(value => value.id === planId);
    if (!plan) fail('글로 옮길 준비를 찾지 못했습니다. 준비 목록을 다시 확인해 주세요.');
    const result = documentFor(plan, idFn);
    if (!result.hasContent) fail('글에 담을 내용이 없습니다. 개요에 문단이나 인용을 먼저 추가해 주세요.');
    return { doc: result.doc, refs: result.refs };
  }
  return Object.freeze({ FORMAT, LIMITS, empty, create, validate, material, resolveMaterial, project });
});

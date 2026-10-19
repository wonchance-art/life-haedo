/* Private derived metadata only. Persistence and account-scoped CAS belong to
 * the caller. Revalidation returns Promise<true> or throws interest_* errors. */
(function (root, factory) {
  'use strict';
  const api = factory(root, root.HaedoLife?.Core || (typeof require === 'function' && require('./core.js')));
  (root.HaedoLife ||= {}).InterestProfile = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root, Core) {
  'use strict';
  const MAX_BYTES = 256 * 1024;
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const text = (value, max, empty = false) => typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
  const stamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  function clone(value) { try { return JSON.parse(JSON.stringify(value)); } catch (_) { check(false); } }
  function check(value, code = 'interest_profile_invalid') {
    if (!value) throw Object.assign(new Error(code === 'interest_profile_conflict' ? '관심 정보가 다른 화면에서 바뀌었습니다. 다시 확인해 주세요.' : code === 'interest_profile_stale' ? '선택한 원문이나 근거가 바뀌었습니다. 분석 범위를 다시 확인해 주세요.' : '관심 정보와 근거를 다시 확인해 주세요.'), { code });
  }
  function fields(value, names) { check(plain(value) && Object.keys(value).every(key => names.includes(key))); }
  function unique(values, maximum, valid = id) {
    check(Array.isArray(values) && values.length <= maximum && values.every(valid) && new Set(values).size === values.length);
  }
  function reference(value, metadata = false) {
    fields(value, metadata ? ['sourceId', 'sourceVersionId', 'sha256', 'authorRelation', 'authorLabel', 'originalCreatedAt', 'coverage', 'omissions'] : ['sourceId', 'sourceVersionId', 'sha256']);
    check(id(value.sourceId) && id(value.sourceVersionId) && (sha(value.sha256) || metadata && value.sha256 === null));
    if (metadata) {
      check(['self', 'unknown', 'other'].includes(value.authorRelation) && text(value.authorLabel, 500, true));
      check(value.originalCreatedAt === null || text(value.originalCreatedAt, 200));
      check(['full_text', 'partial', 'link_only', 'unknown'].includes(value.coverage));
      check(Array.isArray(value.omissions) && value.omissions.length <= 100 && value.omissions.every(item => text(item, 500, true)));
    }
  }
  function evidence(value) {
    fields(value, ['sourceId', 'sourceVersionId', 'sha256', 'start', 'end', 'quote']);
    check(id(value.sourceId) && id(value.sourceVersionId) && sha(value.sha256));
    check(Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end) && value.start >= 0 && value.end > value.start && typeof value.quote === 'string' && value.quote.length > 0 && value.quote.length <= 4000);
  }
  function validate(profile) {
    fields(profile, ['schemaVersion', 'workspaceId', 'revision', 'deleted', 'manual', 'analysis', 'confirmedIds', 'updatedAt']);
    check(profile.schemaVersion === 1 && id(profile.workspaceId) && Number.isSafeInteger(profile.revision) && profile.revision >= 0 && typeof profile.deleted === 'boolean');
    check(profile.updatedAt === null && profile.revision === 0 || stamp(profile.updatedAt));
    check(Array.isArray(profile.manual) && profile.manual.length <= 40 && profile.manual.every(plain));
    unique(profile.manual.map(item => item.id), 40);
    for (const item of profile.manual) { fields(item, ['id', 'label']); check(id(item.id) && text(item.label, 200)); }
    unique(profile.confirmedIds, 8);
    if (profile.analysis !== null) {
      const value = profile.analysis;
      fields(value, ['createdAt', 'model', 'modelRevision', 'adapter', 'inputFingerprint', 'documents', 'interests', 'selection', 'limitations', 'evidenceScope']);
      check(stamp(value.createdAt) && text(value.model, 500) && text(value.modelRevision, 500) && text(value.adapter, 500) && sha(value.inputFingerprint) && value.evidenceScope === 'saved_material');
      check(Array.isArray(value.documents) && value.documents.length > 0 && value.documents.length <= 50 && value.documents.every(plain));
      value.documents.forEach(item => reference(item));
      unique(value.documents.map(item => item.sourceVersionId), 50);
      unique(value.documents.map(item => item.sha256), 50, sha);
      const selection = value.selection;
      fields(selection, ['workspaceRevision', 'sourceVersionIds', 'references']);
      check(Number.isSafeInteger(selection.workspaceRevision) && selection.workspaceRevision >= 0);
      unique(selection.sourceVersionIds, 50); check(selection.sourceVersionIds.length > 0);
      check(Array.isArray(selection.references) && selection.references.length === selection.sourceVersionIds.length && selection.references.every(plain));
      unique(selection.references.map(item => item.sourceVersionId), 50);
      selection.references.forEach(item => { reference(item, true); check(selection.sourceVersionIds.includes(item.sourceVersionId)); });
      for (const document of value.documents) check(selection.references.some(item => item.sourceId === document.sourceId && item.sourceVersionId === document.sourceVersionId && item.sha256 === document.sha256));
      check(Array.isArray(value.limitations) && value.limitations.length <= 40 && value.limitations.every(item => text(item, 500)));
      check(Array.isArray(value.interests) && value.interests.length <= 8 && value.interests.every(plain));
      unique(value.interests.map(item => item.id), 8);
      for (const item of value.interests) {
        fields(item, ['id', 'label', 'kind', 'terms', 'question', 'support', 'evidence', 'evidenceScope']);
        check(id(item.id) && text(item.label, 1000) && ['topic', 'question'].includes(item.kind) && item.evidenceScope === 'saved_material');
        check(item.question === undefined || text(item.question, 4000));
        check(Array.isArray(item.terms) && item.terms.length <= 20 && item.terms.every(term => text(term, 200)));
        check(Array.isArray(item.evidence) && item.evidence.length > 0 && item.evidence.length <= 5);
        item.evidence.forEach(evidence);
        const bodies = new Set(item.evidence.map(ref => ref.sha256));
        check(item.support === bodies.size && item.support >= 2);
        for (const ref of item.evidence) check(value.documents.some(document => document.sourceId === ref.sourceId && document.sourceVersionId === ref.sourceVersionId && document.sha256 === ref.sha256));
      }
      check(profile.confirmedIds.every(item => value.interests.some(candidate => candidate.id === item)));
    } else check(profile.confirmedIds.length === 0);
    if (profile.deleted) check(profile.manual.length === 0 && profile.analysis === null && profile.confirmedIds.length === 0);
    check(new TextEncoder().encode(JSON.stringify(profile)).length < MAX_BYTES, 'interest_profile_too_large');
    return true;
  }
  function empty(workspaceId) {
    const result = { schemaVersion: 1, workspaceId, revision: 0, deleted: false, manual: [], analysis: null, confirmedIds: [], updatedAt: null };
    validate(result); return result;
  }
  function nextRevision(current, expectedRevision) {
    validate(current);
    check(Number.isSafeInteger(expectedRevision) && expectedRevision === current.revision, 'interest_profile_conflict');
    check(current.revision < Number.MAX_SAFE_INTEGER); return current.revision + 1;
  }
  function changed(current, settings) {
    check(plain(settings)); const revision = nextRevision(current, settings.expectedRevision);
    const updatedAt = typeof settings.now === 'function' ? settings.now() : settings.now || new Date().toISOString();
    check(stamp(updatedAt)); return { ...clone(current), revision, deleted: false, updatedAt };
  }
  function setManual(current, items, settings = {}) {
    const result = changed(current, settings); result.manual = clone(items); validate(result); return result;
  }
  function clear(current, settings = {}) {
    const result = { ...changed(current, settings), deleted: true, manual: [], analysis: null, confirmedIds: [] };
    validate(result); return result;
  }
  async function hash(raw) {
    const crypto = root.crypto || (typeof require === 'function' && require('node:crypto').webcrypto);
    check(crypto?.subtle, 'interest_profile_unavailable');
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
  }
  function metadata(version) {
    return { sourceId: version.sourceId, sourceVersionId: version.id, sha256: version.contentHash,
      authorRelation: version.originalAuthor.relation, authorLabel: version.originalAuthor.label,
      originalCreatedAt: version.originalCreatedAt, coverage: version.coverage.status, omissions: [...version.coverage.omissions] };
  }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  function same(a, b) { return canonical(a) === canonical(b); }
  function validateBundle(bundle) { try { Core.validateWorkspace(bundle); } catch (_) { check(false, 'interest_profile_stale'); } }
  function boundary(raw, point) {
    return !(point > 0 && point < raw.length && /[\uD800-\uDBFF]/.test(raw[point - 1]) && /[\uDC00-\uDFFF]/.test(raw[point]));
  }
  async function revalidate(bundle, profile) {
    validate(profile); validateBundle(bundle);
    check(bundle.workspaceId === profile.workspaceId, 'interest_profile_stale');
    const snapshot = clone(profile), scope = clone(bundle), value = snapshot.analysis;
    if (!value) return true;
    const versions = new Map(scope.sourceVersions.map(version => [version.id, version]));
    for (const ref of value.selection.references) {
      const version = versions.get(ref.sourceVersionId);
      check(version && same(metadata(version), ref), 'interest_profile_stale');
      if (version.contentText !== null) check(await hash(version.contentText) === ref.sha256, 'interest_profile_stale');
    }
    for (const item of value.interests) for (const ref of item.evidence) {
      const version = versions.get(ref.sourceVersionId), raw = version?.contentText;
      check(typeof raw === 'string' && version.sourceId === ref.sourceId && version.contentHash === ref.sha256 && ref.end <= raw.length &&
        boundary(raw, ref.start) && boundary(raw, ref.end) && raw.slice(ref.start, ref.end) === ref.quote, 'interest_profile_stale');
    }
    // Hashing yields. Compare live raw strings and metadata after it, including
    // selected duplicates which do not contribute independent evidence.
    validateBundle(bundle);
    check(bundle.workspaceId === scope.workspaceId && same(profile, snapshot), 'interest_profile_stale');
    for (const ref of value.selection.references) {
      const current = bundle.sourceVersions.find(version => version.id === ref.sourceVersionId), prior = versions.get(ref.sourceVersionId);
      check(current && current.contentText === prior.contentText && same(metadata(current), ref), 'interest_profile_stale');
    }
    return true;
  }
  async function propose(bundle, current, result, settings = {}) {
    const next = changed(current, settings); validateBundle(bundle);
    check(plain(result) && plain(result.analysis) && result.workspaceId === current.workspaceId && bundle.workspaceId === current.workspaceId && result.scopeRevision === bundle.revision, 'interest_profile_stale');
    unique(settings.sourceVersionIds, 50); check(settings.sourceVersionIds.length > 0);
    const input = clone(result.analysis), wanted = [...settings.sourceVersionIds];
    const references = wanted.map(versionId => {
      const version = bundle.sourceVersions.find(item => item.id === versionId);
      check(version, 'interest_profile_stale'); return metadata(version);
    });
    check(Array.isArray(input.interests) && Array.isArray(input.documents) && input.documents.every(plain));
    const interests = input.interests.map(item => {
      check(plain(item) && Array.isArray(item.evidence) && item.evidence.every(plain));
      const refs = item.evidence.map(ref => ({ sourceId: ref.sourceId, sourceVersionId: ref.sourceVersionId, sha256: ref.sha256, start: ref.start, end: ref.end, quote: ref.quote }));
      const candidate = { id: item.id, label: item.label, kind: item.kind, terms: item.terms, support: new Set(refs.map(ref => ref.sha256)).size,
        evidence: refs, evidenceScope: 'saved_material' };
      if (item.question !== undefined) candidate.question = item.question;
      return candidate;
    });
    next.analysis = { createdAt: input.createdAt, model: input.model, modelRevision: input.modelRevision, adapter: input.adapter,
      inputFingerprint: input.inputFingerprint, documents: input.documents.map(ref => ({ sourceId: ref.sourceId, sourceVersionId: ref.sourceVersionId, sha256: ref.sha256 })),
      interests, evidenceScope: 'saved_material', selection: { workspaceRevision: bundle.revision, sourceVersionIds: wanted, references }, limitations: clone(result.limitations || []) };
    next.confirmedIds = []; validate(next); await revalidate(bundle, next); return next;
  }
  async function confirm(bundle, current, candidateIds, settings = {}) {
    const next = changed(current, settings); check(next.analysis !== null && !current.deleted);
    unique(candidateIds, 8); next.confirmedIds = [...candidateIds]; validate(next); await revalidate(bundle, next); return next;
  }
  return Object.freeze({ MAX_BYTES, empty, validate, nextRevision, setManual, clear, propose, confirm, revalidate });
});

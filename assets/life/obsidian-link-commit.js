/* Explicit, exact-version Obsidian note connections. Files remain in the separate originals store. */
(function (root, factory) {
  const api = factory(root); (root.HaedoLife ||= {}).ObsidianLinkCommit = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const fail = (code, message) => Object.assign(new Error(message), { code });
  const need = (ok, code, message) => { if (!ok) throw fail(code, message); };
  const same = (a, b) => a === b || !!a && !!b && a.start === b.start && a.end === b.end;
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const loc = value => value && Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end) && value.start >= 0 && value.end > value.start;
  const clone = value => structuredClone(value);
  async function digest(text) {
    const bytes = new TextEncoder().encode(text), value = await root.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(value), b => b.toString(16).padStart(2, '0')).join('');
  }
  function create({ storage, core = root.HaedoLife?.Core, candidates = root.HaedoLife?.ObsidianLinkCandidates, isCurrent = () => true } = {}) {
    need(storage?.read && storage?.commitLocal && core?.validateWorkspace && core?.applyChanges && core?.id &&
      candidates?.scan && candidates?.resolve && typeof isCurrent === 'function', 'invalid_dependency', '연결 저장 기능을 불러오지 못했습니다.');
    const pending = new Map(); let disposed = false;
    const guard = ws => need(!disposed && isCurrent(ws), 'request_cancelled', '화면이나 계정이 바뀌어 연결을 저장하지 않았습니다.');
    async function step(ws, operation) { guard(ws); const value = await operation(); guard(ws); return value; }
    async function save(input) {
      const request = clone(input);
      need(request && id(request.workspaceId) && request.from && request.to && id(request.from.sourceId) && id(request.from.sourceVersionId) &&
        id(request.to.sourceId) && id(request.to.sourceVersionId) && loc(request.from.locator) &&
        (request.to.locator === null || loc(request.to.locator)) && hash(request.from.contentHash) &&
        (request.to.contentHash === null || hash(request.to.contentHash)) && typeof request.from.token === 'string' && request.from.token.length > 0 &&
        typeof request.target === 'string' && request.target.length > 0 && request.target.length <= 2000,
      'invalid_request', '선택한 원문 연결을 다시 확인해 주세요.');
      const ws = request.workspaceId, bundle = await step(ws, () => storage.read(ws));
      core.validateWorkspace(bundle);
      const source = bundle.sources.find(s => s.id === request.from.sourceId), sourceVersion = bundle.sourceVersions.find(v => v.id === request.from.sourceVersionId);
      const target = bundle.sources.find(s => s.id === request.to.sourceId), targetVersion = bundle.sourceVersions.find(v => v.id === request.to.sourceVersionId);
      need(source?.origin === 'obsidian' && target?.origin === 'obsidian' && source.sourceKey && target.sourceKey &&
        sourceVersion?.sourceId === source.id && targetVersion?.sourceId === target.id && core.isSourceActive(bundle, source.id) && core.isSourceActive(bundle, target.id) &&
        sourceVersion.contentHash === request.from.contentHash && targetVersion.contentHash === request.to.contentHash && typeof sourceVersion.contentText === 'string' &&
        sourceVersion.contentText.slice(request.from.locator.start, request.from.locator.end) === request.from.token,
      'stale_selection', '원문이나 선택한 대상이 달라졌습니다. 연결을 다시 확인해 주세요.');
      need(await step(ws, () => digest(sourceVersion.contentText)) === sourceVersion.contentHash, 'stale_selection', '출발 원문을 검증하지 못했습니다.');
      if (targetVersion.contentText !== null) need(await step(ws, () => digest(targetVersion.contentText)) === targetVersion.contentHash, 'stale_selection', '대상 원문을 검증하지 못했습니다.');
      const occurrence = candidates.scan(sourceVersion.contentText).find(o => o.start === request.from.locator.start && o.end === request.from.locator.end && o.token === request.from.token && o.target === request.target);
      need(occurrence && !occurrence.invalid, 'stale_selection', '선택한 링크를 원문에서 다시 확인해 주세요.');
      const resolved = candidates.resolve({ occurrence, fromPath: source.sourceKey, notes: [{ path: target.sourceKey, origin: target.origin,
        sourceId: target.id, sourceVersionId: targetVersion.id, text: targetVersion.contentText }], attachments: null });
      need(resolved.kind === 'note' && resolved.candidates.length === 1, 'invalid_target', '선택한 노트가 이 링크의 후보인지 확인해 주세요.');
      const selected = resolved.candidates[0];
      need(selected.fragment ? request.to.locator !== null && selected.locators.some(value => same(value, request.to.locator)) : request.to.locator === null,
        'invalid_target', '선택한 제목이나 블록 위치를 다시 확인해 주세요.');
      const matches = bundle.links.filter(link => link.kind === 'obsidian_link' && link.sourceRefs?.length === 2 &&
        link.sourceRefs[0].sourceId === source.id && link.sourceRefs[0].sourceVersionId === sourceVersion.id && same(link.sourceRefs[0].locator, request.from.locator));
      if (matches.length) {
        if (matches.length === 1 && matches[0].sourceRefs[1].sourceId === target.id && matches[0].sourceRefs[1].sourceVersionId === targetVersion.id && same(matches[0].sourceRefs[1].locator, request.to.locator)) return { status: 'unchanged', linkId: matches[0].id };
        return { status: 'conflict' };
      }
      const signature = JSON.stringify([ws, bundle.revision, request]), prior = pending.get(signature);
      const time = new Date().toISOString();
      const link = prior?.link || { id: core.id(), kind: 'obsidian_link', note: request.target,
        sourceRefs: [{ sourceId: source.id, sourceVersionId: sourceVersion.id, locator: clone(request.from.locator) },
          { sourceId: target.id, sourceVersionId: targetVersion.id, locator: clone(request.to.locator) }], revision: 1, createdAt: time, updatedAt: time };
      const operationId = prior?.operationId || core.id(); pending.set(signature, { link, operationId });
      const changes = { put: { links: [link] } }; core.applyChanges(bundle, changes);
      const result = await step(ws, () => storage.commitLocal({ workspaceId: ws, baseRevision: bundle.revision, operationId, changes },
        { isCurrent: () => !disposed && isCurrent(ws) }));
      if (result.status === 'conflict') { pending.delete(signature); return { status: 'conflict' }; }
      if (result.status !== 'stored') throw fail(result.error?.code || 'storage_error', result.error?.message || '연결을 저장하지 못했습니다.');
      pending.delete(signature); return { status: 'stored', linkId: link.id };
    }
    return Object.freeze({ save, dispose() { disposed = true; pending.clear(); } });
  }
  return Object.freeze({ create });
});

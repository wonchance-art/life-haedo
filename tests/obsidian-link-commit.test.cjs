'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../assets/life/core.js');
const Candidates = require('../assets/life/obsidian-link-candidates.js');
const Links = require('../assets/life/obsidian-link-commit.js');
const copy = value => structuredClone(value);
async function fixture() {
  let bundle = Core.createWorkspace({ title: '합성 보관함' });
  async function add(fileName, text) {
    const prepared = await Core.prepareImport({ origin: 'obsidian', fileName, title: fileName, text, authorRelation: 'unknown' }, bundle);
    bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, prepared)); return prepared;
  }
  const source = await add('일기/출발.md', '\uFEFF🌱 첫 문장\r\n[[대상#목표|보여줄 이름]]\r\n끝');
  const target = await add('일기/대상.md', '# 서문\r\n# 목표\r\n한글 문장 🌿\r\n');
  const token = '[[대상#목표|보여줄 이름]]', start = source.version.contentText.indexOf(token), anchor = target.version.contentText.indexOf('# 목표');
  const input = { workspaceId: bundle.workspaceId,
    from: { sourceId: source.source.id, sourceVersionId: source.version.id, contentHash: source.version.contentHash, token, locator: { start, end: start + token.length } },
    to: { sourceId: target.source.id, sourceVersionId: target.version.id, contentHash: target.version.contentHash, locator: { start: anchor, end: anchor + '# 목표'.length } }, target: '대상#목표' };
  const storage = { writes: 0, requests: [], async read() { return copy(bundle); }, async commitLocal(request, options) {
    this.requests.push(copy(request)); if (!options.isCurrent()) return { status: 'rejected', error: { code: 'request_cancelled' } };
    if (request.baseRevision !== bundle.revision) return { status: 'conflict' };
    bundle = Core.applyChanges(bundle, request.changes); this.writes++; return { status: 'stored' };
  }, get bundle() { return copy(bundle); }, set bundle(value) { bundle = copy(value); } };
  return { input, source, target, storage, service: Links.create({ storage, core: Core, candidates: Candidates }) };
}
test('explicit note connection preserves both original bytes and exact BOM/CRLF/emoji offsets and is idempotent', async () => {
  const f = await fixture(), before = f.storage.bundle, result = await f.service.save(f.input);
  assert.equal(result.status, 'stored'); const after = f.storage.bundle, link = after.links.find(x => x.id === result.linkId);
  assert.equal(link.kind, 'obsidian_link'); assert.deepEqual(after.sources, before.sources); assert.deepEqual(after.sourceVersions, before.sourceVersions); assert.deepEqual(after.records, before.records);
  assert.equal(after.sourceVersions.find(v => v.id === link.sourceRefs[0].sourceVersionId).contentText.slice(link.sourceRefs[0].locator.start, link.sourceRefs[0].locator.end), f.input.from.token);
  assert.equal(after.sourceVersions.find(v => v.id === link.sourceRefs[1].sourceVersionId).contentText.slice(link.sourceRefs[1].locator.start, link.sourceRefs[1].locator.end), '# 목표');
  assert.deepEqual(await f.service.save(f.input), { status: 'unchanged', linkId: link.id }); assert.equal(f.storage.writes, 1);
  const restored = await Core.restoreBackup(Core.makeBackup(after)); assert.equal(restored.links.length, 1);
});
test('different existing destination is a conflict without changing either link or body', async () => {
  const f = await fixture(); await f.service.save(f.input); const before = f.storage.bundle, changed = copy(f.input); changed.to.locator = null;
  // A document-only choice is invalid for a heading: a forged choice never changes the accepted graph.
  await assert.rejects(f.service.save(changed), error => error.code === 'invalid_target');
  const value = f.storage.bundle; value.links[0].sourceRefs[1].locator = null; value.links[0].revision++; value.links[0].updatedAt = new Date().toISOString(); f.storage.bundle = value;
  const baseline = f.storage.bundle; assert.deepEqual(await f.service.save(f.input), { status: 'conflict' }); assert.deepEqual(f.storage.bundle, baseline); assert.equal(f.storage.writes, 1); assert.notDeepEqual(before.links, baseline.links);
});
test('stale versions, body hash, token, non-candidate target, and anchor changes never write', async () => {
  const f = await fixture(), before = f.storage.bundle;
  for (const mutate of [v => v.from.contentHash = '0'.repeat(64), v => v.from.token += 'x', v => v.to.contentHash = 'f'.repeat(64),
    v => v.target = '다른노트#목표', v => { v.to.locator.start++; }, v => v.to.sourceVersionId = Core.id()]) {
    const input = copy(f.input); mutate(input); await assert.rejects(f.service.save(input));
  }
  assert.equal(f.storage.writes, 0); assert.deepEqual(f.storage.bundle, before);
  const corrupt = f.storage.bundle; corrupt.sourceVersions.find(v => v.id === f.input.to.sourceVersionId).contentText += '변조'; f.storage.bundle = corrupt;
  await assert.rejects(f.service.save(f.input), error => error.code === 'stale_selection'); assert.equal(f.storage.writes, 0);
});
test('unverified attachments, missing anchors, and links inside code cannot be stored', async () => {
  const f = await fixture(); const before = f.storage.bundle, invalid = copy(f.input); invalid.target = '사진.png'; invalid.from.token = '[[사진.png]]';
  await assert.rejects(f.service.save(invalid));
  const stale = copy(f.input); stale.to.locator = { start: 0, end: 4 }; await assert.rejects(f.service.save(stale), error => error.code === 'invalid_target');
  assert.equal(f.storage.writes, 0); assert.deepEqual(f.storage.bundle, before);
});
test('screen/account change before last write, CAS conflict, and quota rejection preserve all existing data', async () => {
  const f = await fixture(), before = f.storage.bundle; let current = true;
  const service = Links.create({ storage: f.storage, core: Core, candidates: Candidates, isCurrent: () => current });
  f.storage.read = async () => { current = false; return copy(before); };
  await assert.rejects(service.save(f.input), error => error.code === 'request_cancelled'); assert.equal(f.storage.writes, 0); assert.deepEqual(f.storage.bundle, before);
  current = true; f.storage.read = async () => copy(before); f.storage.commitLocal = async () => ({ status: 'conflict' });
  assert.deepEqual(await service.save(f.input), { status: 'conflict' }); assert.deepEqual(f.storage.bundle, before);
  f.storage.commitLocal = async () => ({ status: 'rejected', error: { code: 'storage_quota', message: '용량 부족' } });
  await assert.rejects(service.save(f.input), error => error.code === 'storage_quota'); assert.deepEqual(f.storage.bundle, before);
});
test('caller mutation during asynchronous read cannot change the selected source, target, or request', async () => {
  const f = await fixture(), original = copy(f.input), read = f.storage.read.bind(f.storage); let release;
  f.storage.read = async () => { await new Promise(resolve => { release = resolve; }); return read(); };
  const promise = f.service.save(f.input); f.input.from.token = '바뀐 입력'; f.input.to.locator.start = 0; f.input.target = '다른 항목'; release();
  const result = await promise; assert.equal(result.status, 'stored');
  const link = f.storage.bundle.links.find(x => x.id === result.linkId); assert.deepEqual(link.sourceRefs[0].locator, original.from.locator); assert.deepEqual(link.sourceRefs[1].locator, original.to.locator); assert.equal(link.note, original.target);
});
test('uncertain write retries the exact request and simultaneous clicks never create duplicate links', async () => {
  const f = await fixture(), write = f.storage.commitLocal.bind(f.storage); let attempts = 0;
  f.storage.commitLocal = async (request, options) => { attempts++; if (attempts === 1) { f.storage.requests.push(copy(request)); throw new Error('lost acknowledgement'); } return write(request, options); };
  await assert.rejects(f.service.save(f.input), /lost acknowledgement/); const accepted = await f.service.save(f.input);
  assert.equal(accepted.status, 'stored'); assert.equal(f.storage.requests[0].operationId, f.storage.requests[1].operationId); assert.equal(f.storage.requests[0].changes.put.links[0].id, f.storage.requests[1].changes.put.links[0].id);
  const once = f.storage.bundle; const duplicate = await Promise.all([f.service.save(f.input), f.service.save(f.input)]); assert(duplicate.every(r => r.status === 'unchanged')); assert.deepEqual(f.storage.bundle, once);
});
test('a committed link with a lost acknowledgement is recognized on retry without a second write', async () => {
  const f = await fixture(), before = f.storage.bundle, write = f.storage.commitLocal.bind(f.storage); let first = true;
  f.storage.commitLocal = async (request, options) => { const result = await write(request, options); if (first) { first = false; throw new Error('ack lost after durable write'); } return result; };
  await assert.rejects(f.service.save(f.input), /ack lost after durable write/);
  const saved = f.storage.bundle; assert.equal(saved.links.length, before.links.length + 1); assert.deepEqual(saved.sources, before.sources); assert.deepEqual(saved.sourceVersions, before.sourceVersions); assert.deepEqual(saved.records, before.records);
  assert.deepEqual(await f.service.save(f.input), { status: 'unchanged', linkId: saved.links.at(-1).id }); assert.equal(f.storage.writes, 1); assert.deepEqual(f.storage.bundle, saved);
});
test('two concurrent selection requests use one transaction identity and keep one immutable link', async () => {
  const f = await fixture(), write = f.storage.commitLocal.bind(f.storage); let release; const entered = new Promise(resolve => { release = resolve; }); let count = 0;
  f.storage.commitLocal = async (request, options) => { if (++count === 1) await entered; else release(); return write(request, options); };
  const results = await Promise.all([f.service.save(f.input), f.service.save(f.input)]);
  assert.equal(f.storage.writes, 1); assert.equal(f.storage.bundle.links.length, 1);
  assert.deepEqual(f.storage.requests.map(value => value.operationId), [f.storage.requests[0].operationId, f.storage.requests[0].operationId]);
  assert(results.some(value => value.status === 'stored')); assert(results.every(value => ['stored', 'conflict'].includes(value.status)));
});

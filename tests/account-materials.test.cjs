'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Core = require('../assets/life/core.js');
const Model = require('../assets/life/account-materials.js');
const owner = { projectUrl: 'https://materials.invalid', userId: '10000000-0000-4000-8000-000000000001' };
const makeId = () => Core.id();
async function sourceBundle(text = '\ufeff옛 원문🌱\r\n정확한 구절\r\n') {
  let bundle = Core.createWorkspace();
  const item = await Core.prepareImport({ origin: 'obsidian', title: '익명 자료', fileName: 'notes/원문.md', text }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, item));
  return bundle;
}
function fixture(snapshot) {
  let target = Core.createWorkspace(), marker = null, commits = [], reads = 0, disposed = 0;
  const row = { id: makeId(), owner_id: owner.userId, workspace_id: snapshot.workspaceId, workspace_revision: 7, revision: 2, enabled: true };
  const queryLog = [], env = { rows: [row], queryError: null, queryStatus: 200, held: null, readHeld: null, commitResult: null, sync: { enabled: false } };
  const auth = { user: { id: owner.userId }, epoch: 0, config: { url: owner.projectUrl, key: 'sb_publishable_fixture' },
    getAccount: () => ({ ...owner }), async verify() { return auth.user; },
    client: { from(name) {
      queryLog.push(['from', name]);
      const q = { select(value) { queryLog.push(['select', value]); return q; }, eq(...args) { queryLog.push(['eq', ...args]); return q; },
        limit(value) { queryLog.push(['limit', value]); return q; }, abortSignal() { return q; },
        async then(resolve, reject) { try { if (env.held) await env.held; return resolve({ data: env.rows, error: env.queryError, status: env.queryStatus }); } catch (error) { return reject(error); } } };
      return q;
    } } };
  const storage = { isAccountScoped: true, account: { ...owner }, async getSyncState() { return env.sync; }, async read() { return structuredClone(target); },
    async readAccountMaterialRegistration(_workspaceId, id) { return marker?.descriptor.id === id ? structuredClone(marker) : null; },
    async commitLocal(request) {
      commits.push(structuredClone(request));
      if (env.commitResult) return env.commitResult;
      if (request.baseRevision !== target.revision) return { status: 'conflict', revision: target.revision };
      target = Core.applyChanges(target, request.changes);
      marker = { owner: { ...owner }, descriptor: request.accountMaterialRegistration, result: { status: 'stored', revision: target.revision, operationId: request.operationId } };
      return { status: 'stored', revision: target.revision, operationId: request.operationId };
    } };
  const service = Model.create({ storage, auth, core: Core, remoteFactory(config, options) {
    assert.deepEqual(config, auth.config); assert.equal(options.platformAuth, auth);
    return { async read(id) { reads++; env.remoteEntered?.(); if (env.readHeld) await env.readHeld; return { id, revision: 7, data: structuredClone(snapshot) }; }, dispose() { disposed++; } };
  } });
  return { service, env, auth, storage, row, queryLog, commits, target: () => target, reads: () => reads, disposed: () => disposed,
    setMarker: value => { marker = value; }, marker: () => marker, changeTarget: () => { target.revision++; } };
}
test('exact graph append keeps old IDs and CRLF, ignores private excerpts/hints and does not merge equal bodies at other IDs', async () => {
  const target = await sourceBundle(), incoming = await sourceBundle();
  const version = incoming.sourceVersions[0], now = incoming.createdAt;
  incoming.records.push({ id: makeId(), kind: 'excerpt', text: version.contentText.slice(0, 3), sourceRefs: [{ sourceId: version.sourceId, sourceVersionId: version.id, locator: { start: 0, end: 3 } }], topic: '', note: 'PRIVATE_NOTE', provenance: { kind: 'user' }, revision: 1, createdAt: now, updatedAt: now });
  incoming.links.push({ id: makeId(), kind: 'obsidian_link', note: 'notes/정확.md', sourceRefs: [{ sourceId: version.sourceId, sourceVersionId: version.id, locator: { start: 0, end: version.contentText.length } }], entityRefs: [] });
  const before = structuredClone(target), original = structuredClone(incoming);
  const result = await Model.prepare(target, incoming), applied = Core.applyChanges(target, result.changes);
  assert.equal(result.addedSources, 1); assert.equal(applied.sources.length, 2);
  assert.deepEqual(applied.sourceVersions[0], before.sourceVersions[0]);
  assert.equal(applied.sourceVersions[1].id, version.id); assert.equal(applied.sourceVersions[1].contentText, version.contentText);
  assert.deepEqual(applied.links, incoming.links);
  assert.deepEqual(applied.records, []); assert(!JSON.stringify(result).includes('PRIVATE_NOTE'));
  assert.deepEqual(target, before); assert.deepEqual(incoming, original);
  const repeated = await Model.prepare(applied, incoming); assert.equal(repeated.addedSources, 0); assert.equal(repeated.fingerprint, result.fingerprint);
  const reorder = Object.fromEntries(Object.entries(incoming).reverse());
  reorder.sources = incoming.sources.map(value => Object.fromEntries(Object.entries(value).reverse()));
  assert.equal((await Model.prepare(target, reorder)).fingerprint, result.fingerprint);
});
test('same-ID metadata, immutable body, global ID collisions and private record links fail closed', async () => {
  const incoming = await sourceBundle(), target = structuredClone(incoming);
  target.sources[0].title = '별도 수정한 이름';
  await assert.rejects(Model.prepare(target, incoming), { code: 'account_material_identity_conflict' });
  target.sources[0].title = incoming.sources[0].title; target.sourceVersions[0].contentText += '변경';
  await assert.rejects(Model.prepare(target, incoming), { code: 'account_material_identity_conflict' });
  const collision = structuredClone(incoming);
  collision.sources[0].id = incoming.sourceVersions[0].id;
  collision.sourceVersions[0].id = makeId(); collision.sourceVersions[0].sourceId = collision.sources[0].id;
  await assert.rejects(Model.prepare(collision, incoming), { code: 'duplicate_id' });
  const version = incoming.sourceVersions[0];
  const record = { id: makeId(), kind: 'excerpt', text: version.contentText.slice(0, 3), sourceRefs: [{ sourceId: version.sourceId, sourceVersionId: version.id, locator: { start: 0, end: 3 } }], topic: '', note: '개인 메모', provenance: { kind: 'user' }, revision: 1, createdAt: incoming.createdAt, updatedAt: incoming.createdAt };
  incoming.records.push(record); incoming.links.push({ id: makeId(), entityRefs: [{ entityType: 'record', entityId: record.id }], sourceRefs: [] });
  await assert.rejects(Model.prepare(Core.createWorkspace(), incoming), { code: 'account_material_private_reference' });
});
test('conservative JSONB bound refuses a prospective oversized workspace without mutating inputs', async () => {
  const incoming = await sourceBundle(), target = Core.createWorkspace();
  // A valid workspace can exceed the whole-snapshot remote limit across many
  // individually permitted sources. Avoid allocating a single invalid source.
  for (let index = 0; index < 17; index++) {
    const source = structuredClone(incoming.sources[0]), version = structuredClone(incoming.sourceVersions[0]);
    source.id = makeId(); version.id = makeId(); version.sourceId = source.id; version.contentText = 'x'.repeat(1024 * 1024);
    version.contentHash = require('node:crypto').createHash('sha256').update(version.contentText).digest('hex');
    target.sources.push(source); target.sourceVersions.push(version);
  }
  await assert.rejects(Model.prepare(target, incoming), { code: 'account_material_too_large' });
  assert.equal(target.sources.length, 17);
});
test('registration uses owner-scoped bounded catalog, exact remote revision and append receipt; rerun skips body GET', async () => {
  const snapshot = await sourceBundle(), f = fixture(snapshot), old = structuredClone(f.target());
  const first = await f.service.register(old.workspaceId);
  assert.equal(first.status, 'stored'); assert.equal(first.addedSources, 1); assert.equal(f.reads(), 1);
  assert.equal(f.target().workspaceId, old.workspaceId); assert.equal(f.target().sourceVersions[0].id, snapshot.sourceVersions[0].id);
  assert.deepEqual(f.queryLog, [['from', 'life_account_materials'], ['select', 'id,owner_id,workspace_id,workspace_revision,revision,enabled'], ['eq', 'owner_id', owner.userId], ['eq', 'enabled', true], ['limit', 21]]);
  const descriptor = f.commits[0].accountMaterialRegistration;
  assert.deepEqual(descriptor, { id: f.row.id, revision: 2, sourceWorkspaceId: snapshot.workspaceId, sourceRevision: 7, fingerprint: (await Model.prepare(old, snapshot)).fingerprint });
  f.env.sync = { enabled: true, outbox: {} };
  assert.equal((await f.service.register(old.workspaceId)).status, 'already_registered');
  assert.equal(f.reads(), 1); assert.equal(f.commits.length, 1); assert.equal(f.disposed(), 1);
});
test('foreign catalog rows, duplicate rows, catalog overflow and changed remote pin never commit', async () => {
  for (const change of [f => { f.env.rows[0].owner_id = makeId(); }, f => { f.row.enabled = false; }, f => { f.env.rows.push(f.row); }, f => { f.env.rows = Array.from({ length: 21 }, () => ({ ...f.row, id: makeId() })); }, f => { f.row.workspace_revision = 8; }]) {
    const f = fixture(await sourceBundle()); change(f);
    await assert.rejects(f.service.register(f.target().workspaceId)); assert.equal(f.commits.length, 0); f.service.dispose();
  }
});
test('marker owner, revision and source pin mismatches do not become silent already-registered success', async () => {
  for (const change of [marker => { marker.owner.userId = makeId(); }, marker => { marker.descriptor.sourceRevision++; }, marker => { marker.descriptor.fingerprint = 'bad'; }]) {
    const f = fixture(await sourceBundle()); await f.service.register(f.target().workspaceId);
    const marker = structuredClone(f.marker()); change(marker); f.setMarker(marker);
    await assert.rejects(f.service.register(f.target().workspaceId), { code: 'account_material_registration_changed' }); assert.equal(f.reads(), 1);
  }
});
test('missing schema and empty registry are no-ops, while network failures remain failures', async () => {
  for (const mode of ['empty', 'missing', 'network']) {
    const f = fixture(await sourceBundle());
    if (mode === 'empty') f.env.rows = [];
    else { f.env.queryError = { code: mode === 'missing' ? 'PGRST205' : 'NETWORK' }; f.env.queryStatus = mode === 'missing' ? 404 : 503; }
    if (mode === 'network') await assert.rejects(f.service.register(f.target().workspaceId), { code: 'account_material_unavailable' });
    else assert.equal((await f.service.register(f.target().workspaceId)).status, 'no_registry');
    assert.equal(f.commits.length, 0); assert.equal(f.reads(), 0);
  }
});
test('held remote read cannot install after account epoch changes, abort or disposal', async () => {
  for (const mode of ['account', 'abort', 'dispose']) {
    const f = fixture(await sourceBundle()), controller = new AbortController(); let release, entered;
    const ready = new Promise(resolve => { entered = resolve; });
    f.env.readHeld = new Promise(resolve => { release = resolve; });
    f.env.remoteEntered = entered;
    const pending = f.service.register(f.target().workspaceId, { signal: controller.signal }); await ready;
    if (mode === 'account') f.auth.epoch++;
    else if (mode === 'abort') controller.abort(); else f.service.dispose();
    release(); await assert.rejects(pending, { code: 'account_material_cancelled' }); assert.equal(f.commits.length, 0);
  }
});
test('enabled pending sync and stale CAS are rejected without automatic rebase or remote write', async () => {
  for (const mode of ['outbox', 'conflict', 'cas']) {
    const f = fixture(await sourceBundle());
    if (mode === 'cas') f.env.commitResult = { status: 'conflict', revision: 9 };
    else f.env.sync = { enabled: true, [mode]: {} };
    await assert.rejects(f.service.register(f.target().workspaceId), { code: mode === 'cas' ? 'account_material_conflict' : 'account_material_sync_pending' });
    assert.equal(f.commits.length, mode === 'cas' ? 1 : 0); assert.equal(f.target().sources.length, 0);
  }
});
test('multiple descriptors keep a committed first graph and report partial failure honestly', async () => {
  const f = fixture(await sourceBundle());
  f.env.rows.push({ ...f.row, id: makeId(), workspace_revision: 8 });
  await assert.rejects(f.service.register(f.target().workspaceId), { code: 'account_material_partial', registeredCount: 1, addedSources: 1 });
  assert.equal(f.commits.length, 1); assert.equal(f.target().sources.length, 1);
});

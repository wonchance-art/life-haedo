'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const C = require('../assets/life/core.js'), W = require('../assets/life/material-writing.js'), M = require('../assets/life/material-continuity.js'), R = require('../assets/life/material-continuity-remote.js');
const time = '2026-10-19T01:02:03.123456Z';
function fixture(model = M) {
  const calls = [], auth = { ready: true, user: { id: randomUUID() }, epoch: 0, config: { url: 'https://example.invalid', key: 'sb_publishable_synthetic' } };
  const f = { auth, calls, result: null, disposed: false, verifyAuth: null };
  const client = { auth: { async getUser() { if (f.verifyAuth) await f.verifyAuth(); return { data: { user: auth.user }, error: null }; }, dispose() { f.disposed = true; } },
    async rpc(name, args) { calls.push({ name, args: structuredClone(args) }); return f.respond ? f.respond(name, args) : { data: f.result, error: f.error || null }; } };
  f.remote = R.create({ auth, model, clientFactory: (_auth, options) => { assert.equal(options.scope, 'material'); return () => client; } });
  const bundle = C.createWorkspace(), plan = W.create(randomUUID); f.data = M.snapshot(bundle, plan);
  return f;
}
test('hashing owns a frozen outgoing request and account/dispose races stop before dispatch', async () => {
  let release, entered; const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const f = fixture({ async verify(value) { entered(); await gate; return M.verify(value); } }), remoteId = randomUUID(); f.result = { status: 'stored', revision: 1 };
  const request = { remoteId, operationId: randomUUID(), expectedRevision: 0, data: f.data }, original = structuredClone(request);
  const pending = f.remote.write(request); await started; request.data.plan.question = '해싱 중에 바뀐 입력'; release(); await pending; assert.deepEqual(f.calls[0].args.p_data, original.data);
  let finish; f.verifyAuth = () => new Promise(resolve => { finish = resolve; }); const waiting = f.remote.read(remoteId); await new Promise(resolve => setImmediate(resolve)); f.auth.user = { id: randomUUID() }; f.auth.epoch++; finish(); await assert.rejects(waiting, { code: 'request_cancelled' }); assert.equal(f.calls.length, 1);
  f.remote.dispose(); assert.equal(f.disposed, true); await assert.rejects(f.remote.list(), { code: 'request_cancelled' });
});
test('strict metadata-only pages retain PostgreSQL microseconds and reject private fields or inconsistent cursors', async () => {
  const f = fixture(), low = '10000000-0000-4000-8000-000000000000', high = 'f0000000-0000-4000-8000-000000000000';
  // More recent microseconds outrank UUID ordering within the same JS millisecond.
  f.result = { items: [{ id: low, revision: 1, title: '한글 제목🌱', updated_at: time }, { id: high, revision: 2, title: '', updated_at: '2026-10-19T01:02:03.123455Z' }], next: null };
  assert.equal((await f.remote.list()).items.length, 2);
  for (const altered of [
    { ...f.result, items: [{ ...f.result.items[0], question: '개인 질문' }] },
    { ...f.result, next: { id: high, updated_at: time } },
    { ...f.result, items: [f.result.items[1], f.result.items[0]] },
    { ...f.result, items: [{ ...f.result.items[0], title: '\ud800' }] }
  ]) { f.result = altered; await assert.rejects(f.remote.list(), { code: 'invalid_remote_data' }); }
  f.remote.dispose();
});
test('malformed source rows fail closed and server details are reduced to public error codes', async () => {
  const f = fixture(), remoteId = randomUUID();
  f.result = { id: remoteId, revision: 1, data: f.data, updated_at: time }; assert.equal((await f.remote.read(remoteId)).id, remoteId);
  f.result = { ...f.result, body: '미허용 개인 본문' }; await assert.rejects(f.remote.read(remoteId), { code: 'invalid_remote_data' });
  f.error = { code: '22023', message: 'ERROR: 22023: life_material_output_changed\nDETAIL: synthetic-sensitive-detail' };
  await assert.rejects(f.remote.read(remoteId), error => error.code === 'output_changed' && !error.message.includes('synthetic-sensitive-detail'));
  const generic = R.clean({ message: 'synthetic-sensitive-secret', detail: 'private body' }); assert.equal(generic.code, 'network_error'); assert(!generic.message.includes('synthetic-sensitive-secret'));
  f.remote.dispose();
});
test('edited-marker writes require an explicit supported server before dispatch; legacy writes keep their original path', async () => {
  const f = fixture(); let bundle = C.createWorkspace();
  const source = await C.prepareImport({ origin: 'other', title: '수정한 사본', text: '# 보관한 본문' }, bundle);
  bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, source)); const time = source.version.importedAt;
  bundle.links.push({ id: C.id(), kind: 'source_edited_copy', entityRefs: [{ entityType: 'sourceVersion', entityId: source.version.id }], revision: 1, createdAt: time, updatedAt: time });
  const plan = W.create(randomUUID); plan.materials.push(W.material(bundle, source.source.id, source.version.id, randomUUID));
  const data = M.snapshot(bundle, plan), request = () => ({ remoteId: randomUUID(), operationId: randomUUID(), expectedRevision: 0, data });
  f.respond = name => name === 'life_material_capabilities' ? { error: { code: 'PGRST202' } } : { data: { status: 'stored', revision: 1 } };
  await assert.rejects(f.remote.write(request()), { code: 'schema_missing' }); assert.deepEqual(f.calls.map(v => v.name), ['life_material_capabilities']);
  f.calls.length = 0; f.respond = () => ({ data: { source_edited_copy: 0 } });
  await assert.rejects(f.remote.write(request()), { code: 'schema_missing' }); assert.deepEqual(f.calls.map(v => v.name), ['life_material_capabilities']);
  f.calls.length = 0; f.respond = name => ({ data: name === 'life_material_capabilities' ? { source_edited_copy: 1 } : { status: 'stored', revision: 1 } });
  await f.remote.write(request()); await f.remote.write(request());
  assert.deepEqual(f.calls.map(v => v.name), ['life_material_capabilities', 'life_material_put', 'life_material_put']);
  f.auth.epoch++; await f.remote.write(request()); assert.equal(f.calls.filter(v => v.name === 'life_material_capabilities').length, 2);
  f.remote.dispose();
  const changing = fixture(); let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  changing.respond = async name => { assert.equal(name, 'life_material_capabilities'); entered(); await gate; return { data: { source_edited_copy: 1 } }; };
  const pending = changing.remote.write(request()); await started; changing.auth.epoch++; release();
  await assert.rejects(pending, { code: 'request_cancelled' }); assert.deepEqual(changing.calls.map(v => v.name), ['life_material_capabilities']); changing.remote.dispose();
});

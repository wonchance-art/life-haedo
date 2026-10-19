'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const Remote = require('../assets/life/nine-public-remote.js'), Nine = require('../assets/life/nine-board.js');
const time = '2026-10-18T12:00:00.000Z', copy = value => structuredClone(value);
function fixture() {
  const owner = randomUUID(), workspaceId = randomUUID(), board = Nine.create(randomUUID), pages = new Map(), receipts = new Map(), requests = [], backing = new Map(), snapshots = new Map(), publicReads = [];
  board.title = '개인 구성'; board.intro = '숨긴 구성 소개'; board.areas[0].title = '읽은 책'; board.areas[0].note = '숨긴 영역 메모';
  const item = Nine.snapshot({ type: 'book', title: '정확한 전체 제목 🌱', creator: '저자', url: 'https://example.org/book?edition=1#source' }); item.reason = '비공개 선택 이유'; board.areas[0].items.push(item);
  let state = { ...Nine.empty(workspaceId), revision: 4, boards: [board] }, lost = false, nextVerify = null, current = true, publicTask = null, localReads = 0;
  const auth = { ready: true, user: { id: owner }, epoch: 0, config: { url: 'https://anonymous.supabase.co', key: 'sb_publishable_fixture' },
    async verify() { const task = nextVerify; nextVerify = null; return task ? task() : auth.user; }, onAccountChange() { return () => {}; },
    client: { rpc(name, args) {
      requests.push({ name, args: copy(args) });
      return { abortSignal() { return this; }, async then(resolve, reject) {
        try {
          const previous = pages.get(args.p_workspace_id) || { status: 'missing', revision: 0, publicId: null, updatedAt: null, lastOperationId: null };
          if (name.endsWith('_get')) return resolve({ data: copy(previous), error: null });
          assert.equal(name, 'life_public_page_put'); let result = receipts.get(args.p_operation_id);
          if (!result && args.p_expected_revision !== previous.revision) result = { status: 'conflict', revision: previous.revision };
          if (!result) {
            const published = args.p_action === 'publish', next = { status: published ? 'published' : 'revoked', revision: previous.revision + 1,
              publicId: published ? previous.status === 'published' ? previous.publicId : randomUUID() : null, updatedAt: time, lastOperationId: args.p_operation_id };
            pages.set(args.p_workspace_id, next); if (published) snapshots.set(next.publicId, copy(args.p_snapshot)); result = { status: 'stored', revision: next.revision, publicId: next.publicId, published, action: args.p_action, updatedAt: time }; receipts.set(args.p_operation_id, result);
          }
          if (lost) { lost = false; throw TypeError('lost response'); } return resolve({ data: copy(result), error: null });
        } catch (error) { return reject(error); }
      } };
    } } };
  const storage = { async readNineBoard(id) { localReads++; assert.equal(id, workspaceId); return copy(state); } }, receiptStorage = { getItem: key => backing.get(key) ?? null, setItem: (key, value) => backing.set(key, value), removeItem: key => backing.delete(key) };
  const publicFetch = async (url, options) => {
    publicReads.push({ url, options }); const id = JSON.parse(options.body).p_public_id, value = [...pages.values()].find(value => value.status === 'published' && value.publicId === id);
    const response = value ? { status: 'published', publicId: id, revision: value.revision, updatedAt: value.updatedAt, snapshot: copy(snapshots.get(id)) } : { status: 'missing' };
    return publicTask ? publicTask(response) : Response.json(response);
  };
  const create = () => Remote.create({ auth, storage, receiptStorage, publicFetch, workspaceId, isCurrent: () => current, baseURL: 'https://anonymous.example/app/index.html' });
  function blockVerify() { let enter, release; const entered = new Promise(resolve => { enter = resolve; }), waiting = new Promise(resolve => { release = resolve; }); nextVerify = async () => { enter(); await waiting; return auth.user; }; return { entered, release }; }
  return { remote: create(), create, auth, requests, pages, receipts, backing, storage, board, workspaceId, blockVerify, publicReads,
    options: { boardId: board.id, areaId: board.areas[0].id, title: '직접 적은 공개 제목', intro: '' },
    get state() { return state; }, set state(value) { state = value; }, get localReads() { return localReads; }, publicTask(task) { publicTask = task; }, lose() { lost = true; }, leave() { current = false; } };
}
test('prepare preserves exact model shape without writes; only the independent area slot receives allowlisted metadata', async () => {
  const f = fixture(), review = await f.remote.prepare(f.options);
  assert.deepEqual(Object.keys(review).sort(), ['areaId', 'boardId', 'localRevision', 'snapshot', 'workspaceId']); assert.equal(review.localRevision, 4); assert(Object.isFrozen(review.snapshot.entries[0].attachments[0])); assert.equal(f.requests.length, 0);
  const result = await f.remote.publish(review, { expectedRevision: 0 }); assert.equal(result.status, 'stored'); assert.match(result.url, /taste\.html\?nine=/);
  const wire = f.requests.find(row => row.name.endsWith('_put')).args; assert.equal(wire.p_workspace_id, f.options.areaId); assert.notEqual(wire.p_workspace_id, f.workspaceId);
  for (const secret of [f.workspaceId, f.board.id, f.options.areaId, '비공개 선택 이유', '숨긴 구성 소개', '숨긴 영역 메모']) assert(!JSON.stringify(wire.p_snapshot).includes(secret));
  assert.equal(wire.p_snapshot.entries[0].attachments[0].title, '정확한 전체 제목 🌱'); f.remote.dispose();
});
test('changed local revision or same-revision changed selected metadata rejects before persistence/RPC', async () => {
  for (const change of [f => f.state.revision++, f => f.state.boards[0].areas[0].items[0].attachment.title = '변경된 제목']) {
    const f = fixture(), review = await f.remote.prepare(f.options); change(f);
    await assert.rejects(f.remote.publish(review, { expectedRevision: 0 }), { code: 'local_changed' }); assert.equal(f.requests.length, 0); assert.equal(f.backing.size, 0); f.remote.dispose();
  }
});
test('local editing during actual ShareRemote auth.verify await is rejected at its final gate, before any receipt or RPC', async () => {
  const f = fixture(), review = await f.remote.prepare(f.options), gate = f.blockVerify();
  const pending = f.remote.publish(review, { expectedRevision: 0 }); await gate.entered; f.state.revision++; gate.release();
  await assert.rejects(pending, { code: 'local_changed' }); assert.equal(f.requests.length, 0); assert.equal(f.backing.size, 0); f.remote.dispose();
});
test('account and screen changes during auth verification cannot dispatch an old reviewed snapshot', async () => {
  for (const change of [f => { f.auth.user = { id: randomUUID() }; f.auth.epoch++; }, f => f.leave(), f => f.remote.dispose()]) {
    const f = fixture(), review = await f.remote.prepare(f.options), gate = f.blockVerify();
    const pending = f.remote.publish(review, { expectedRevision: 0 }); await gate.entered; change(f); gate.release();
    await assert.rejects(pending, { code: 'request_cancelled' }); assert.equal(f.requests.length, 0); assert.equal(f.backing.size, 0); f.remote.dispose();
  }
});
test('CAS conflict consumes review; only a newly prepared approval can use the new server revision', async () => {
  const f = fixture(); f.pages.set(f.options.areaId, { status: 'published', revision: 2, publicId: randomUUID(), updatedAt: time, lastOperationId: randomUUID() });
  const review = await f.remote.prepare(f.options), result = await f.remote.publish(review, { expectedRevision: 0 }); assert.equal(result.status, 'conflict');
  const count = f.requests.length; assert.throws(() => f.remote.publish(review, { expectedRevision: 2 }), { code: 'invalid_review' }); assert.equal(f.requests.length, count);
  assert.equal((await f.remote.publish(await f.remote.prepare(f.options), { expectedRevision: 2 })).revision, 3); f.remote.dispose();
});
test('unknown outcome survives adapter reload and replays the original snapshot despite subsequent local changes', async () => {
  const f = fixture(), review = await f.remote.prepare(f.options); f.lose(); await assert.rejects(f.remote.publish(review, { expectedRevision: 0 }), { code: 'publish_unknown' });
  assert.equal((await f.remote.getState(f.options.areaId)).pending, true); const original = f.requests.find(row => row.name.endsWith('_put'));
  f.remote.dispose(); f.state.revision++; f.state.boards[0].areas[0].items[0].attachment.title = '이후 개인 편집'; const next = f.create();
  assert.equal((await next.retry(f.options.areaId)).status, 'stored'); const writes = f.requests.filter(row => row.name.endsWith('_put')); assert.deepEqual(writes[1], original); assert.equal(f.receipts.size, 1); assert.equal((await next.getState(f.options.areaId)).pending, false); next.dispose();
});
test('historical receipt cannot revive a later revoked publication; explicit republish rotates its public address', async () => {
  const f = fixture(), first = await f.remote.publish(await f.remote.prepare(f.options), { expectedRevision: 0 });
  f.lose(); await assert.rejects(f.remote.publish(await f.remote.prepare(f.options), { expectedRevision: 1 }), { code: 'publish_unknown' });
  const after = f.pages.get(f.options.areaId); f.pages.set(f.options.areaId, { ...after, status: 'revoked', revision: 3, publicId: null });
  const replay = await f.remote.retry(f.options.areaId); assert.equal(replay.status, 'conflict'); assert.equal(replay.url, null); assert.equal(replay.state.status, 'revoked');
  const published = await f.remote.publish(await f.remote.prepare(f.options), { expectedRevision: 3 }); assert.notEqual(published.publicId, first.publicId);
  assert.equal((await f.remote.revoke(f.options.areaId, { expectedRevision: 4 })).state.status, 'revoked'); f.remote.dispose();
});
test('forged reviews, non-UUID area slots and unsafe publication text never dispatch or rewrite local IDs', async () => {
  const f = fixture(), before = copy(f.state), valid = await f.remote.prepare(f.options);
  assert.throws(() => f.remote.publish(copy(valid), { expectedRevision: 0 }), { code: 'invalid_review' });
  await assert.rejects(f.remote.prepare({ ...f.options, areaId: 'legacy-area' }), { code: 'invalid_request' });
  await assert.rejects(f.remote.prepare({ ...f.options, title: '' })); assert.equal(f.requests.length, 0); assert.deepEqual(f.state, before); f.remote.dispose();
});
test('getPublished lazily resumes only already-public title/intro without local reads or writes', async () => {
  const f = fixture(); assert.equal((await f.remote.getPublished(f.options.areaId)).snapshot, null); assert.equal(f.publicReads.length, 0);
  const review = await f.remote.prepare({ ...f.options, title: '이미 공개한 제목', intro: '내가 직접 공개한 소개' }); await f.remote.publish(review, { expectedRevision: 0 });
  const localReads = f.localReads, writes = f.requests.filter(row => row.name.endsWith('_put')).length;
  const value = await f.remote.getPublished(f.options.areaId); assert.equal(value.snapshot.title, '이미 공개한 제목'); assert.equal(value.snapshot.intro, '내가 직접 공개한 소개');
  assert(Object.isFrozen(value.snapshot)); assert.equal(value.state.revision, 1); assert.equal(f.localReads, localReads); assert.equal(f.requests.filter(row => row.name.endsWith('_put')).length, writes);
  assert.equal(f.publicReads.length, 1); const request = f.publicReads[0].options; assert.equal(request.credentials, 'omit'); assert.equal(request.cache, 'no-store'); assert.equal(request.headers.Authorization, undefined);
  f.remote.dispose();
});
test('getPublished rejects read failure, generic snapshots, racing revocation and late account/screen/dispose results', async () => {
  for (const action of ['missing', 'revoked', 'generic', 'offline', 'account', 'screen', 'dispose']) {
    const f = fixture(); await f.remote.publish(await f.remote.prepare(f.options), { expectedRevision: 0 });
    f.publicTask(async response => {
      if (action === 'missing') return Response.json({ status: 'missing' });
      if (action === 'revoked') { const old = f.pages.get(f.options.areaId); f.pages.set(f.options.areaId, { ...old, status: 'revoked', revision: 2, publicId: null }); }
      if (action === 'generic') response.snapshot.entries = [];
      if (action === 'offline') throw TypeError('offline');
      if (action === 'account') { f.auth.user = { id: randomUUID() }; f.auth.epoch++; }
      if (action === 'screen') f.leave();
      if (action === 'dispose') f.remote.dispose();
      return Response.json(response);
    });
    await assert.rejects(f.remote.getPublished(f.options.areaId), { code: ['missing', 'revoked'].includes(action) ? 'publication_changed' : action === 'generic' ? 'invalid_nine_public' : action === 'offline' ? 'network_error' : 'request_cancelled' });
    assert.equal(f.requests.filter(row => row.name.endsWith('_put')).length, 1); f.remote.dispose();
  }
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const Remote = require('../assets/life/blog-series-remote.js'), ShareRemote = require('../assets/life/share-remote.js');
const author = randomUUID(), blogToken = randomUUID(), seriesId = randomUUID(), ids = [randomUUID(), randomUUID()], time = '2026-10-19T00:00:00.000Z';
function fixture() {
  const calls = [], pages = new Map(), receipts = new Map(), backing = new Map(); let lose = false, active = true;
  const rows = ids.map((id, index) => ({ id: randomUUID(), revision: 2, title: '미공개 수정 제목 ' + index, publication: { token: id, blogToken, revision: 1, active: true } }));
  const auth = { ready: true, user: { id: author }, epoch: 0, config: { url: 'https://anonymous.supabase.co', key: 'sb_publishable_fixture' }, async verify() { return auth.user; },
    onAccountChange() { return () => {}; }, client: { rpc(name, args) {
      calls.push({ name, args: structuredClone(args) });
      return { abortSignal() { return this; }, async then(resolve, reject) {
        try {
          const row = pages.get(args.p_workspace_id), state = row || { status: 'missing', revision: 0, publicId: null, updatedAt: null, lastOperationId: null };
          if (name === 'life_public_page_get') return resolve({ data: state, error: null });
          assert.equal(name, 'life_public_page_put'); const key = args.p_operation_id;
          let result = receipts.get(key);
          if (!result) {
            if (args.p_expected_revision !== state.revision) result = { status: 'conflict', revision: state.revision };
            else {
              const published = args.p_action === 'publish', next = { status: published ? 'published' : 'revoked', revision: state.revision + 1,
                publicId: published ? state.status === 'published' ? state.publicId : randomUUID() : null, updatedAt: time, lastOperationId: key };
              pages.set(args.p_workspace_id, next); result = { status: 'stored', revision: next.revision, publicId: next.publicId, published, updatedAt: time, action: args.p_action }; receipts.set(key, result);
            }
          }
          if (lose) { lose = false; throw TypeError('lost reply'); }
          return resolve({ data: result, error: null });
        } catch (error) { return reject(error); }
      } };
    } } };
  const storage = { getItem: key => backing.get(key) ?? null, setItem: (key, value) => backing.set(key, value), removeItem: key => backing.delete(key) };
  const shareOwner = ShareRemote.createOwner({ auth, storage });
  const remote = Remote.create({ auth, isCurrent: () => active, shareOwner, baseURL: 'https://anonymous.example/app/index.html',
    blogRemote: { async list() { return structuredClone(rows); }, dispose() {} }, publicReader: { async read(id) { const row = rows.find(row => row.publication.token === id); return row?.publication.active ? { token: id, blogToken, revision: row.publication.revision, snapshot: { title: '현재 공개 제목 ' + ids.indexOf(id) } } : null; }, dispose() {} } });
  const series = { id: seriesId, revision: 3, title: '명시 선택 연재', intro: '공개한 글만', items: ids.map((id, index) => ({ id: 'entry-' + index, postId: 'private-local-' + index, postRevision: 5, title: '비공개 옛 제목' })) };
  return { remote, auth, calls, rows, pages, backing, receipts, series, lose() { lose = true; }, leave() { active = false; } };
}
test('owner selection is explicit, ordered by local series, allowlisted to active own publications and contains only ordinal public links', async () => {
  const f = fixture(); const list = await f.remote.ownerListPublished(); assert.equal(list[0].title, '현재 공개 제목 0');
  await assert.rejects(f.remote.prepare(f.series, []), { code: 'invalid_selection' });
  await assert.rejects(f.remote.prepare(f.series, [{ entryId: 'entry-0', token: randomUUID() }]), { code: 'invalid_selection' });
  const review = await f.remote.prepare(f.series, [{ entryId: 'entry-1', token: ids[1] }, { entryId: 'entry-0', token: ids[0] }]);
  assert.deepEqual(review.selected.map(item => item.token), ids); assert.equal(review.localRevision, 3); assert(Object.isFrozen(review.snapshot));
  const result = await f.remote.publish(review, { expectedRevision: 0 }); assert.equal(result.status, 'stored'); assert(result.url.includes('series.html?series='));
  const wire = f.calls.find(call => call.name === 'life_public_page_put').args;
  assert.equal(wire.p_workspace_id, seriesId); assert.equal(wire.p_snapshot.entries[0].title, '1편');
  for (const sentinel of ['private-local', '미공개 수정 제목', '비공개 옛 제목', 'postRevision']) assert(!JSON.stringify(wire.p_snapshot).includes(sentinel));
  assert(f.calls.every(call => call.name.startsWith('life_public_page_'))); f.remote.dispose();
});
test('changed publication or switched account refuses a reviewed selection before any publication write', async () => {
  const f = fixture(), review = await f.remote.prepare(f.series, [{ entryId: 'entry-0', token: ids[0] }]);
  f.rows[0].publication.revision++;
  await assert.rejects(f.remote.publish(review, { expectedRevision: 0 }), { code: 'selection_changed' }); assert.equal(f.calls.length, 0);
  f.auth.epoch++; f.auth.user = { id: randomUUID() };
  await assert.rejects(f.remote.publish(review, { expectedRevision: 0 }), { code: 'request_cancelled' }); assert.equal(f.calls.length, 0); f.remote.dispose();
});
test('lost response replays the exact durable operation; a historical receipt cannot report a later revoked series as published', async () => {
  const f = fixture(), review = await f.remote.prepare(f.series, [{ entryId: 'entry-0', token: ids[0] }]); f.lose();
  await assert.rejects(f.remote.publish(review, { expectedRevision: 0 }), { code: 'publish_unknown' }); assert.equal((await f.remote.getState(seriesId)).pending, true);
  const result = await f.remote.retry(seriesId); assert.equal(result.status, 'stored'); assert.equal(result.revision, 1);
  const writes = f.calls.filter(call => call.name.endsWith('_put')); assert.deepEqual(writes[0], writes[1]); assert.equal(f.receipts.size, 1);
  assert.equal((await f.remote.getState(seriesId)).pending, false);
  const second = await f.remote.prepare(f.series, [{ entryId: 'entry-1', token: ids[1] }]); f.lose();
  await assert.rejects(f.remote.publish(second, { expectedRevision: 1 }), { code: 'publish_unknown' });
  const current = f.pages.get(seriesId); f.pages.set(seriesId, { ...current, status: 'revoked', publicId: null, revision: 3 });
  const historical = await f.remote.retry(seriesId); assert.equal(historical.status, 'conflict'); assert.equal(historical.url, null); assert.equal(historical.state.status, 'revoked'); f.remote.dispose();
});
test('independent series slot leaves an existing page untouched; revoke and republish rotate only the series address', async () => {
  const f = fixture(), workspace = randomUUID(), existing = { status: 'published', revision: 7, publicId: randomUUID(), updatedAt: time, lastOperationId: randomUUID() };
  f.pages.set(workspace, existing); const review = await f.remote.prepare(f.series, [{ entryId: 'entry-0', token: ids[0] }]);
  const first = await f.remote.publish(review, { expectedRevision: 0 });
  assert.equal((await f.remote.revoke(seriesId, { expectedRevision: 1 })).state.status, 'revoked');
  const next = await f.remote.publish(review, { expectedRevision: 2 }); assert.notEqual(next.publicId, first.publicId); assert.deepEqual(f.pages.get(workspace), existing); f.remote.dispose();
});

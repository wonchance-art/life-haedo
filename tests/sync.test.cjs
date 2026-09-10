const test = require('node:test');
const assert = require('node:assert/strict');
const { createQueue, writeSnapshot } = require('../assets/sync.js');
const response = (json, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
const tick = () => new Promise(resolve => setImmediate(resolve));
test('document switches keep both pending writes and their document IDs', async () => {
  const writes = [], queue = createQueue(async id => writes.push(id), 10000);
  queue.schedule('a'); queue.schedule('b');
  assert.equal(queue.pending('a'), true); assert.equal(queue.pending('b'), true);
  await Promise.all([queue.flush('a'), queue.flush('b')]);
  assert.deepEqual(writes.sort(), ['a', 'b']); assert.equal(queue.pending('a'), false);
});
test('an edit during an in-flight write is serialized into a second write', async () => {
  let release, count = 0, active = 0, max = 0;
  const queue = createQueue(async () => { count++; active++; max = Math.max(active, max); if (count === 1) await new Promise(r => release = r); active--; });
  const first = queue.flush('a'); await tick(); const second = queue.flush('a');
  release(); await Promise.all([first, second]); assert.equal(count, 2); assert.equal(max, 1);
});
test('cancelled pending documents are not written', async () => {
  let count = 0; const queue = createQueue(async () => count++, 5);
  queue.schedule('a'); queue.cancel('a'); await new Promise(r => setTimeout(r, 15));
  assert.equal(count, 0); assert.equal(queue.pending('a'), false);
});
async function scenario(replies, seen = 'old') {
  const calls = [];
  const result = await writeSnapshot({ base: 'https://example.invalid/charts', headers: () => ({ apikey: 'test' }),
    row: { id: 'a', updated_at: 'new', data: {} }, seen,
    request: async (url, options) => { calls.push({ url, ...options() }); return replies.shift(); }
  });
  return { result, calls };
}
test('a remote change is a conflict, without an update request', async () => {
  const { result, calls } = await scenario([response([{ updated_at: 'other' }])]);
  assert.equal(result.conflict, true); assert.equal(calls.length, 1);
});
test('a remote deletion is not silently recreated', async () => {
  const { result, calls } = await scenario([response([])]);
  assert.equal(result.conflict, true); assert.equal(calls.length, 1);
});
test('conditional PATCH catches changes between reading and writing', async () => {
  const { result, calls } = await scenario([response([{ updated_at: 'old' }]), response([])]);
  assert.equal(result.conflict, true); assert.equal(calls[1].method, 'PATCH');
  assert.ok(calls[1].url.includes('&updated_at=eq.old'));
});
test('new documents use INSERT and duplicate insert races become conflicts', async () => {
  const fresh = await scenario([response([]), response({}, 409)], null);
  assert.equal(fresh.result.conflict, true); assert.equal(fresh.calls[1].method, 'POST');
  assert.equal(fresh.calls[1].headers.Prefer, 'return=representation');
});
test('successful update records the server timestamp', async () => {
  const { result } = await scenario([response([{ updated_at: 'old' }]), response([{ updated_at: 'server' }])]);
  assert.equal(result.stamp, 'server');
});
test('a failed preliminary read never falls through to an overwrite', async () => {
  let calls = 0;
  await assert.rejects(writeSnapshot({ base: 'https://example.invalid', row: { id: 'a' }, headers: () => ({}), request: async () => { calls++; return response({}, 403); } }));
  assert.equal(calls, 1);
});

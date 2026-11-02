/* Unconfirmed Share-v1 publication requests must outlive the tab that started them.
 * The owner is created exactly as the app does (no injected storage), so this covers the
 * default store. "Closing the tab" replaces sessionStorage with an empty one while the
 * browser profile's localStorage stays. The fake server keeps per-operation receipts like
 * life_public_page_put, so a replay of the same operation never writes twice. */
const test = require('node:test');
const assert = require('node:assert/strict');
const remote = require('../assets/life/share-remote.js');
const config = { url: 'https://anonymous-fixture.supabase.co', key: 'sb_publishable_fixture' };
const ids = { a: '11111111-1111-4111-8111-111111111111', b: '22222222-2222-4222-8222-222222222222',
  workspace: '33333333-3333-4333-8333-333333333333', operation: '44444444-4444-4444-8444-444444444444',
  other: '66666666-6666-4666-8666-666666666666' };
const snapshot = title => ({ format: 'life-share-v1', title, intro: null, entries: [] });
const publish = (operationId = ids.operation, title = '익명 게시 검증', expectedRevision = 0) =>
  ({ workspaceId: ids.workspace, expectedRevision, operationId, action: 'publish', snapshot: snapshot(title) });
const PREFIX = 'life_share_pending_v1:';
const keyFor = uid => PREFIX + encodeURIComponent(JSON.stringify([config.url, uid, ids.workspace]));

function area(backing = new Map()) {
  return { backing, getItem: key => backing.has(key) ? backing.get(key) : null,
    setItem: (key, value) => { backing.set(key, String(value)); }, removeItem: key => { backing.delete(key); },
    get length() { return backing.size; }, key: index => [...backing.keys()][index] ?? null };
}
const SET_ASIDE = 'life_share_pending_unread_v1:';
const setAsideOf = (backing, uid) => [...backing].filter(([key]) => key.startsWith(SET_ASIDE) &&
  JSON.parse(decodeURIComponent(key.slice(SET_ASIDE.length)))[1] === uid);
// One browser profile: localStorage is shared by every tab, sessionStorage belongs to one tab.
function browser() {
  const profile = area();
  const saved = { local: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), session: Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage') };
  const install = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  install('localStorage', profile);
  const result = {
    profile, tab: null,
    openTab(existing = area()) { result.tab = existing; install('sessionStorage', existing); return existing; },
    restore() {
      for (const [name, descriptor] of [['localStorage', saved.local], ['sessionStorage', saved.session]]) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
      }
    }
  };
  result.openTab();
  return result;
}
function server() {
  const pages = new Map(), receipts = new Map(), applied = [], calls = [];
  let loseNext = false, dropNext = false, malformNext = 0;
  function metadata(owner) {
    const row = pages.get(owner);
    return row ? { status: row.published ? 'published' : 'revoked', revision: row.revision, publicId: row.published ? row.publicId : null,
      updatedAt: row.updatedAt, lastOperationId: row.lastOperationId } : { status: 'missing', revision: 0, publicId: null, updatedAt: null, lastOperationId: null };
  }
  function handle(owner, name, args) {
    calls.push({ owner, name, operationId: args.p_operation_id || null });
    if (name === 'life_public_page_get') return metadata(owner + ':' + args.p_workspace_id);
    assert.equal(name, 'life_public_page_put');
    const id = owner + ':' + args.p_workspace_id, identity = id + ':' + args.p_operation_id;
    const payload = JSON.stringify([args.p_action, args.p_expected_revision, args.p_snapshot]), receipt = receipts.get(identity);
    if (receipt) { if (receipt.payload !== payload) throw { code: '22023', message: 'life_share_operation_mismatch' }; return structuredClone(receipt.result); }
    const row = pages.get(id);
    if ((row?.revision || 0) !== args.p_expected_revision) return { status: 'conflict', revision: row?.revision || 0 };
    const next = { revision: (row?.revision || 0) + 1, published: args.p_action === 'publish',
      publicId: args.p_action === 'publish' ? (row?.published ? row.publicId : '55555555-5555-4555-8555-' + String(applied.length + 1).padStart(12, '0')) : null,
      updatedAt: '2026-11-02T00:00:00.000Z', lastOperationId: args.p_operation_id };
    pages.set(id, next); applied.push({ owner, operationId: args.p_operation_id });
    const result = { status: 'stored', revision: next.revision, publicId: next.publicId, published: next.published, updatedAt: next.updatedAt, action: args.p_action };
    receipts.set(identity, { payload, result: structuredClone(result) });
    return result;
  }
  return {
    pages, applied, calls, loseResponse() { loseNext = true; }, dropRequest() { dropNext = true; }, malformResponses(count) { malformNext = count; },
    // The transaction commits, then the response is lost (tab closed, iOS discarded it, network cut).
    client(auth) {
      return { auth: {}, rpc(name, args) {
        const snapshotArgs = JSON.parse(JSON.stringify(args));
        return { abortSignal() { return this; }, then(resolve, reject) {
          return Promise.resolve().then(() => {
            if (name === 'life_public_page_put' && dropNext) { dropNext = false; throw new TypeError('Failed to fetch'); }
            const data = handle(auth.user.id, name, snapshotArgs);
            if (name === 'life_public_page_put' && loseNext) { loseNext = false; throw new TypeError('Failed to fetch'); }
            // A receipt shape this build cannot read (for example after a server format change).
            if (name === 'life_public_page_put' && malformNext > 0) { malformNext--; return { data: { status: 'stored', revision: data.revision }, error: null }; }
            return { data, error: null };
          }).catch(error => error instanceof TypeError ? Promise.reject(error) : { data: null, error }).then(resolve, reject);
        } };
      } };
    }
  };
}
function owner(cloud, uid) {
  const auth = { ready: true, config, epoch: 0, user: { id: uid }, async verify() { return auth.user; }, onAccountChange() { return () => {}; } };
  auth.client = cloud.client(auth);
  // Exactly the app's call: workbench-ui, public cover, 9칸 and 연재 pass no storage.
  return remote.createOwner({ auth });
}

test('an unconfirmed publish survives closing the tab and resolves on its receipt without a second write', async t => {
  const env = browser(); t.after(() => env.restore());
  const cloud = server(), first = owner(cloud, ids.a);
  cloud.loseResponse();
  await assert.rejects(first.put(publish()), { code: 'publish_unknown' });
  assert.equal(cloud.applied.length, 1, 'the server committed the publish before the response was lost');
  assert.equal(first.pending(ids.workspace).operationId, ids.operation);
  first.dispose();

  env.openTab(); // The old tab is gone: a new tab starts with empty sessionStorage.
  const reopened = owner(cloud, ids.a), before = cloud.calls.length;
  const kept = reopened.pending(ids.workspace);
  assert(kept, 'the unconfirmed request must still be known after the tab closed');
  assert.equal(kept.operationId, ids.operation); assert.equal(kept.snapshot.title, '익명 게시 검증');
  assert.equal(cloud.calls.length, before, 'reopening never re-sends or publishes on its own');
  // A different, new request cannot overwrite the unconfirmed one.
  await assert.rejects(reopened.put(publish(ids.other, '다른 새 사본')), { code: 'pending_operation' });
  assert.equal(cloud.calls.filter(call => call.name === 'life_public_page_put').length, 1);

  // The user's explicit "같은 요청 다시 확인" replays the same operation and reads its receipt.
  const result = await reopened.retryPending(ids.workspace);
  assert.equal(result.status, 'stored'); assert.equal(result.revision, 1);
  assert.equal(cloud.applied.length, 1, 'duplicate publication count must be 0');
  assert.equal(reopened.pending(ids.workspace), null);
  const head = await reopened.get(ids.workspace);
  assert.deepEqual([head.status, head.revision, head.lastOperationId], ['published', 1, ids.operation]);
  assert.equal(env.profile.backing.size, 0); reopened.dispose();
});

test('a request that never reached the server stays the one to confirm after reopening and is applied once', async t => {
  const env = browser(); t.after(() => env.restore());
  const cloud = server(), first = owner(cloud, ids.a);
  cloud.dropRequest();
  await assert.rejects(first.put(publish()), { code: 'publish_unknown' });
  assert.equal(cloud.applied.length, 0); first.dispose();
  env.openTab();
  const reopened = owner(cloud, ids.a);
  assert.equal((await reopened.get(ids.workspace)).status, 'missing');
  assert.equal(reopened.pending(ids.workspace).operationId, ids.operation, 'the reopened page still knows the outcome is unconfirmed');
  assert.equal(cloud.applied.length, 0, 'nothing is published until the user confirms the same request');
  assert.equal((await reopened.retryPending(ids.workspace)).status, 'stored');
  assert.equal((await reopened.retryPending(ids.workspace).catch(error => error.code)), 'pending_resolved', 'a resolved request cannot be replayed again');
  assert.equal(cloud.applied.length, 1); assert.equal(reopened.pending(ids.workspace), null); reopened.dispose();
});

test('another account never reads, blocks or clears the first account\'s unconfirmed request', async t => {
  const env = browser(); t.after(() => env.restore());
  const cloud = server(), a = owner(cloud, ids.a);
  cloud.loseResponse();
  await assert.rejects(a.put(publish()), { code: 'publish_unknown' }); a.dispose();
  env.openTab();
  const b = owner(cloud, ids.b);
  assert.equal(b.pending(ids.workspace), null, 'account B must not see account A\'s request');
  const own = await b.put(publish(ids.other, 'B 계정 사본'));
  assert.equal(own.status, 'stored'); assert.equal(b.pending(ids.workspace), null); b.dispose();
  assert(env.profile.backing.has(keyFor(ids.a)), 'A\'s record stays after B used the same browser');
  assert(!env.profile.backing.has(keyFor(ids.b)));
  env.openTab();
  const back = owner(cloud, ids.a);
  assert.equal(back.pending(ids.workspace).operationId, ids.operation);
  assert.equal((await back.retryPending(ids.workspace)).status, 'stored');
  assert.deepEqual(cloud.applied.map(item => item.owner), [ids.a, ids.b]); back.dispose();
});

test('a record kept per tab by an earlier build moves to the persistent store and is not resent', async t => {
  const env = browser(); t.after(() => env.restore());
  const cloud = server(), seed = owner(cloud, ids.a);
  cloud.loseResponse();
  await assert.rejects(seed.put(publish()), { code: 'publish_unknown' }); seed.dispose();
  // Rebuild the earlier layout: the same record only in this tab's sessionStorage.
  const serialized = env.profile.backing.get(keyFor(ids.a)); assert(serialized);
  env.profile.backing.clear(); const tab = env.openTab(); tab.setItem(keyFor(ids.a), serialized);
  const calls = cloud.calls.length, migrated = owner(cloud, ids.a);
  assert.equal(migrated.pending(ids.workspace).operationId, ids.operation);
  assert.equal(env.profile.backing.get(keyFor(ids.a)), serialized, 'the earlier record is copied unchanged');
  assert.equal(tab.getItem(keyFor(ids.a)), null, 'and removed from the tab store only after the copy is verified');
  assert.equal(cloud.calls.length, calls); migrated.dispose();
  env.openTab();
  const reopened = owner(cloud, ids.a);
  assert.equal(reopened.pending(ids.workspace).operationId, ids.operation);
  assert.equal((await reopened.retryPending(ids.workspace)).status, 'stored');
  assert.equal(cloud.applied.length, 1); assert.equal(reopened.pending(ids.workspace), null); reopened.dispose();
});

test('a failed migration copy keeps the earlier record in the tab and still blocks a different request', async t => {
  const env = browser(); t.after(() => env.restore());
  const cloud = server(), tab = env.openTab(), serialized = JSON.stringify(publish());
  tab.setItem(keyFor(ids.a), serialized);
  const setItem = env.profile.setItem; env.profile.setItem = () => { throw new Error('quota'); };
  const blocked = owner(cloud, ids.a);
  assert.equal(blocked.pending(ids.workspace).operationId, ids.operation);
  assert.equal(tab.getItem(keyFor(ids.a)), serialized, 'the only copy stays in the tab when the persistent write fails');
  await assert.rejects(blocked.put(publish(ids.other)), { code: 'pending_operation' }); blocked.dispose();
  env.profile.setItem = setItem; assert.equal(cloud.calls.length, 0);
});

test('an unreadable record is set aside unchanged, unblocks the target once, and leaves other accounts alone', async t => {
  const env = browser(); t.after(() => env.restore());
  const cloud = server(), other = JSON.stringify(publish(ids.other, 'B 계정 기록'));
  env.profile.setItem(keyFor(ids.b), other);
  const cases = [['broken JSON', '{"broken"', 'local'], ['record of another target', JSON.stringify({ ...publish(), workspaceId: ids.other }), 'local'], ['earlier tab copy', '{"tab"', 'tab']];
  for (const [index, [label, text, where]] of cases.entries()) {
    for (const key of [...env.profile.backing.keys()]) if (key !== keyFor(ids.b)) env.profile.backing.delete(key);
    const tab = env.openTab(); (where === 'tab' ? tab : env.profile).setItem(keyFor(ids.a), text);
    const reopened = owner(cloud, ids.a), puts = cloud.applied.length;
    assert.equal(reopened.pending(ids.workspace), null, label + ': the target is no longer blocked');
    assert.equal(env.profile.getItem(keyFor(ids.a)), null); assert.equal(tab.getItem(keyFor(ids.a)), null);
    const kept = setAsideOf(env.profile.backing, ids.a);
    assert.equal(kept.length, 1, label); assert.equal(kept[0][1], text, label + ': the original text is preserved');
    assert.equal(reopened.takeSetAside(ids.workspace), true); assert.equal(reopened.takeSetAside(ids.workspace), false);
    assert.equal(cloud.applied.length, puts, 'setting aside never sends anything');
    const head = await reopened.get(ids.workspace), operationId = '77777777-7777-4777-8777-00000000000' + index;
    assert.equal((await reopened.put(publish(operationId, '격리 뒤 새 요청', head.revision))).status, 'stored');
    assert.equal(env.profile.getItem(keyFor(ids.b)), other, 'account B record untouched');
    assert.equal(setAsideOf(env.profile.backing, ids.b).length, 0); reopened.dispose();
  }
  // When even the set-aside copy cannot be written, nothing is dropped and nothing is sent.
  env.profile.backing.clear(); env.openTab(); env.profile.setItem(keyFor(ids.a), '{"broken"');
  const setItem = env.profile.setItem; env.profile.setItem = () => { throw new Error('quota'); };
  const full = owner(cloud, ids.a), calls = cloud.calls.length;
  assert.throws(() => full.pending(ids.workspace), { code: 'pending_corrupt' });
  await assert.rejects(full.put(publish(ids.other)), { code: 'pending_corrupt' });
  assert.equal(env.profile.getItem(keyFor(ids.a)), '{"broken"'); assert.equal(cloud.calls.length, calls);
  env.profile.setItem = setItem; full.dispose();
});

test('a stricter snapshot rule in a later build still resolves the saved request on its receipt, then revocation works', async t => {
  const env = browser(); t.after(() => env.restore());
  const cloud = server(), first = owner(cloud, ids.a);
  cloud.loseResponse(); await assert.rejects(first.put(publish()), { code: 'publish_unknown' }); first.dispose();
  const saved = env.profile.getItem(keyFor(ids.a)), sent = cloud.calls.length;
  const life = globalThis.HaedoLife, real = require('../assets/life/share.js');
  globalThis.HaedoLife = { ...life, Share: { ...real, validate() { throw Object.assign(new Error('a later rule rejects this snapshot'), { code: 'invalid_snapshot' }); } } };
  t.after(() => { globalThis.HaedoLife = life; });
  env.openTab();
  const later = owner(cloud, ids.a);
  assert.equal(later.pending(ids.workspace).operationId, ids.operation, 'still the request to confirm');
  assert.equal(env.profile.getItem(keyFor(ids.a)), saved, 'the saved record is untouched by reading it');
  await assert.rejects(later.put({ workspaceId: ids.workspace, expectedRevision: 0, operationId: ids.other, action: 'revoke', snapshot: null }), { code: 'pending_operation' });
  assert.equal((await later.retryPending(ids.workspace)).status, 'stored');
  const replay = cloud.calls.slice(sent).filter(call => call.name === 'life_public_page_put');
  assert.equal(replay.length, 1); assert.equal(replay[0].operationId, ids.operation);
  assert.equal(cloud.applied.length, 1); assert.equal(later.pending(ids.workspace), null);
  await assert.rejects(later.put(publish(ids.other, '새 규칙의 새 요청', 1)), { code: 'invalid_snapshot' }, 'new requests keep the current rule');
  const revoked = await later.put({ workspaceId: ids.workspace, expectedRevision: 1, operationId: ids.other, action: 'revoke', snapshot: null });
  assert.equal(revoked.status, 'stored'); assert.equal(revoked.published, false); later.dispose();
});

test('a replay the server cannot match or answer readably is set aside, so revocation is possible again', async t => {
  for (const mode of ['mismatch', 'unreadable receipt']) {
    await t.test(mode, async t => {
      const env = browser(); t.after(() => env.restore());
      const cloud = server(), first = owner(cloud, ids.a);
      env.profile.setItem(keyFor(ids.b), 'B 계정의 다른 기록');
      if (mode === 'mismatch') {
        cloud.loseResponse(); await assert.rejects(first.put(publish()), { code: 'publish_unknown' });
        const value = JSON.parse(env.profile.getItem(keyFor(ids.a))); value.snapshot.title = '저장 뒤 바뀐 사본';
        env.profile.setItem(keyFor(ids.a), JSON.stringify(value));
      } else {
        cloud.malformResponses(2); await assert.rejects(first.put(publish()), { code: 'publish_unknown' });
        assert(first.pending(ids.workspace), 'one unreadable answer alone keeps the request to confirm');
      }
      const text = env.profile.getItem(keyFor(ids.a));
      await assert.rejects(first.retryPending(ids.workspace), { code: 'replay_unresolved' });
      assert.equal(first.pending(ids.workspace), null); assert.equal(first.takeSetAside(ids.workspace), false, 'the replay error already told the user');
      assert.deepEqual(setAsideOf(env.profile.backing, ids.a).map(([, value]) => value), [text]);
      assert.equal(env.profile.getItem(keyFor(ids.b)), 'B 계정의 다른 기록');
      const head = await first.get(ids.workspace); assert.equal(head.status, 'published');
      const revoked = await first.put({ workspaceId: ids.workspace, expectedRevision: head.revision, operationId: ids.other, action: 'revoke', snapshot: null });
      assert.equal(revoked.status, 'stored'); assert.equal(cloud.applied.length, 2); first.dispose();
    });
  }
});

test('a request another tab already confirmed reports that fact instead of a format error and writes nothing', async t => {
  const env = browser(); t.after(() => env.restore());
  const cloud = server(), a = owner(cloud, ids.a), b = owner(cloud, ids.a);
  cloud.loseResponse(); await assert.rejects(a.put(publish()), { code: 'publish_unknown' });
  assert.equal((await b.retryPending(ids.workspace)).status, 'stored');
  const writes = cloud.calls.filter(call => call.name === 'life_public_page_put').length;
  const error = await a.retryPending(ids.workspace).catch(cause => cause);
  assert.equal(error.code, 'pending_resolved'); assert.match(error.message, /다른 화면에서 이미 확인/);
  assert.equal(cloud.calls.filter(call => call.name === 'life_public_page_put').length, writes);
  assert.equal(env.profile.backing.size, 0); a.dispose(); b.dispose();
});

test('new requests stop at the pending count and size bounds without touching existing records', async t => {
  const env = browser(); t.after(() => env.restore());
  const cloud = server(), o = owner(cloud, ids.a), { count, characters } = o.LIMITS;
  const target = index => '77777777-7777-4777-8777-' + String(index).padStart(12, '0');
  const keyOf = id => PREFIX + encodeURIComponent(JSON.stringify([config.url, ids.a, id]));
  for (let index = 0; index < count; index++) env.profile.setItem(keyOf(target(index)), JSON.stringify({ ...publish(target(index)), workspaceId: target(index) }));
  const before = new Map(env.profile.backing);
  const error = await o.put(publish()).catch(cause => cause);
  assert.equal(error.code, 'pending_limit_count'); assert.match(error.message, /새 요청을 보내지 않았습니다/);
  assert.deepEqual(env.profile.backing, before); assert.equal(cloud.calls.length, 0);
  env.profile.backing.clear();
  const big = 'ㄱ'.repeat(Math.ceil(characters / 2));
  for (const index of [0, 1]) env.profile.setItem(keyOf(target(index)), JSON.stringify({ ...publish(target(index), big), workspaceId: target(index) }));
  const sized = new Map(env.profile.backing);
  await assert.rejects(o.put(publish()), { code: 'pending_limit_size' });
  assert.deepEqual(env.profile.backing, sized); assert.equal(cloud.calls.length, 0);
  env.profile.removeItem(keyOf(target(1)));
  assert.equal((await o.put(publish())).status, 'stored'); o.dispose();
});

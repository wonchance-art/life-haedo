'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js'), Core = require('../assets/life/core.js'), Photo = require('../assets/life/photo-post.js'), Blog = require('../assets/life/blog.js');
const owner = { projectUrl: 'https://account-blog-test.supabase.co', userId: 'synthetic-owner' };
const copy = value => structuredClone(value), key = value => JSON.stringify(value);
// Serialized decision/rollback adapter. Native two-tab IDB is independently tested.
function adapter() {
  const rows = new Map(), paths = new Map(), control = { writes: [], fail: null, afterWrite: null }; let tail = Promise.resolve();
  return { rows, control, idb: { async openDB(_name, _version, callbacks) {
    let closed = false;
    const db = {
      objectStoreNames: { contains: name => rows.has(name) },
      createObjectStore(name, options) { rows.set(name, new Map()); paths.set(name, options.keyPath); return { createIndex() {} }; },
      close() { closed = true; },
      transaction(names, mode) {
        if (closed) throw new DOMException('closed', 'InvalidStateError');
        let resolve, reject, ended = false, working;
        const done = new Promise((yes, no) => { resolve = yes; reject = no; }), previous = tail;
        tail = done.catch(() => {});
        function abort(error = new DOMException('aborted', 'AbortError')) { if (!ended) { ended = true; reject(error); } }
        const ready = previous.then(() => {
          if (ended) return; working = new Map(names.map(name => [name, copy(rows.get(name))]));
          setImmediate(() => { if (ended) return; ended = true; if (mode === 'readwrite') for (const [name, data] of working) rows.set(name, data); resolve(); });
        });
        async function request(name, method, value) {
          await ready; if (ended) throw new DOMException('inactive', 'AbortError');
          const store = working.get(name);
          if (method === 'get') return copy(store.get(key(value)));
          if (method === 'getAll') return copy([...store.values()]);
          if (method === 'getAllKeys') return [...store.keys()].map(value => JSON.parse(value));
          if (method === 'getKey') return store.has(key(value)) ? copy(value) : undefined;
          assert.equal(mode, 'readwrite');
          const path = paths.get(name), id = method === 'delete' ? value : Array.isArray(path) ? path.map(field => value[field]) : value[path];
          const write = { name, method, id, value }; control.writes.push(copy(write));
          if (control.fail?.(write)) { control.fail = null; const error = new DOMException('quota', 'QuotaExceededError'); abort(error); throw error; }
          if (method === 'add' && store.has(key(id))) throw new DOMException('duplicate', 'ConstraintError');
          if (method === 'delete') store.delete(key(id)); else store.set(key(id), copy(value)); control.afterWrite?.(write); return id;
        }
        return { done, abort, objectStore(name) { return {
          get: value => request(name, 'get', value), getAll: () => request(name, 'getAll'), getAllKeys: () => request(name, 'getAllKeys'), getKey: value => request(name, 'getKey', value),
          put: value => request(name, 'put', value), add: value => request(name, 'add', value), delete: value => request(name, 'delete', value)
        }; } };
      }
    };
    if (!rows.size) callbacks.upgrade(db, 0, 1); return db;
  } } };
}
async function fixture(t) {
  const f = adapter(), options = { idb: f.idb, core: Core, channelFactory: null, account: owner };
  const a = createStorage(options), b = createStorage(options), foreign = createStorage({ ...options, account: { ...owner, userId: 'synthetic-other' } });
  t.after(() => { a.close(); b.close(); foreign.close(); });
  const bundle = await a.createWorkspace('내 여행 글');
  const doc = Photo.create(Core.id); doc.status = 'saved'; doc.title = '사진 없는 정확한 여행 글'; doc.ops = [{ insert: '원래 본문\r\n🌿\n' }];
  const remoteId = Core.id(), state = { enabled: true, remoteId, remoteWorkspaceId: Core.id(), remoteRevision: 4, localRevision: 0,
    remoteManifest: { ...Blog.pack(doc), id: remoteId, revision: 4 }, publication: null, pending: null, conflict: null, status: 'synced', error: null };
  return { ...f, a, b, foreign, ws: bundle.workspaceId, doc, state, receiptKey: `blog-received:${bundle.workspaceId}:${remoteId}` };
}

test('first account receipt installs the post, index and binding together; repeat and concurrent tabs reopen one exact copy', async t => {
  const f = await fixture(t), before = await f.a.read(f.ws), active = await f.a.getActive(), events = [];
  f.a.subscribe(f.ws, event => events.push(event));
  const another = { ...copy(f.doc), id: Core.id() };
  const [one, two] = await Promise.all([f.a.installReceivedBlogPost(f.ws, f.doc, f.state), f.b.installReceivedBlogPost(f.ws, another, f.state)]);
  assert.equal(one.post.id, two.post.id); assert.equal(Number(one.received) + Number(two.received), 1);
  assert.equal((await f.a.listPhotoPosts(f.ws)).length, 1); assert.deepEqual(await f.a.read(f.ws), before); assert.equal(await f.a.getActive(), active);
  assert.equal((await f.a.listBlogCopies(f.ws))[0].remoteId, f.state.remoteId);
  const receipt = f.rows.get('meta').get(key(f.receiptKey)).value;
  assert.deepEqual(receipt, { owner, remoteId: f.state.remoteId, localPostId: one.post.id });
  const rows = copy(f.rows), count = f.control.writes.length;
  const repeated = await f.b.installReceivedBlogPost(f.ws, another, f.state);
  assert.equal(repeated.received, false); assert.deepEqual(f.rows, rows); assert.equal(f.control.writes.length, count); assert.equal(events.length, 1);
});

test('binding or last receipt failure rolls back every partial row and the same request remains retryable', async t => {
  for (const point of ['binding', 'receipt']) {
    const f = await fixture(t), before = copy(f.rows), events = []; f.a.subscribe(f.ws, e => events.push(e));
    f.control.fail = write => write.name === 'meta' && write.id === (point === 'receipt' ? f.receiptKey : `blog-sync:${f.ws}:${f.doc.id}`);
    await assert.rejects(f.a.installReceivedBlogPost(f.ws, f.doc, f.state), { code: 'storage_quota' });
    assert.deepEqual(f.rows, before); assert.deepEqual(events, []); assert.deepEqual(await f.a.listBlogCopies(f.ws), []);
    assert.equal((await f.b.installReceivedBlogPost(f.ws, f.doc, f.state)).received, true);
  }
});

test('saved replacement atomically carries the receive receipt and paused canonical binding to the new local identity', async t => {
  const f = await fixture(t), installed = await f.a.installReceivedBlogPost(f.ws, f.doc, f.state), saved = installed.post;
  const prior = await f.a.readBlogSyncState(f.ws, saved.id); await f.a.writeBlogSyncState(f.ws, saved.id, { ...prior, enabled: false, status: 'paused' }, prior.revision);
  const draft = { ...copy(saved), id: Core.id(), revision: 0, replaces: { id: saved.id, revision: saved.revision }, title: '내 수정본' };
  const before = copy(f.rows); f.control.fail = write => write.id === f.receiptKey;
  await assert.rejects(f.a.savePhotoPost(f.ws, draft, 0), { code: 'storage_quota' }); assert.deepEqual(f.rows, before);
  const edited = await f.a.savePhotoPost(f.ws, draft, 0), binding = await f.a.readBlogSyncState(f.ws, edited.id);
  assert.equal(binding.remoteId, f.state.remoteId); assert.equal(binding.enabled, false); assert.equal(binding.localRevision, 0);
  assert.equal(f.rows.get('meta').get(key(f.receiptKey)).value.localPostId, edited.id);
  const reopened = await f.b.installReceivedBlogPost(f.ws, { ...f.doc, id: Core.id() }, f.state);
  assert.equal(reopened.post.id, edited.id); assert.equal(reopened.post.title, '내 수정본'); assert.equal(reopened.received, false);
  assert.equal((await f.a.listPhotoPosts(f.ws)).length, 1);
});

test('origin bindings need no receive receipt; explicit copies remain multiple and cannot be chosen implicitly', async t => {
  const f = await fixture(t), original = await f.a.savePhotoPost(f.ws, f.doc, 0);
  await f.a.writeBlogSyncState(f.ws, original.id, { ...f.state, localRevision: original.revision });
  const reopened = await f.a.installReceivedBlogPost(f.ws, { ...f.doc, id: Core.id() }, f.state);
  assert.equal(reopened.received, false); assert.equal(reopened.post.id, original.id); assert.equal(f.rows.get('meta').has(key(f.receiptKey)), false);
  const other = await f.a.savePhotoPost(f.ws, { ...f.doc, id: Core.id() }, 0);
  await f.a.writeBlogSyncState(f.ws, other.id, { ...f.state, localRevision: other.revision });
  const before = copy(f.rows);
  await assert.rejects(f.b.installReceivedBlogPost(f.ws, { ...f.doc, id: Core.id() }, f.state), { code: 'blog_copy_selection_required' });
  assert.deepEqual(f.rows, before); assert.equal((await f.a.listBlogCopies(f.ws)).length, 2);
});

test('foreign ownership, disposed scope and caller cancellation abort installation even at the final receipt write', async t => {
  const f = await fixture(t), before = copy(f.rows);
  await assert.rejects(f.foreign.listBlogCopies(f.ws), { code: 'workspace_access_denied' });
  await assert.rejects(f.foreign.installReceivedBlogPost(f.ws, f.doc, f.state), { code: 'workspace_access_denied' });
  let current = true; f.control.afterWrite = write => { if (write.id === f.receiptKey) current = false; };
  await assert.rejects(f.a.installReceivedBlogPost(f.ws, f.doc, f.state, { isCurrent: () => current }), { code: 'request_cancelled' });
  assert.deepEqual(f.rows, before);
  f.control.afterWrite = write => { if (write.id === f.receiptKey) f.a.dispose(); };
  await assert.rejects(f.a.installReceivedBlogPost(f.ws, f.doc, f.state), { code: 'storage_scope_closed' }); assert.deepEqual(f.rows, before);
  f.control.afterWrite = null; assert.equal((await f.b.installReceivedBlogPost(f.ws, f.doc, f.state)).received, true);
});

test('catalog reads only the selected owned workspace and a dangling receipt never silently creates another copy', async t => {
  const f = await fixture(t); await f.a.installReceivedBlogPost(f.ws, f.doc, f.state);
  const other = await f.a.createWorkspace('별도 공간'); assert.deepEqual(await f.a.listBlogCopies(other.workspaceId), []);
  const receipt = f.rows.get('meta').get(key(f.receiptKey)).value;
  f.rows.get('meta').delete(key(`blog-sync:${f.ws}:${receipt.localPostId}`)); const before = copy(f.rows);
  await assert.rejects(f.a.installReceivedBlogPost(f.ws, { ...f.doc, id: Core.id() }, f.state), { code: 'photo_post_missing' });
  assert.deepEqual(f.rows, before); assert.equal((await f.a.listPhotoPosts(f.ws)).length, 1);
});

test('inspection metadata checks the current local post inside its transaction and aborts when its focused caller leaves after put', async t => {
  const f = await fixture(t), installed = await f.a.installReceivedBlogPost(f.ws, f.doc, f.state), id = installed.post.id;
  const state = await f.a.readBlogSyncState(f.ws, id), next = { ...state, status: 'conflict', conflict: { remoteRevision: 5, localRevision: installed.post.revision } };
  const before = copy(f.rows);
  await assert.rejects(f.a.writeBlogSyncState(f.ws, id, next, state.revision, { expectedLocalRevision: installed.post.revision + 1 }), { code: 'local_changed' });
  assert.deepEqual(f.rows, before);
  let current = true;
  f.control.afterWrite = write => { if (write.id === `blog-sync:${f.ws}:${id}`) current = false; };
  await assert.rejects(f.a.writeBlogSyncState(f.ws, id, next, state.revision, { expectedLocalRevision: installed.post.revision, isCurrent: () => current }), { code: 'request_cancelled' });
  assert.deepEqual(f.rows, before);
  f.control.afterWrite = null; current = true;
  const confirmed = await f.a.writeBlogSyncState(f.ws, id, next, state.revision, { expectedLocalRevision: installed.post.revision, isCurrent: () => current });
  assert.equal(confirmed.conflict.remoteRevision, 5); assert.equal(confirmed.revision, state.revision + 1);
  assert.deepEqual(await f.a.readPhotoPost(f.ws, id), installed.post);
});

// ---- Account-wide sync helpers (2026-11-01) ----
const remoteBinding = (f, id, revision = 2) => ({ enabled: true, remoteId: id, remoteWorkspaceId: f.ws, remoteRevision: revision, localRevision: 0,
  remoteManifest: null, publication: null, pending: null, conflict: null, status: 'synced', error: null });

test('sync install writes the post in place with its binding atomically, and a failed binding write leaves nothing', async t => {
  const f = await fixture(t), id = Core.id(), doc = { ...copy(f.doc), id }, events = [];
  f.a.subscribe(f.ws, event => events.push(event.type));
  const before = copy(f.rows);
  f.control.fail = write => write.id === `blog-sync:${f.ws}:${id}`;
  await assert.rejects(f.a.commitBlogSync(f.ws, { postId: id, post: doc, baseRevision: 0, binding: remoteBinding(f, id), bindingRevision: 0 }), { code: 'storage_quota' });
  assert.deepEqual(f.rows, before); assert.deepEqual(events, []);
  const result = await f.a.commitBlogSync(f.ws, { postId: id, post: doc, baseRevision: 0, binding: remoteBinding(f, id), bindingRevision: 0 });
  assert.equal(result.revision, 1);
  const state = await f.a.readBlogSyncState(f.ws, id);
  assert.equal(state.localRevision, 1); assert.equal(state.revision, 1); assert.equal(state.remoteRevision, 2);
  assert.equal((await f.a.readPhotoPost(f.ws, id)).id, id); assert.deepEqual(events, ['photo_posts_changed']);
  const listed = await f.a.listBlogSyncStates(f.ws);
  assert.deepEqual(listed.posts.map(row => row.id), [id]); assert.equal(listed.states[0].localPostId, id); assert.deepEqual(listed.tombstones, []);
  await assert.rejects(f.b.commitBlogSync(f.ws, { postId: id, post: doc, baseRevision: 0, binding: remoteBinding(f, id), bindingRevision: 0 }), { code: 'blog_state_conflict' });
  await assert.rejects(f.foreign.listBlogSyncStates(f.ws), { code: 'workspace_access_denied' });
});

test('a conflict keeps the losing side as a new draft in the same transaction as the in-place update', async t => {
  const f = await fixture(t), id = Core.id(), doc = { ...copy(f.doc), id };
  await f.a.commitBlogSync(f.ws, { postId: id, post: doc, baseRevision: 0, binding: remoteBinding(f, id), bindingRevision: 0 });
  const local = await f.a.readPhotoPost(f.ws, id);
  const kept = { ...copy(local), id: Core.id(), revision: 0, status: 'draft', title: '복구 사본 · ' + local.title };
  const remote = { ...copy(local), title: '다른 기기의 최신 글' };
  f.control.fail = write => write.id === `photo-post:${f.ws}:${kept.id}`;
  const before = copy(f.rows);
  await assert.rejects(f.a.commitBlogSync(f.ws, { postId: id, post: remote, baseRevision: 1, binding: remoteBinding(f, id, 3), bindingRevision: 1, copy: kept }), { code: 'storage_quota' });
  assert.deepEqual(f.rows, before);
  await f.a.commitBlogSync(f.ws, { postId: id, post: remote, baseRevision: 1, binding: remoteBinding(f, id, 3), bindingRevision: 1, copy: kept });
  assert.equal((await f.a.readPhotoPost(f.ws, id)).title, '다른 기기의 최신 글');
  assert.equal((await f.a.readPhotoPost(f.ws, kept.id)).status, 'draft');
  assert.equal(await f.a.readBlogSyncState(f.ws, kept.id), null, 'the kept draft starts unbound and syncs as its own post');
  await assert.rejects(f.a.commitBlogSync(f.ws, { postId: id, post: remote, baseRevision: 1, binding: remoteBinding(f, id, 4), bindingRevision: 2 }), { code: 'photo_post_conflict' });
});

test('a conflict keeps the server version in place with an exact editing draft and a recovery copy, all in one transaction', async t => {
  const f = await fixture(t), id = Core.id(), doc = { ...copy(f.doc), id };
  await f.a.commitBlogSync(f.ws, { postId: id, post: doc, baseRevision: 0, binding: remoteBinding(f, id), bindingRevision: 0 });
  const local = await f.a.readPhotoPost(f.ws, id);
  const server = { ...copy(local), title: '다른 기기 완성' };
  const kept = { ...copy(server), id: Core.id(), revision: 0, status: 'draft', title: '복구 사본 · 다른 기기 완성' };
  const later = { ...copy(local), id: Core.id(), revision: 0, status: 'draft', title: '이 기기의 최신 초안', replaces: { id, revision: 2 } };
  const input = { postId: id, post: server, baseRevision: 1, binding: remoteBinding(f, id, 3), bindingRevision: 1, copy: kept, edit: later };
  for (const bad of [{ post: undefined }, { edit: { ...later, replaces: { id, revision: 1 } } }, { edit: { ...later, replaces: null } }, { edit: { ...later, id: kept.id } }, { edit: { ...later, status: 'saved' } }])
    await assert.rejects(f.a.commitBlogSync(f.ws, { ...input, ...bad }), { code: 'invalid_blog_state' });
  f.control.fail = write => write.id === `photo-post:${f.ws}:${later.id}`;
  const before = copy(f.rows);
  await assert.rejects(f.a.commitBlogSync(f.ws, input), { code: 'storage_quota' });
  assert.deepEqual(f.rows, before, 'nothing is half applied');
  await f.a.commitBlogSync(f.ws, input);
  const placed = await f.a.readPhotoPost(f.ws, id), state = await f.a.readBlogSyncState(f.ws, id);
  assert.equal(placed.title, '다른 기기 완성'); assert.equal(placed.revision, 2);
  assert.equal(state.localRevision, 2, 'the post is the exact server version'); assert.equal(state.remoteRevision, 3);
  assert.deepEqual((await f.a.readPhotoPost(f.ws, later.id)).replaces, { id, revision: 2 }, 'the later draft edits that exact revision');
  assert.equal((await f.a.readPhotoPost(f.ws, kept.id)).title, '복구 사본 · 다른 기기 완성');
  assert.equal(await f.a.readBlogSyncState(f.ws, later.id), null);
});

test('a conflict may rewrite an existing editing draft at its exact revision and keep two recovery copies in one transaction', async t => {
  const f = await fixture(t), id = Core.id(), doc = { ...copy(f.doc), id };
  await f.a.commitBlogSync(f.ws, { postId: id, post: doc, baseRevision: 0, binding: remoteBinding(f, id), bindingRevision: 0 });
  const local = await f.a.readPhotoPost(f.ws, id);
  const other = await f.a.savePhotoPost(f.ws, { ...copy(local), id: Core.id(), revision: 0, status: 'draft', title: '다른 기기 초안', replaces: { id, revision: 0 } }, 0);
  const server = { ...copy(local), title: '저장 판' };
  const kept = { ...copy(server), id: Core.id(), revision: 0, status: 'draft', title: '복구 사본 · 저장 판' };
  const lost = { ...copy(other), id: Core.id(), revision: 0, replaces: null, title: '복구 사본 · 다른 기기 초안' };
  const later = { ...copy(other), title: '이 기기 초안', replaces: { id, revision: 2 } };
  const input = { postId: id, post: server, baseRevision: 1, binding: remoteBinding(f, id, 3), bindingRevision: 1, copy: [kept, lost], edit: later };
  for (const bad of [{ copy: [] }, { copy: [kept, lost, { ...lost, id: Core.id() }] }, { copy: [kept, kept] }, { edit: { ...later, revision: 0 } }])
    await assert.rejects(f.a.commitBlogSync(f.ws, { ...input, ...bad }), { code: /invalid_blog_state|photo_post_conflict/ });
  assert.equal((await f.a.readPhotoPost(f.ws, id)).revision, 1, 'refused requests change nothing');
  await f.a.commitBlogSync(f.ws, input);
  const rewritten = await f.a.readPhotoPost(f.ws, other.id);
  assert.equal(rewritten.title, '이 기기 초안'); assert.equal(rewritten.revision, other.revision + 1); assert.deepEqual(rewritten.replaces, { id, revision: 2 });
  assert.equal((await f.a.readPhotoPost(f.ws, kept.id)).title, '복구 사본 · 저장 판');
  assert.equal((await f.a.readPhotoPost(f.ws, lost.id)).title, '복구 사본 · 다른 기기 초안');
});

test('explicit deletion records a deletion for a stored post, refuses a published one and is never re-received', async t => {
  const f = await fixture(t), id = Core.id(), doc = { ...copy(f.doc), id };
  await f.a.commitBlogSync(f.ws, { postId: id, post: doc, baseRevision: 0, binding: { ...remoteBinding(f, id), publication: { token: Core.id(), blogToken: Core.id(), revision: 1, active: true } }, bindingRevision: 0 });
  await assert.rejects(f.a.deletePhotoPost(f.ws, id, 1), { code: 'blog_post_published' });
  const state = await f.a.readBlogSyncState(f.ws, id);
  await f.a.writeBlogSyncState(f.ws, id, { ...state, publication: { ...state.publication, active: false, revision: 2 } }, state.revision);
  await assert.rejects(f.a.deletePhotoPost(f.ws, id, 5), { code: 'photo_post_conflict' });
  assert.deepEqual(await f.a.deletePhotoPost(f.ws, id, 1), { postId: id, remoteId: id });
  const listed = await f.a.listBlogSyncStates(f.ws);
  assert.deepEqual(listed.posts, []); assert.deepEqual(listed.states, []); assert.deepEqual(listed.tombstones.map(item => item.remoteId), [id]);
  await assert.rejects(f.a.commitBlogSync(f.ws, { postId: id, post: doc, baseRevision: 0, binding: remoteBinding(f, id), bindingRevision: 0 }), { code: 'blog_post_deleted' });
  await f.a.clearBlogTombstone(f.ws, id);
  assert.deepEqual((await f.a.listBlogSyncStates(f.ws)).tombstones, []);
  const local = await f.a.savePhotoPost(f.ws, { ...copy(f.doc), id: Core.id() }, 0);
  await f.a.deletePhotoPost(f.ws, local.id, local.revision);
  assert.deepEqual((await f.a.listBlogSyncStates(f.ws)).tombstones, [], 'a never-sent post needs no server deletion');
});

test('saving an editing draft that synced on its own keeps the target server identity and retires the draft on the server', async t => {
  const f = await fixture(t), id = Core.id();
  await f.a.commitBlogSync(f.ws, { postId: id, post: { ...copy(f.doc), id }, baseRevision: 0, binding: remoteBinding(f, id), bindingRevision: 0 });
  const target = await f.a.readPhotoPost(f.ws, id);
  const draft = await f.a.savePhotoPost(f.ws, { ...copy(target), id: Core.id(), revision: 0, status: 'draft', replaces: { id, revision: target.revision }, title: '고치는 중' }, 0);
  await f.a.writeBlogSyncState(f.ws, draft.id, { ...remoteBinding(f, draft.id, 1), localRevision: draft.revision }, 0);
  const saved = await f.a.savePhotoPost(f.ws, { ...copy(draft), status: 'saved' }, draft.revision);
  const binding = await f.a.readBlogSyncState(f.ws, saved.id);
  assert.equal(binding.remoteId, id); assert.equal(binding.localRevision, 0); assert.equal(binding.revision, 2);
  assert.equal(await f.a.readBlogSyncState(f.ws, id), null);
  assert.deepEqual((await f.a.listBlogSyncStates(f.ws)).tombstones, [{ remoteId: draft.id, remoteWorkspaceId: f.ws, reason: 'replaced', remoteRevision: 1, pendingRevision: null }]);
});

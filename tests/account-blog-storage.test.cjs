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
          assert.equal(mode, 'readwrite');
          const path = paths.get(name), id = method === 'delete' ? value : Array.isArray(path) ? path.map(field => value[field]) : value[path];
          const write = { name, method, id, value }; control.writes.push(copy(write));
          if (control.fail?.(write)) { control.fail = null; const error = new DOMException('quota', 'QuotaExceededError'); abort(error); throw error; }
          if (method === 'add' && store.has(key(id))) throw new DOMException('duplicate', 'ConstraintError');
          if (method === 'delete') store.delete(key(id)); else store.set(key(id), copy(value)); control.afterWrite?.(write); return id;
        }
        return { done, abort, objectStore(name) { return {
          get: value => request(name, 'get', value), getAll: () => request(name, 'getAll'), getAllKeys: () => request(name, 'getAllKeys'),
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

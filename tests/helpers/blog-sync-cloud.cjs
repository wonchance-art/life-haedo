'use strict';
/* Two or more synthetic devices of one account: each has its own real Storage
 * (serialized in-memory IndexedDB adapter) and BlogSync; they share only a
 * synthetic private blog server that follows the SQL CAS/receipt/deletion
 * rules of supabase/migrations/20261101091500_life_blog_account_sync.sql,
 * 20261101160000_life_blog_delete_guard.sql and the public photo copies of
 * 20261102120000_life_blog_public_photo_copies.sql. */
const assert = require('node:assert/strict');
const { createStorage } = require('../../assets/life/storage.js');
const Core = require('../../assets/life/core.js'), Photo = require('../../assets/life/photo-post.js'), Blog = require('../../assets/life/blog.js');
const Sync = require('../../assets/life/blog-sync.js');
const PROJECT = 'https://blog-sync-test.supabase.co', USER = '11111111-2222-4333-8444-555555555555';
const owner = { projectUrl: PROJECT, userId: USER };
const copy = value => structuredClone(value), key = value => JSON.stringify(value);
const fault = code => Object.assign(new Error(code), { code });

function memoryIdb() {
  const rows = new Map(), paths = new Map(), indexes = new Map(), control = { writes: [], fail: null }; let tail = Promise.resolve();
  return { rows, control, idb: { async openDB(_name, _version, callbacks) {
    let closed = false;
    const db = {
      objectStoreNames: { contains: name => rows.has(name) },
      createObjectStore(name, options) { rows.set(name, new Map()); paths.set(name, options.keyPath); indexes.set(name, new Map()); return { createIndex(index, path) { indexes.get(name).set(index, path); } }; },
      close() { closed = true; },
      transaction(names, mode) {
        if (closed) throw new DOMException('closed', 'InvalidStateError');
        let resolve, reject, ended = false, working;
        const done = new Promise((yes, no) => { resolve = yes; reject = no; }), previous = tail;
        tail = done.catch(() => {});
        function abort(error = new DOMException('aborted', 'AbortError')) { if (!ended) { ended = true; reject(error); } }
        const ready = previous.then(() => {
          if (ended) return; working = new Map(names.map(name => [name, new Map(rows.get(name))]));
          setImmediate(() => { if (ended) return; ended = true; if (mode === 'readwrite') for (const [name, data] of working) rows.set(name, data); resolve(); });
        });
        async function request(name, method, value) {
          await ready; if (ended) throw new DOMException('inactive', 'AbortError');
          const store = working.get(name);
          if (method === 'get') return copy(store.get(key(value)));
          if (method === 'getAll') return copy([...store.values()]);
          if (method === 'getAllKeys') return [...store.keys()].map(item => JSON.parse(item));
          if (method === 'getKey') return store.has(key(value)) ? copy(value) : undefined;
          if (method === 'indexGetAll') { const field = indexes.get(name).get(value.index); return copy([...store.values()].filter(row => key(row[field]) === key(value.value))); }
          assert.equal(mode, 'readwrite');
          const path = paths.get(name), id = method === 'delete' ? value : Array.isArray(path) ? path.map(field => value[field]) : value[path];
          const write = { name, method, id }; control.writes.push(write);
          if (control.fail?.(write)) { control.fail = null; const error = new DOMException('quota', 'QuotaExceededError'); abort(error); throw error; }
          if (method === 'add' && store.has(key(id))) throw new DOMException('duplicate', 'ConstraintError');
          if (method === 'delete') store.delete(key(id)); else store.set(key(id), copy(value)); return id;
        }
        return { done, abort, objectStore(name) { return {
          get: item => request(name, 'get', item), getAll: () => request(name, 'getAll'), getAllKeys: () => request(name, 'getAllKeys'), getKey: item => request(name, 'getKey', item),
          put: item => request(name, 'put', item), add: item => request(name, 'add', item), delete: item => request(name, 'delete', item),
          index: index => ({ getAll: item => request(name, 'indexGetAll', { index, value: item }) })
        }; } };
      }
    };
    if (!rows.size) callbacks.upgrade(db, 0, 1); return db;
  } } };
}

function server() {
  const rows = new Map(), assets = new Map(), receipts = new Map(), stats = { saves: [], uploads: [], copyUploads: [], downloads: 0, deletes: [], removed: [], publishes: [] };
  const control = { failUpload: null, failSave: null, loseSave: false, holdUpload: null };
  // The server commit time (updated_at) follows the devices' shared test
  // clock once a device joins, like clock_timestamp() on the real server; it
  // only ever moves forward.
  let tick = 0, last = 0, serverClock = null;
  const stamp = () => {
    last = Math.max(serverClock ? serverClock.now : Date.UTC(2026, 10, 1) + (++tick) * 1000, last + 1);
    return new Date(last).toISOString();
  };
  const path = (postId, photoId, digest) => USER + '/' + postId + '/' + photoId + '/' + digest;
  function media(item) { return [item, ...(item.view ? [{ id: item.id, ...item.view }] : [])]; }
  function ready(postId, data) {
    return data.photos.every(photo => media(photo).every(item => { const asset = assets.get(path(postId, item.id, item.digest)); return asset?.blob && !asset.deleted && asset.meta.size === item.size && asset.meta.type === item.type; }));
  }
  function head(row) {
    return { id: row.id, workspace_id: row.workspace_id, revision: row.revision, status: row.data.status, title: row.data.title, updated_at: row.updated_at,
      document_updated_at: row.data.updatedAt, photos: row.data.photos.length, archived: row.data.archived === true, publication: copy(row.publication) };
  }
  function client(name) {
    let disposed = false;
    return {
      name,
      async verify() { stats.verify = (stats.verify || 0) + 1; return { userId: USER }; },
      async syncList() { return [...rows.values()].map(head); },
      async list() { return [...rows.values()].filter(row => row.data.status === 'saved').map(head); },
      async read(id) {
        const row = rows.get(id); if (!row) return null;
        const map = {};
        for (const photo of row.data.photos) map[photo.id] = { bucket: 'haedo-blog-originals', path: path(id, photo.id, photo.digest), ...(photo.view ? { view: { bucket: 'haedo-blog-originals', path: path(id, photo.id, photo.view.digest) } } : {}) };
        return { id, workspace_id: row.workspace_id, revision: row.revision, data: copy(row.data), assets: map, updated_at: row.updated_at, publication: copy(row.publication) };
      },
      async prepareAsset(postId, item) {
        const at = path(postId, item.id, item.digest), prior = assets.get(at);
        if (prior) { assert.deepEqual(prior.meta, { size: item.size, type: item.type }); prior.deleted = false; }
        else assets.set(at, { meta: { size: item.size, type: item.type }, blob: null, deleted: false });
        return { bucket: 'haedo-blog-originals', path: at, exists: !!assets.get(at).blob };
      },
      async uploadAsset(postId, item, blob) {
        if (control.holdUpload) await control.holdUpload.promise;
        if (control.failUpload?.(item, name)) throw fault('network_error');
        assert(blob instanceof Blob); assert.equal(blob.size, item.size); assert.equal(blob.type, item.type);
        assert.equal(await Photo.digest(blob), item.digest);
        const asset = await this.prepareAsset(postId, item);
        if (!asset.exists) { assets.get(asset.path).blob = blob; stats.uploads.push({ device: name, postId, id: item.id, digest: item.digest, type: item.type }); }
        return asset;
      },
      // A registered public copy (JPEG/PNG; JPEG for HEIC) of a stored photo, never the original or HEIC view.
      async uploadPublicCopy(postId, item, blob) {
        const row = rows.get(postId), photo = row?.data.photos.find(value => value.id === item.id);
        if (!photo || item.digest === photo.digest || item.digest === photo.view?.digest || !['image/jpeg', 'image/png'].includes(item.type) || (photo.view && item.type !== 'image/jpeg')) throw fault('invalid_request');
        assert.equal(blob.size, item.size); assert.equal(blob.type, item.type); assert.equal(await Photo.digest(blob), item.digest);
        const at = path(postId, item.id, item.digest);
        if (!assets.has(at)) { assets.set(at, { meta: { size: item.size, type: item.type }, blob, deleted: false, copy: true }); stats.copyUploads.push({ device: name, postId, id: item.id, digest: item.digest, type: item.type }); }
        return { bucket: 'haedo-blog-originals', path: at, exists: true };
      },
      async downloadAsset(asset) { stats.downloads++; const value = assets.get(asset.path); if (!value?.blob || value.deleted) throw fault('remote_missing'); return value.blob; },
      async save(request) {
        stats.saves.push({ device: name, ...copy(request) });
        Blog.validateManifest(request.data);
        assert.equal(request.data.id, request.postId);
        if (control.failSave?.(request, name)) throw fault('network_error');
        const prior = receipts.get(request.operationId);
        if (prior) { assert.equal(key(prior.request), key(request)); return copy(prior.result); }
        const existing = rows.get(request.postId);
        if (!existing && request.expectedRevision !== 0) return { status: 'missing' };
        if (existing && existing.revision !== request.expectedRevision) return { status: 'conflict', revision: existing.revision };
        if (existing?.data.status === 'saved' && request.data.status === 'draft') throw fault('invalid_request');
        if (!ready(request.postId, request.data)) throw fault('invalid_request');
        const revision = request.expectedRevision + 1;
        rows.set(request.postId, { id: request.postId, workspace_id: request.workspaceId, revision, data: copy(request.data), updated_at: stamp(), publication: existing?.publication || null });
        const result = { status: 'stored', revision }; receipts.set(request.operationId, { request: copy(request), result });
        if (control.loseSave) { control.loseSave = false; throw fault('network_error'); }
        return result;
      },
      async deletePost(postId, expected) {
        stats.deletes.push({ device: name, postId, expected });
        const row = rows.get(postId);
        if (row && expected !== null && row.revision !== expected) return { status: 'conflict', revision: row.revision };
        if (row?.publication?.active) return { status: 'published', revision: row.revision }; // 20261101160000
        if (row) { rows.delete(postId); for (const [at, asset] of assets) if (at.startsWith(USER + '/' + postId + '/')) asset.deleted = true; }
        const paths = [...assets].filter(([at, asset]) => at.startsWith(USER + '/' + postId + '/') && asset.deleted).map(([at]) => at).sort();
        return { status: row ? 'deleted' : 'missing', revision: row?.revision || 0, paths };
      },
      async removeAssets(postId, list) { for (const at of list) { assert(assets.get(at)?.deleted); assets.delete(at); stats.removed.push(at); } return list.length; },
      async publish(id, revision, operation, options) {
        stats.publishes.push({ id, revision, operation, options: copy(options) }); const row = rows.get(id);
        if (row.revision !== revision || (row.publication?.revision || 0) !== options.expectedPublicRevision) throw fault('blog_conflict');
        // Every selected photo, in every format, needs its uploaded copy.
        for (const id of options.photoIds || []) {
          const named = (options.copies || []).find(item => item.id === id);
          if (!named || !assets.get(path(row.id, id, named.digest))?.copy) throw fault('invalid_request');
        }
        row.publication = { token: row.publication?.token || Core.id(), blogToken: Core.id(), revision: options.expectedPublicRevision + 1, active: true };
        return { status: 'stored', ...row.publication };
      },
      async unpublish(id, revision) { const row = rows.get(id); row.publication = { ...row.publication, revision: revision + 1, active: false }; return { status: 'stored', revision: revision + 1 }; },
      dispose() { disposed = true; }, get disposed() { return disposed; }
    };
  }
  return { rows, assets, receipts, stats, control, client, useClock(time) { serverClock ||= time; } };
}

function clock(start = Date.UTC(2026, 10, 1, 12)) { const value = { now: start }; value.advance = ms => { value.now += ms; }; return value; }

async function device(cloud, name, { time = clock(), workspace = null, auth = null } = {}) {
  const memory = memoryIdb();
  const storage = createStorage({ idb: memory.idb, core: Core, channelFactory: null, account: owner });
  let workspaceId;
  if (workspace) { await storage.installWorkspace(workspace); workspaceId = workspace.workspaceId; }
  else workspaceId = (await storage.createWorkspace(name + ' 공간')).workspaceId;
  const account = auth || { epoch: 0, verifications: 0, getAccount: () => owner, async verify() { account.verifications++; return { id: USER }; } };
  cloud.useClock?.(time);
  const remote = cloud.client(name);
  const sync = Sync.create({ storage, auth: account, blog: Blog, photoPost: Photo, remote, makeId: Core.id, locks: null, now: () => time.now, timers: { setTimeout: () => 0, clearTimeout() {} }, interval: 30000 });
  return { name, memory, storage, ws: workspaceId, sync, remote, auth: account, time };
}

async function png(n) {
  const blob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, n, n + 1])], { type: 'image/png' });
  return { id: Core.id(), name: '익명 사진 ' + n + '.png', type: 'image/png', width: 1, height: 1, size: blob.size, digest: await Photo.digest(blob), blob };
}
async function post({ title = '여행 기록', body = '출발한 날 🌿', photos = 0, status = 'saved', time = '2026-11-01T09:00:00.000Z' } = {}) {
  const doc = Photo.create(Core.id, time); doc.status = status; doc.title = title; doc.ops = [{ insert: body + '\n' }];
  for (let n = 0; n < photos; n++) { const photo = await png(n); doc.photos.push(photo); doc.ops.push({ insert: { photo: { id: photo.id, caption: '사진 설명 ' + n, alt: '' } } }, { insert: '\n' }); }
  return doc;
}
// The editor's saved-post edit: a new draft identity that replaces the saved one.
async function edit(dev, id, changes, at) {
  const saved = await dev.storage.readPhotoPost(dev.ws, id);
  const draft = { ...copy(saved), ...changes, id: Core.id(), revision: 0, status: 'draft', replaces: { id: saved.id, revision: saved.revision }, updatedAt: at };
  const stored = await dev.storage.savePhotoPost(dev.ws, draft, 0);
  return stored;
}
async function finish(dev, draft, at) {
  return dev.storage.savePhotoPost(dev.ws, { ...copy(draft), status: 'saved', updatedAt: at }, draft.revision);
}
module.exports = { owner, USER, PROJECT, memoryIdb, server, device, clock, png, post, edit, finish, copy, Core, Photo, Blog, Sync };

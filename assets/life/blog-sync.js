/* Account-wide private blog sync (2026-11-01 owner directive).
 * Every saved post and draft of the signed-in owner, with its original photos
 * (and HEIC view renditions), is kept current on all of the owner's devices.
 * Local documents are never dropped: a post changed on two devices keeps the
 * older side as a separate local draft ("충돌로 보관한 이전 내용"). Publication
 * stays an explicit, separate action and selects no photos by default. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).BlogSync = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const CONFLICT_PREFIX = '충돌로 보관한 이전 내용 · ';
  const DRAFT_DELAY = 5000, MAX_BACKOFF = 15 * 60 * 1000;
  // A concurrent local change (another tab) is simply decided again next cycle.
  const QUIET = new Set(['request_cancelled', 'blog_state_conflict', 'photo_post_conflict']);
  // Live instances with automatic sync. The editor reports a committed local
  // draft through the module (HaedoLife.BlogSync.noteLocalDraftSaved).
  const live = new Set();
  function noteLocalDraftSaved(postId) { for (const instance of live) { try { instance.noteLocalDraftSaved(postId); } catch (_) {} } }
  function create({ storage, auth = root.HaedoAuth, blog = root.HaedoLife?.Blog,
    photoPost = root.HaedoLife?.PhotoPost, remote = root.HaedoLife?.BlogRemote?.create({ auth, blog }),
    makeId = () => root.crypto.randomUUID(), autoSync = false, interval = 30000, concurrency = 2,
    now = () => Date.now(), timers = root, locks = root.navigator?.locks, events = root } = {}) {
    const cleaner = root.HaedoLife?.BlogRemote?.clean || (error => error);
    const fault = code => cleaner({ code });
    // Local storage faults carry their own user message; only server faults are normalized.
    const explain = error => typeof error?.code === 'string' && /^(photo_post_|blog_post_|blog_state_|storage_|invalid_photo_post$|workspace_)/.test(error.code) ? error : cleaner(error);
    if (!storage?.account || !storage.readBlogSyncState || !storage.writeBlogSyncState || !auth || !remote || !blog?.pack || !photoPost?.validate) throw fault('auth_required');
    const owner = storage.account, queues = new Map(), listeners = new Set(), generations = new Map();
    const holds = new Map(), retries = new Map(), draftDue = new Map();
    let disposed = false, started = false, timer = null, draftTimer = null, running = null, rerun = null;
    const removers = [];
    const summary = { state: 'idle', pending: 0, errors: 0, receiving: 0, lastSyncAt: null, lastError: null, running: false };
    const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(name => JSON.stringify(name) + ':' + canonical(value[name])).join(',') + '}' : JSON.stringify(value);
    const key = (ws, id) => ws + '/' + id;
    const same = value => value?.userId === owner.userId && value?.projectUrl === owner.projectUrl;
    const context = (ws, id) => ({ ws, id, epoch: auth.epoch, generation: generations.get(key(ws, id)) || 0 });
    function guard(c) { if (disposed || !same(auth.getAccount()) || c.epoch !== auth.epoch || c.generation !== (generations.get(key(c.ws, c.id)) || 0)) throw fault('request_cancelled'); }
    const current = c => { try { guard(c); return true; } catch (_) { return false; } };
    // The one network account check at the start of a transfer or cycle. Each
    // request afterwards re-checks identity synchronously (BlogRemote guard),
    // and BlogRemote verifies once more right before a durable commit.
    async function verified(c) { guard(c); const user = await auth.verify(); guard(c); if (user?.id !== owner.userId) throw fault('auth_required'); }
    function publish$(event) { if (!disposed) for (const listener of listeners) { try { listener(event); } catch (_) {} } }
    const emit = (ws, id) => publish$({ workspaceId: ws, localPostId: id });
    function serial(ws, id, action) {
      const k = key(ws, id), previous = queues.get(k) || Promise.resolve();
      const next = previous.catch(() => {}).then(action); queues.set(k, next);
      next.finally(() => { if (queues.get(k) === next) queues.delete(k); }).catch(() => {}); return next;
    }
    async function readState(c) { const state = await storage.readBlogSyncState(c.ws, c.id); guard(c); return state; }
    async function writeState(c, state, changes, options) {
      guard(c); const result = await storage.writeBlogSyncState(c.ws, c.id, { ...state, ...changes }, state?.revision || 0, options); guard(c); emit(c.ws, c.id); return result;
    }
    async function readPost(c) { const post = await storage.readPhotoPost(c.ws, c.id); guard(c); photoPost.validate(post); return post; }
    const dirty = (state, post) => !state || !state.enabled || state.enableOnSave === true || !!state.conflict || !!state.pending || state.remoteRevision === 0 || state.localRevision !== post.revision;
    function statusOf(ws, post, state) {
      if (state?.error || retries.get(key(ws, post.id))?.error) return 'error';
      return dirty(state, post) ? 'pending' : 'synced';
    }
    async function getState(ws, id) {
      const c = context(ws, id); guard(c); const state = await readState(c), post = await readPost(c);
      return { ...(state || {}), workspaceId: ws, localPostId: id, enabled: true, status: statusOf(ws, post, state) };
    }
    // ---- documents ----------------------------------------------------------
    function viewMeta(view) { const { type, size, digest, width, height } = view; return { type, size, digest, width, height }; }
    async function packFor(c, post, state) {
      const manifest = blog.pack(photoPost.compact(post));
      for (const photo of manifest.photos) if (photo.view) photo.view = viewMeta(photo.view);
      manifest.id = state.remoteId;
      if (manifest.status === 'saved' || !manifest.replaces) manifest.replaces = null;
      else {
        // An editing draft names the saved post it replaces by that post's
        // server identity; other devices translate it back to their local id.
        const target = await storage.readBlogSyncState(c.ws, manifest.replaces.id); guard(c);
        const exact = target && target.localRevision === manifest.replaces.revision && !target.pending;
        manifest.replaces = target?.remoteId ? { id: target.remoteId, revision: exact ? target.remoteRevision : 0 } : { id: manifest.replaces.id, revision: 0 };
        if (manifest.replaces.id === manifest.id) manifest.replaces = null;
      }
      return manifest;
    }
    function localReplaces(ws, replaces, byRemote) {
      if (!replaces) return null;
      const local = byRemote?.get(replaces.id);
      if (!local || local.ws !== ws) return { id: replaces.id, revision: 0 };
      // Revision 0 never matches a stored post: saving such a draft asks the
      // writer to keep it as a new post instead of replacing a changed one.
      const exact = replaces.revision > 0 && local.state.remoteRevision === replaces.revision && !dirty(local.state, local.post);
      return { id: local.localPostId, revision: exact ? local.post.revision : 0 };
    }
    function typed(blob, meta) {
      if (!(blob instanceof Blob) || blob.size !== meta.size) throw fault('invalid_remote_data');
      return blob.type === meta.type ? blob : new Blob([blob], { type: meta.type });
    }
    // Downloads every original (and HEIC view) of an exact server row, then
    // verifies type signatures, digests and the view pairing through Blog.hydrate.
    async function download(c, row) {
      const files = new Map();
      for (const photo of row.data.photos) {
        const asset = row.assets[photo.id];
        const blob = typed(await remote.downloadAsset({ bucket: asset.bucket, path: asset.path }), photo); guard(c);
        const view = photo.view ? typed(await remote.downloadAsset(asset.view), photo.view) : undefined; guard(c);
        files.set(photo.id, view ? { blob, view } : { blob });
      }
      try { const doc = await blog.hydrate(row.data, files); guard(c); return doc; }
      catch (error) { guard(c); if (error?.code === 'request_cancelled') throw error; throw fault('invalid_remote_data'); }
    }
    function localDoc(remoteDoc, id, revision, ws, byRemote) {
      const doc = { ...remoteDoc, id, revision, replaces: remoteDoc.status === 'saved' ? null : localReplaces(ws, remoteDoc.replaces, byRemote) };
      photoPost.validate(doc); return doc;
    }
    function conflictCopy(doc) {
      const base = typeof photoPost.upgrade === 'function' ? photoPost.upgrade({ ...doc, replaces: null }) : structuredClone({ ...doc, replaces: null });
      let title = CONFLICT_PREFIX + (base.title || '');
      while (title.length > 500) title = Array.from(title).slice(0, -1).join('');
      // The kept copy retains the time its content was written.
      Object.assign(base, { id: makeId(), revision: 0, status: 'draft', replaces: null, title });
      if (Object.hasOwn(base, 'archived')) base.archived = false;
      photoPost.validate(base); return base;
    }
    const synced = (state, row, extra = {}) => ({ ...state, enabled: true, enableOnSave: false, remoteRevision: row.revision, remoteManifest: row.data,
      remoteWorkspaceId: row.workspace_id, publication: row.publication ?? null, pending: null, conflict: null, status: 'synced', error: null, ...extra });
    const held = (ws, id) => (holds.get(key(ws, id)) || 0) > 0;
    // ---- upload ---------------------------------------------------------------
    async function sendMedia(c, remoteId, item, blob) {
      if (blob) { await remote.uploadAsset(remoteId, item, blob); guard(c); return; }
      // A replayed request may name an original this device no longer holds.
      const asset = await remote.prepareAsset(remoteId, item); guard(c);
      if (!asset.exists) { const latest = await readState(c); await writeState(c, latest, { pending: null, error: null, status: 'pending' }); throw fault('local_changed'); }
    }
    async function send(c, state, post, attempt, byRemote) {
      const pending = structuredClone(state.pending);
      for (const photo of pending.manifest.photos) {
        const local = post.photos.find(item => item.id === photo.id && item.digest === photo.digest);
        await sendMedia(c, state.remoteId, { id: photo.id, type: photo.type, size: photo.size, digest: photo.digest, width: photo.width, height: photo.height }, local?.blob || null);
        if (photo.view) await sendMedia(c, state.remoteId, { id: photo.id, ...viewMeta(photo.view) }, local?.view?.digest === photo.view.digest ? local.view.blob : null);
      }
      // An account change or a newer local request cannot commit this document.
      const latest = await readState(c);
      if (latest?.pending?.operationId !== pending.operationId || latest.remoteId !== state.remoteId) throw fault('request_cancelled');
      const result = await remote.save({ workspaceId: latest.remoteWorkspaceId, postId: latest.remoteId,
        expectedRevision: pending.expectedRevision, operationId: pending.operationId, data: pending.manifest }); guard(c);
      if (result.status === 'stored') {
        await writeState(c, latest, { remoteRevision: result.revision, remoteManifest: pending.manifest, localRevision: pending.localRevision, pending: null, conflict: null, error: null, status: 'synced' });
        retries.delete(key(c.ws, c.id)); return getState(c.ws, c.id);
      }
      // Not applied on the server: keep the local post dirty and decide again.
      const fresh = await writeState(c, latest, { pending: null, status: 'pending', error: null });
      if (attempt >= 2) throw fault('blog_conflict');
      if (result.status === 'missing') {
        // Deleted on another device while this one changed it: recreate, never drop.
        await writeState(c, fresh, { remoteRevision: 0, remoteManifest: null, publication: null });
        return pushLocked(c, { attempt: attempt + 1, byRemote });
      }
      return resolveConflict(c, fresh, await readPost(c), attempt + 1, byRemote);
    }
    async function pushLocked(c, { expectedManifest = null, expectedLocalRevision, attempt = 0, byRemote = null } = {}) {
      const post = await readPost(c); let state = await readState(c);
      if (expectedLocalRevision !== undefined && post.revision !== expectedLocalRevision) throw fault('local_changed');
      // Earlier per-device choices (pause, reserved preparation, manual
      // conflict) no longer stop a post from reaching the owner's other devices.
      if (!state || !state.enabled || state.enableOnSave === true || state.conflict) state = await writeState(c, state, {
        enabled: true, enableOnSave: false, remoteId: state?.remoteId || post.id, remoteWorkspaceId: state?.remoteWorkspaceId || c.ws,
        remoteRevision: state?.remoteRevision || 0, localRevision: state?.localRevision || 0, remoteManifest: state?.remoteManifest || null,
        publication: state?.publication || null, pending: state?.pending || null, conflict: null, status: 'pending', error: null });
      if (!state.pending) {
        if (state.remoteRevision > 0 && state.localRevision === post.revision) return getState(c.ws, c.id);
        const manifest = await packFor(c, post, state);
        if (expectedManifest) { const expected = structuredClone(expectedManifest); expected.id = state.remoteId; expected.replaces = null; if (canonical(manifest) !== canonical(expected)) throw fault('local_changed'); }
        if (state.remoteRevision > 0 && state.remoteManifest && canonical(manifest) === canonical(state.remoteManifest)) {
          await writeState(c, state, { localRevision: post.revision, status: 'synced', error: null }); return getState(c.ws, c.id);
        }
        state = await writeState(c, state, { status: 'pending', error: null, pending: { operationId: makeId(), manifest, expectedRevision: state.remoteRevision, localRevision: post.revision } });
      } else if (expectedManifest) {
        const expected = structuredClone(expectedManifest); expected.id = state.remoteId; expected.replaces = null;
        if (canonical(state.pending.manifest) !== canonical(expected)) throw fault('local_changed');
      }
      return send(c, state, post, attempt, byRemote);
    }
    // Both this device and the server changed the post since the last sync.
    // The later document (by its own updatedAt) stays in place; the other side
    // is kept as a separate local draft that itself syncs to every device.
    async function resolveConflict(c, state, post, attempt = 0, byRemote = null) {
      const row = await remote.read(state.remoteId); guard(c);
      if (!row) {
        await writeState(c, state, { remoteRevision: 0, remoteManifest: null, pending: null, conflict: null, publication: null, status: 'pending', error: null });
        return pushLocked(c, { attempt: attempt + 1, byRemote });
      }
      if (row.revision === state.remoteRevision) return pushLocked(c, { attempt: attempt + 1, byRemote });
      const remoteWins = Date.parse(row.data.updatedAt) > Date.parse(post.updatedAt);
      if (remoteWins && held(c.ws, c.id)) return getState(c.ws, c.id);
      const remoteDoc = await download(c, row);
      const map = byRemote || (await snapshot(c)).byRemote;
      if (remoteWins) {
        await storage.commitBlogSync(c.ws, { postId: c.id, post: localDoc(remoteDoc, c.id, post.revision, c.ws, map), baseRevision: post.revision,
          binding: synced(state, row), bindingRevision: state.revision, copy: conflictCopy(post) }, { isCurrent: () => current(c) });
        guard(c); emit(c.ws, c.id); kick(1000); // the kept draft reaches the other devices promptly retries.delete(key(c.ws, c.id)); return getState(c.ws, c.id);
      }
      await storage.commitBlogSync(c.ws, { postId: c.id, baseRevision: post.revision,
        binding: synced(state, row, { localRevision: state.localRevision, status: 'pending' }), bindingRevision: state.revision,
        copy: conflictCopy({ ...remoteDoc, id: c.id, revision: post.revision, replaces: null }) }, { isCurrent: () => current(c) });
      guard(c); emit(c.ws, c.id); kick(1000);
      return pushLocked(c, { attempt: attempt + 1, byRemote: map });
    }
    async function rememberError(c, error) {
      const code = explain(error)?.code || 'network_error';
      if (QUIET.has(code)) return;
      const k = key(c.ws, c.id), prior = retries.get(k), attempts = (prior?.attempts || 0) + 1;
      retries.set(k, { attempts, until: now() + Math.min(interval * 2 ** (attempts - 1), MAX_BACKOFF), error: code });
      try { guard(c); const state = await readState(c); if (state) await writeState(c, state, { status: 'error', error: code }); } catch (_) { /* The local post and its durable request remain. */ }
    }
    async function push(ws, id, options = {}) {
      return serial(ws, id, async () => {
        const c = context(ws, id);
        try { if (options.verify !== false) await verified(c); return await pushLocked(c, options); }
        catch (error) { await rememberError(c, error); throw explain(error); }
      });
    }
    // Called by the editor right after an explicit save: uploads now instead of
    // waiting for the next cycle. Failures stay queued for the automatic retry.
    // A following cycle retires a replaced editing draft on the server promptly.
    const saveDefault = (ws, id, options = {}) => push(ws, id, { expectedLocalRevision: options.expectedLocalRevision, expectedManifest: options.expectedManifest || null }).finally(() => kick(0));
    const save = (ws, id, options = {}) => push(ws, id, { expectedManifest: options.expectedManifest || null });
    // ---- download --------------------------------------------------------------
    async function install(ws, head, byRemote) {
      return serial(ws, head.id, async () => {
        const c = context(ws, head.id);
        try {
          const row = await remote.read(head.id); guard(c); if (!row) return null;
          const doc = localDoc(await download(c, row), row.id, 0, ws, byRemote);
          const binding = synced({ remoteId: row.id, localRevision: 0, publishPending: null, unpublishPending: null }, row);
          try { await storage.commitBlogSync(ws, { postId: row.id, post: doc, baseRevision: 0, binding, bindingRevision: 0 }, { isCurrent: () => current(c) }); }
          catch (error) {
            if (error?.code === 'blog_post_deleted') return null;
            if (error?.code === 'photo_post_conflict' || error?.code === 'blog_state_conflict') {
              const existing = await readState(c);
              if (existing?.remoteId === row.id) return null; // another tab installed it
              // An unbound local document already uses this identity: decide it as a conflict.
              if (!existing && error.code === 'photo_post_conflict') { await writeState(c, null, { ...binding, remoteRevision: 0, remoteManifest: null, status: 'pending' }); return null; }
            }
            throw error;
          }
          guard(c); emit(ws, row.id); retries.delete(key(ws, row.id)); return row.id;
        } catch (error) { await rememberError(c, error); throw explain(error); }
      });
    }
    async function apply(ws, id, head, byRemote) {
      return serial(ws, id, async () => {
        const c = context(ws, id);
        try {
          const state = await readState(c); if (!state || state.remoteId !== head.id) return null;
          const post = await readPost(c);
          // Our own unacknowledged request is replayed first; its receipt may
          // already be the newer server head.
          if (state.pending) return await pushLocked(c, { byRemote });
          if (dirty(state, post)) return await resolveConflict(c, state, post, 0, byRemote);
          if (held(ws, id)) return null;
          const row = await remote.read(head.id); guard(c);
          if (!row || row.revision === state.remoteRevision) return null;
          const doc = localDoc(await download(c, row), id, post.revision, ws, byRemote);
          await storage.commitBlogSync(ws, { postId: id, post: doc, baseRevision: post.revision, binding: synced(state, row), bindingRevision: state.revision }, { isCurrent: () => current(c) });
          guard(c); emit(ws, id); retries.delete(key(ws, id)); return id;
        } catch (error) { await rememberError(c, error); throw explain(error); }
      });
    }
    async function refreshPublication(ws, id, head) {
      return serial(ws, id, async () => {
        const c = context(ws, id), state = await readState(c);
        if (state?.remoteId === head.id && state.remoteRevision === head.revision && canonical(state.publication ?? null) !== canonical(head.publication ?? null) && !state.publishPending && !state.unpublishPending)
          await writeState(c, state, { publication: head.publication ?? null });
      });
    }
    // The server no longer has a post this device received or stored: it was
    // deleted on another device. A clean copy is removed; local changes recreate it.
    async function vanish(ws, id, remoteId) {
      return serial(ws, id, async () => {
        const c = context(ws, id);
        try {
          const state = await readState(c); if (!state || state.remoteId !== remoteId || state.remoteRevision === 0) return;
          if (await remote.read(remoteId)) return; guard(c);
          const post = await readPost(c);
          if (dirty(state, post)) {
            await writeState(c, state, { remoteRevision: 0, remoteManifest: null, pending: null, conflict: null, publication: null, status: 'pending', error: null });
            await pushLocked(c, {}); return;
          }
          if (held(ws, id)) return;
          await storage.commitBlogSync(ws, { postId: id, remove: true, baseRevision: post.revision, bindingRevision: state.revision }, { isCurrent: () => current(c) });
          guard(c); emit(ws, id);
        } catch (error) { await rememberError(c, error); throw explain(error); }
      });
    }
    async function deleteRemote(c, tombstone) {
      const result = await remote.deletePost(tombstone.remoteId, null); guard(c);
      if (result.status === 'conflict') throw fault('blog_conflict');
      if (result.paths.length) await remote.removeAssets(tombstone.remoteId, result.paths);
      guard(c); await storage.clearBlogTombstone(tombstone.ws, tombstone.remoteId);
    }
    // ---- explicit deletion -----------------------------------------------------
    async function deletePost(ws, id, { expectedRevision } = {}) {
      return serial(ws, id, async () => {
        const c = context(ws, id); guard(c);
        const post = await readPost(c);
        if (expectedRevision !== undefined && post.revision !== expectedRevision) throw Object.assign(new Error('글이 바뀌었습니다. 목록을 다시 확인한 뒤 삭제해 주세요.'), { code: 'photo_post_conflict' });
        const result = await storage.deletePhotoPost(ws, id, post.revision);
        generations.set(key(ws, id), (generations.get(key(ws, id)) || 0) + 1);
        emit(ws, id); kick(0); return result;
      });
    }
    // ---- cycle -------------------------------------------------------------------
    async function snapshot(c, owned = null) {
      const ids = owned || (await storage.listAccountLibraries()).map(item => item.workspaceId); guard(c);
      const workspaces = new Map(), groups = new Map(), tombstones = [];
      for (const ws of ids) {
        const value = await storage.listBlogSyncStates(ws); guard(c);
        const posts = new Map(value.posts.map(post => [post.id, post])), states = new Map(value.states.map(entry => [entry.localPostId, entry.state]));
        workspaces.set(ws, { posts: value.posts, states });
        for (const item of value.tombstones) tombstones.push({ ...item, ws });
        for (const [localPostId, state] of states) {
          const post = posts.get(localPostId); if (!post) continue;
          if (!groups.has(state.remoteId)) groups.set(state.remoteId, []);
          groups.get(state.remoteId).push({ ws, localPostId, state, post });
        }
      }
      const byRemote = new Map(), duplicates = [];
      for (const [remoteId, entries] of groups) {
        // Earlier "new copy" choices could bind several local posts to one server
        // post. Keep one connection; the others become their own posts.
        entries.sort((a, b) => Number(!!b.state.publication?.active) - Number(!!a.state.publication?.active) ||
          Number(!dirty(b.state, b.post)) - Number(!dirty(a.state, a.post)) || b.state.remoteRevision - a.state.remoteRevision || a.localPostId.localeCompare(b.localPostId));
        byRemote.set(remoteId, entries[0]); duplicates.push(...entries.slice(1));
      }
      return { workspaces, byRemote, duplicates, tombstones };
    }
    async function detach(entry) {
      return serial(entry.ws, entry.localPostId, async () => {
        const c = context(entry.ws, entry.localPostId), state = await readState(c);
        if (!state || state.remoteId === entry.localPostId) return;
        await writeState(c, state, { enabled: true, enableOnSave: false, remoteId: entry.localPostId, remoteWorkspaceId: entry.ws, remoteRevision: 0, localRevision: 0,
          remoteManifest: null, publication: null, pending: null, conflict: null, publishPending: null, unpublishPending: null, status: 'pending', error: null });
      });
    }
    const backingOff = (ws, id) => (retries.get(key(ws, id))?.until || 0) > now();
    function draftWaiting(post) { const due = draftDue.get(post.id); return due && due > now() || Date.parse(post.updatedAt) > now() - DRAFT_DELAY; }
    async function pool(tasks) {
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
        while (next < tasks.length) { const task = tasks[next++]; try { await task(); } catch (_) { /* Recorded per post; retried later. */ } }
      }));
    }
    async function cycle({ uploadOnly = false, flushDrafts = false } = {}) {
      const c = context('*', 'cycle');
      summary.running = true; publish$({ type: 'status', status: getStatus() });
      let rows = null;
      try {
        await verified(c);
        const libraries = await storage.listAccountLibraries(); guard(c);
        const owned = libraries.map(item => item.workspaceId), eligible = libraries.filter(item => item.eligible !== false).map(item => item.workspaceId);
        let local = await snapshot(c, owned);
        for (const item of local.tombstones) {
          try {
            if (local.byRemote.has(item.remoteId)) await storage.clearBlogTombstone(item.ws, item.remoteId);
            else if (!backingOff(item.ws, 'delete:' + item.remoteId)) await deleteRemote(c, item);
            retries.delete(key(item.ws, 'delete:' + item.remoteId));
          } catch (error) {
            const k = key(item.ws, 'delete:' + item.remoteId), attempts = (retries.get(k)?.attempts || 0) + 1;
            retries.set(k, { attempts, until: now() + Math.min(interval * 2 ** (attempts - 1), MAX_BACKOFF), error: explain(error).code || 'network_error' });
          }
        }
        if (local.duplicates.length) { await pool(local.duplicates.map(entry => () => detach(entry))); local = await snapshot(c, owned); }
        const uploads = [];
        for (const ws of eligible) {
          for (const post of local.workspaces.get(ws)?.posts || []) {
            const state = local.workspaces.get(ws).states.get(post.id);
            if (!dirty(state, post) || backingOff(ws, post.id)) continue;
            if (post.status === 'draft' && !flushDrafts && draftWaiting(post)) continue;
            uploads.push({ ws, post });
          }
        }
        // Saved posts first, so an editing draft can name its target's server revision.
        uploads.sort((a, b) => Number(a.post.status === 'draft') - Number(b.post.status === 'draft'));
        await pool(uploads.map(({ ws, post }) => () => push(ws, post.id, { verify: false, byRemote: local.byRemote })));
        if (!uploadOnly) {
          local = await snapshot(c, owned);
          rows = await remote.syncList(); guard(c);
          const deleted = new Set(local.tombstones.map(item => item.remoteId)), seen = new Set(rows.map(row => row.id));
          let fallback = null;
          const target = async row => {
            if (eligible.includes(row.workspace_id)) return row.workspace_id;
            if (fallback === null) { const active = await storage.getActive().catch(() => null); fallback = eligible.includes(active) ? active : eligible[0] || ''; }
            return fallback || null;
          };
          const tasks = [];
          rows.sort((a, b) => Number(a.status === 'draft') - Number(b.status === 'draft'));
          for (const row of rows) {
            if (deleted.has(row.id)) continue;
            const entry = local.byRemote.get(row.id);
            if (!entry) {
              const ws = await target(row);
              if (ws && !backingOff(ws, row.id)) tasks.push(() => install(ws, row, local.byRemote));
            } else if (entry.state.remoteRevision !== row.revision) {
              if (!backingOff(entry.ws, entry.localPostId)) tasks.push(() => apply(entry.ws, entry.localPostId, row, local.byRemote));
            } else if (canonical(entry.state.publication ?? null) !== canonical(row.publication ?? null)) tasks.push(() => refreshPublication(entry.ws, entry.localPostId, row));
          }
          for (const [remoteId, entry] of local.byRemote) {
            if (!seen.has(remoteId) && entry.state.remoteRevision > 0 && !backingOff(entry.ws, entry.localPostId)) tasks.push(() => vanish(entry.ws, entry.localPostId, remoteId));
          }
          await pool(tasks);
        }
        summary.lastSyncAt = new Date(now()).toISOString(); summary.lastError = null;
      } catch (error) {
        const code = explain(error).code || 'network_error';
        if (!QUIET.has(code)) summary.lastError = code;
      } finally {
        try { await tally(c, rows); } catch (_) { /* Keep the previous counts. */ }
        summary.running = false; publish$({ type: 'status', status: getStatus() });
      }
      return getStatus();
    }
    async function tally(c, rows) {
      const local = await snapshot(c); let pending = 0, errors = 0, receiving = 0;
      for (const [ws, value] of local.workspaces) for (const post of value.posts) {
        const status = statusOf(ws, post, value.states.get(post.id));
        if (status === 'error') errors++; else if (status === 'pending') pending++;
      }
      for (const item of local.tombstones) if (retries.get(key(item.ws, 'delete:' + item.remoteId))?.error) errors++; else pending++;
      if (rows) {
        const deleted = new Set(local.tombstones.map(item => item.remoteId));
        for (const row of rows) if (!local.byRemote.has(row.id) && !deleted.has(row.id)) { if ([...retries].some(([k, value]) => k.endsWith('/' + row.id) && value.error)) errors++; else receiving++; }
      }
      Object.assign(summary, { pending, errors, receiving, state: summary.lastError || errors ? 'error' : pending || receiving ? 'pending' : 'synced' });
    }
    function getStatus() { return { ...summary }; }
    function withLock(task) {
      if (!locks?.request) return task();
      let ran = false;
      return Promise.resolve(locks.request('haedo-blog-sync:' + owner.projectUrl + ':' + owner.userId, { ifAvailable: true }, async lock => {
        if (!lock) return; ran = true; return task();
      })).then(result => ran ? result : getStatus());
    }
    function schedule(delay) {
      if (disposed || !started) return;
      if (timer) timers.clearTimeout(timer);
      timer = timers.setTimeout(() => { timer = null; void syncNow(); }, delay);
    }
    function kick(delay = 0) { if (started) schedule(delay); }
    async function syncNow(options = {}) {
      if (disposed) return getStatus();
      // An explicit retry or a restored connection does not wait for backoff.
      if (options.force) for (const value of retries.values()) value.until = 0;
      if (running) { rerun = { uploadOnly: !!rerun?.uploadOnly && !!options.uploadOnly, flushDrafts: !!rerun?.flushDrafts || !!options.flushDrafts }; return running; }
      if (timer) { timers.clearTimeout(timer); timer = null; }
      running = (async () => {
        let next = options, result;
        try {
          while (next && !disposed) { rerun = null; result = await withLock(() => cycle(next)); next = rerun; }
        } finally { running = null; schedule(interval); }
        return result;
      })();
      return running;
    }
    function noteLocalDraftSaved(postId) {
      if (disposed || typeof postId !== 'string' || !postId) return;
      draftDue.set(postId, now() + DRAFT_DELAY);
      if (!started) return;
      if (draftTimer) timers.clearTimeout(draftTimer);
      draftTimer = timers.setTimeout(() => { draftTimer = null; void syncNow({ uploadOnly: true }); }, DRAFT_DELAY + 50);
    }
    function start() {
      if (disposed || started) return; started = true;
      const on = (target, name, handler) => { if (typeof target?.addEventListener === 'function') { target.addEventListener(name, handler); removers.push(() => target.removeEventListener(name, handler)); } };
      const doc = events?.document;
      on(events, 'online', () => { void syncNow({ force: true }); });
      on(events, 'focus', () => kick(0));
      on(events, 'pagehide', () => { void syncNow({ uploadOnly: true, flushDrafts: true }); });
      on(doc, 'visibilitychange', () => {
        if (doc.visibilityState === 'hidden') void syncNow({ uploadOnly: true, flushDrafts: true }); else kick(0);
      });
      schedule(0);
    }
    function stop() {
      started = false; removers.splice(0).forEach(remove => remove());
      if (timer) timers.clearTimeout(timer); if (draftTimer) timers.clearTimeout(draftTimer); timer = draftTimer = null;
    }
    // Per-post status for lists, computed locally without network.
    async function statuses(ws) {
      const value = await storage.listBlogSyncStates(ws), states = new Map(value.states.map(entry => [entry.localPostId, entry.state]));
      return Object.fromEntries(value.posts.map(post => [post.id, statusOf(ws, post, states.get(post.id))]));
    }
    // An open editor holds its post: remote changes wait until it is released.
    function holdPost(ws, id) {
      const k = key(ws, id); holds.set(k, (holds.get(k) || 0) + 1); let released = false;
      return () => { if (released) return; released = true; const count = (holds.get(k) || 1) - 1; if (count > 0) holds.set(k, count); else { holds.delete(k); kick(500); } };
    }
    // ---- publication (explicit only) --------------------------------------------
    async function finishPublication(c, state) {
      let result;
      try { result = await remote.publish(state.remoteId, state.publishPending.expectedRevision, state.publishPending.operationId, { ...state.publishPending.selection, expectedPublicRevision: state.publishPending.expectedPublicRevision }); guard(c); }
      catch (error) {
        if (error.code === 'blog_conflict') {
          const row = await remote.read(state.remoteId); guard(c);
          await writeState(c, state, { publication: row?.publication || null, publishPending: null });
        }
        throw error;
      }
      const latest = await remote.read(state.remoteId); guard(c);
      await writeState(c, state, { publication: latest?.publication || { token: result.token, blogToken: result.blogToken, revision: result.revision, active: true }, publishPending: null });
      if (!latest?.publication?.active || latest.publication.revision !== result.revision) throw fault('blog_conflict');
      return { ...result, publicUrl: new URL('blog.html?post=' + result.token, root.location?.href || owner.projectUrl + '/').href, blogUrl: new URL('blog.html?blog=' + result.blogToken, root.location?.href || owner.projectUrl + '/').href };
    }
    async function publish(ws, id, options = {}) {
      const choices = structuredClone(options), c = context(ws, id); await verified(c);
      const initial = await readPost(c);
      if (initial.revision !== choices.expectedLocalRevision) throw fault('local_changed');
      if (initial.status !== 'saved') throw fault('invalid_request');
      const before = await readState(c);
      const selection = { photoIds: choices.photoIds || [], author: choices.author || { name: '', intro: '' } };
      if (before?.publishPending) {
        if (before.publishPending.localRevision !== initial.revision || canonical(before.publishPending.selection) !== canonical(selection)) throw fault('local_changed');
        return serial(ws, id, async () => {
          const state = await readState(c), latest = await readPost(c);
          if (latest.revision !== initial.revision || state?.publishPending?.operationId !== before.publishPending.operationId) throw fault('local_changed');
          return finishPublication(c, state);
        });
      }
      if (choices.expectedRemoteRevision !== undefined && choices.expectedRemoteRevision !== (before?.remoteRevision || 0) || choices.expectedPublicRevision !== undefined && choices.expectedPublicRevision !== (before?.publication?.revision || 0)) throw fault('local_changed');
      await blog.publicSnapshot(initial, selection); guard(c);
      const stored = await push(ws, id, { verify: false }); guard(c); if (stored.status !== 'synced') throw fault('blog_conflict');
      return serial(ws, id, async () => {
        let state = await readState(c); const latest = await readPost(c);
        if (latest.revision !== choices.expectedLocalRevision || state.localRevision !== latest.revision || state.pending) throw fault('local_changed');
        // Compare the reviewed preview with the current server publication
        // before any publication request (another device may have published).
        if (!state.publishPending) {
          const head = await remote.read(state.remoteId); guard(c);
          if (!head || head.revision !== state.remoteRevision) throw fault('local_changed');
          if (canonical(head.publication ?? null) !== canonical(state.publication ?? null)) state = await writeState(c, state, { publication: head.publication ?? null });
        }
        if (choices.expectedPublicRevision !== undefined && choices.expectedPublicRevision !== (state.publication?.revision || 0)) throw fault('local_changed');
        if (state.publishPending && canonical(state.publishPending.selection) !== canonical(selection)) throw fault('operation_mismatch');
        if (!state.publishPending) state = await writeState(c, state, { publishPending: { operationId: makeId(), expectedRevision: state.remoteRevision, expectedPublicRevision: state.publication?.revision || 0, localRevision: latest.revision, selection } });
        return finishPublication(c, state);
      });
    }
    async function unpublish(ws, id, options = {}) {
      const expected = options.expectedPublicRevision;
      return serial(ws, id, async () => {
        const c = context(ws, id); await verified(c); let state = await readState(c);
        if (!state?.publication) throw fault('remote_missing');
        if (expected !== undefined && state.publication.revision !== expected) throw fault('local_changed');
        if (!state.unpublishPending) state = await writeState(c, state, { unpublishPending: { operationId: makeId(), expectedRevision: state.publication.revision } });
        let result;
        try { result = await remote.unpublish(state.remoteId, state.unpublishPending.expectedRevision, state.unpublishPending.operationId); guard(c); }
        catch (error) {
          if (error.code === 'blog_conflict') { const row = await remote.read(state.remoteId); guard(c); await writeState(c, state, { publication: row?.publication || null, unpublishPending: null }); }
          throw error;
        }
        const latest = await remote.read(state.remoteId); guard(c);
        await writeState(c, state, { publication: latest?.publication || { ...state.publication, active: false, revision: result.revision }, unpublishPending: null });
        if (latest?.publication?.active || latest?.publication?.revision !== result.revision) throw fault('blog_conflict');
        return result;
      });
    }
    // Server heads joined with this device's posts, for the account overview.
    async function catalog(ws) {
      const c = context(ws, 'catalog'); await verified(c);
      const rows = await remote.syncList(); guard(c);
      const local = await snapshot(c);
      return rows.map(row => {
        const entry = local.byRemote.get(row.id);
        const status = !entry ? retries.get(key(ws, row.id))?.error ? 'error' : 'pending' : statusOf(entry.ws, entry.post, entry.state) === 'error' ? 'error' :
          entry.state.remoteRevision !== row.revision || dirty(entry.state, entry.post) ? 'pending' : 'synced';
        return { id: row.id, title: row.title, revision: row.revision, status, draft: row.status === 'draft', archived: row.archived,
          updated_at: row.updated_at, publication: structuredClone(row.publication ?? null),
          localPostId: entry?.localPostId || null, localWorkspaceId: entry?.ws || null, localRevision: entry?.post.revision || null };
      });
    }
    const api = Object.freeze({ getState, statuses, getStatus, saveDefault, save, connect: save, sync: save, publish, unpublish, deletePost, catalog,
      syncNow, start, stop, noteLocalDraftSaved, holdPost,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      dispose() { if (disposed) return; stop(); disposed = true; live.delete(api); listeners.clear(); remote.dispose?.(); } });
    if (autoSync) { live.add(api); start(); }
    return api;
  }
  return Object.freeze({ create, noteLocalDraftSaved, CONFLICT_PREFIX });
});

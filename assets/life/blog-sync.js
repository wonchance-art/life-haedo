/* Account-wide private blog sync (2026-11-01 owner directive).
 * Every saved post and draft of the signed-in owner, with its original photos
 * (and HEIC view renditions), is kept current on all of the owner's devices.
 * Local documents are never dropped: a post changed on two devices keeps the
 * later side and the other side as a recovery copy ("복구 사본"), with no
 * exception for saved posts (2026-11-02 owner decision; a later draft over a
 * saved post becomes that post's editing draft). Publication stays an
 * explicit, separate action and selects no photos by default. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).BlogSync = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  // Resolved per engine, not at module load: a page that still lacks sync-common.js (an older
  // index.html mixed with newer modules during an update) keeps this module registered and fails
  // only when the engine is created, with a clear code instead of a TypeError.
  function syncCommon() {
    const api = root.HaedoLife?.SyncCommon || (typeof require === 'function' ? require('./sync-common.js') : null);
    if (!api?.canonical) throw Object.assign(new Error('동기화 공통 모듈을 읽지 못했습니다. 새로고침해 주세요.'), { code: 'sync_common_missing' });
    return api;
  }
  const CONFLICT_PREFIX = '복구 사본 · ';
  const DRAFT_DELAY = 5000, MAX_BACKOFF = 15 * 60 * 1000;
  // A concurrent local change (another tab) is simply decided again next cycle.
  const QUIET = new Set(['request_cancelled', 'blog_state_conflict', 'photo_post_conflict']);
  // Live instances with automatic sync. The editor reports a committed local
  // draft through the module (HaedoLife.BlogSync.noteLocalDraftSaved).
  const live = new Set(), liveStorage = new WeakMap();
  function noteLocalDraftSaved(postId) { for (const instance of live) { try { instance.noteLocalDraftSaved(postId); } catch (_) {} } }
  // The page's automatic instance for this exact storage. Other engines that store a post
  // (MaterialContinuitySync's saved-output share) use it so every push of one post runs in this
  // instance's per-post queue: two instances would race on the same binding CAS, and the
  // loser's blog_state_conflict would hold back the other device's update until a later pass.
  function forStorage(storage) {
    for (const instance of live) if (liveStorage.get(instance) === storage) return instance;
    return null;
  }
  function create({ storage, auth = root.HaedoAuth, blog = root.HaedoLife?.Blog,
    photoPost = root.HaedoLife?.PhotoPost, remote = root.HaedoLife?.BlogRemote?.create({ auth, blog }),
    makeId = () => root.crypto.randomUUID(), autoSync = false, interval = 30000, concurrency = 2, receiveConcurrency = 4, downloadConcurrency = 6, receiveBytes = 160 * 1024 * 1024,
    now = () => Date.now(), timers = root, locks = root.navigator?.locks, events = root } = {}) {
    const cleaner = root.HaedoLife?.BlogRemote?.clean || (error => error);
    const fault = code => cleaner({ code });
    // Local storage faults carry their own user message; only server faults are normalized.
    const explain = error => typeof error?.code === 'string' && /^(photo_post_|blog_post_|blog_state_|storage_|invalid_photo_post$|workspace_)/.test(error.code) ? error : cleaner(error);
    if (!storage?.account || !storage.readBlogSyncState || !storage.writeBlogSyncState || !auth || !remote || !blog?.pack || !photoPost?.validate) throw fault('auth_required');
    const owner = storage.account, queues = new Map(), listeners = new Set(), generations = new Map();
    const holds = new Map(), retries = new Map(), draftDue = new Map();
    let disposed = false, started = false, timer = null, draftTimer = null, running = null, rerun = null, soon = null;
    // Delay of the next cycle while server posts wait for this device's first library (0: none waiting).
    let unplacedDelay = 0;
    // Set between a persisted pagehide and the next pageshow (back/forward cache).
    let parked = false;
    const removers = [];
    const summary = { state: 'idle', pending: 0, errors: 0, receiving: 0, posts: null, drafts: null, lastSyncAt: null, lastError: null, running: false };
    const canonical = syncCommon().canonical; // S0 group G3, shared with material-continuity-sync
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
    // Files of all receiving posts share one bounded set of transfers (2026-11-03:
    // one file after another made a new device wait about 16 s for 20 rows).
    let transfers = 0; const waitingTransfers = [];
    // Bytes of the posts being received, from download until their local commit. A post
    // waits while others hold more than receiveBytes together (iPhone memory: one post can
    // hold 20 photos and 256 MB); a single larger post still goes alone.
    let heldBytes = 0; const waitingBytes = [];
    async function withBytes(row, task) {
      const size = row.data.photos.reduce((sum, photo) => sum + photo.size + (photo.view?.size || 0), 0);
      while (heldBytes > 0 && heldBytes + size > receiveBytes) await new Promise(resolve => waitingBytes.push(resolve));
      heldBytes += size;
      try { return await task(); }
      finally { heldBytes -= size; waitingBytes.splice(0).forEach(resolve => resolve()); }
    }
    async function transfer(asset) {
      while (transfers >= downloadConcurrency) await new Promise(resolve => waitingTransfers.push(resolve));
      transfers++;
      try { return await remote.downloadAsset(asset); }
      finally { transfers--; waitingTransfers.shift()?.(); }
    }
    async function download(c, row) {
      const files = new Map();
      // Every original and view is still downloaded and checked; only their order is concurrent.
      // All of a post's transfers end before it fails, so its byte budget is not given back early.
      const results = await Promise.allSettled(row.data.photos.map(async photo => {
        const asset = row.assets[photo.id];
        const pair = await Promise.allSettled([transfer({ bucket: asset.bucket, path: asset.path }), photo.view ? transfer(asset.view) : undefined]);
        const rejected = pair.find(result => result.status === 'rejected'); if (rejected) throw rejected.reason; guard(c);
        const blob = typed(pair[0].value, photo), view = photo.view ? typed(pair[1].value, photo.view) : undefined;
        files.set(photo.id, view ? { blob, view } : { blob });
      }));
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      try { const doc = await blog.hydrate(row.data, files); guard(c); return doc; }
      catch (error) { guard(c); if (error?.code === 'request_cancelled') throw error; throw fault('invalid_remote_data'); }
    }
    function localDoc(remoteDoc, id, revision, ws, byRemote) {
      const doc = { ...remoteDoc, id, revision, replaces: remoteDoc.status === 'saved' ? null : localReplaces(ws, remoteDoc.replaces, byRemote) };
      photoPost.validate(doc); return doc;
    }
    // A copy of a copy keeps one prefix and gets the time its content was
    // written instead, e.g. "복구 사본 · 메모 (11-01 10:00 UTC)" (the form of a
    // restored backup's "(11-02 복원)"), so it differs from the one it lost to.
    // UTC, so every device names the same copy the same way; a title that
    // already ends with such a time gets no second one.
    const STAMP = / \(\d\d-\d\d \d\d:\d\d UTC\)$/;
    function recoveryTitle(title, writtenAt) {
      let value = String(title || ''), suffix = '';
      if (!value.startsWith(CONFLICT_PREFIX)) value = CONFLICT_PREFIX + value;
      else if (!STAMP.test(value)) {
        const at = new Date(Date.parse(writtenAt)), two = number => String(number).padStart(2, '0');
        if (Number.isFinite(at.getTime())) suffix = ' (' + two(at.getUTCMonth() + 1) + '-' + two(at.getUTCDate()) + ' ' + two(at.getUTCHours()) + ':' + two(at.getUTCMinutes()) + ' UTC)';
      }
      // Titles are limited to 500 UTF-16 units; cut whole characters only.
      let head = '';
      for (const char of value) { if (head.length + char.length + suffix.length > 500) break; head += char; }
      return head + suffix;
    }
    // A new unbound draft holding a document's content; it syncs as its own post.
    function draftCopy(doc, title, id = makeId(), replaces = null) {
      const base = typeof photoPost.upgrade === 'function' ? photoPost.upgrade({ ...doc, replaces: null }) : structuredClone({ ...doc, replaces: null });
      // The kept copy retains the time its content was written.
      Object.assign(base, { id, revision: 0, status: 'draft', replaces, title });
      if (Object.hasOwn(base, 'archived')) base.archived = false;
      photoPost.validate(base); return base;
    }
    const conflictCopy = (doc, id) => draftCopy(doc, recoveryTitle(doc.title, doc.updatedAt), id);
    // Title, body, attachments and the exact photo bytes (digests, HEIC views);
    // identity, status and times are not content. Equal sides need no copy.
    function contentOf(doc, { title = true } = {}) {
      const value = blog.pack(photoPost.compact(doc));
      for (const name of ['id', 'revision', 'status', 'replaces', 'createdAt', 'updatedAt', 'format', 'archived']) delete value[name];
      if (!title) delete value.title;
      for (const photo of value.photos || []) if (photo.view) photo.view = viewMeta(photo.view);
      return canonical(value);
    }
    const sameContent = (a, b) => contentOf(a) === contentOf(b);
    // The same recovery copy: a prefixed draft with the same body and photos
    // (its title may differ only by how a device named it).
    const sameCopy = (existing, doc) => existing?.status === 'draft' && !existing.replaces && String(existing.title || '').startsWith(CONFLICT_PREFIX) && contentOf(existing, { title: false }) === contentOf(doc, { title: false });
    // Identities for what a conflict over one exact server revision creates.
    // Every device deciding over that same revision makes the same ids, so two
    // devices' results meet as one post on the server and are decided there
    // like any other conflict (latest wins, the other kept) instead of
    // piling up as unrelated duplicates. A used or locally deleted id falls
    // back to a fresh one.
    async function derivedId(remoteId, revision, role) {
      const bytes = new Uint8Array(await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(['haedo-blog-conflict', owner.userId, remoteId, revision, role].join('\n'))));
      bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes.slice(0, 16), value => value.toString(16).padStart(2, '0')).join('');
      return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
    }
    // The derived id, and what this device already holds under it: another
    // device's result for the same server revision may have arrived first.
    async function conflictId(c, row, role) {
      const id = await derivedId(row.id, row.revision, role); guard(c);
      const value = await storage.listBlogSyncStates(c.ws); guard(c);
      const used = value.posts.some(item => item.id === id) || value.tombstones.some(item => item.remoteId === id) || value.states.some(item => item.state.remoteId === id);
      if (!used) return { id, existing: null };
      let existing = null;
      if (value.posts.some(item => item.id === id)) { try { existing = await storage.readPhotoPost(c.ws, id); } catch (_) { existing = null; } guard(c); }
      return { id, existing, used };
    }
    // The recovery copy of a server revision's content, unless this device
    // already holds that same copy (made here or received from another device).
    async function keptCopy(c, row, doc) {
      const derived = await conflictId(c, row, 'kept');
      if (!derived.used) return conflictCopy(doc, derived.id);
      return sameCopy(derived.existing, doc) ? null : conflictCopy(doc);
    }
    // Latest wins (2026-11-01 rule; 2026-11-02: saved posts are no exception).
    // Both sides are compared by the time their content was written
    // (document updatedAt): the only time both sides have, since this device's
    // unsent edit has no server time and the operation receipt carries none.
    // A server document cannot have been written after the server stored it,
    // so a device clock running ahead is bounded by the server commit time;
    // this device's own time is bounded by its current clock. An unreadable
    // time counts as oldest, and a tie keeps the server version: the server
    // orders commits, so every device decides the same way.
    function writtenAt(value, limit) {
      const at = typeof value === 'string' ? Date.parse(value) : NaN;
      if (!Number.isFinite(at)) return -Infinity;
      return Number.isFinite(limit) ? Math.min(at, limit) : at;
    }
    const remoteIsLater = (row, post) => writtenAt(row.data?.updatedAt, typeof row.updated_at === 'string' ? Date.parse(row.updated_at) : NaN) >= writtenAt(post.updatedAt, now());
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
      let result;
      try {
        result = await remote.save({ workspaceId: latest.remoteWorkspaceId, postId: latest.remoteId,
          expectedRevision: pending.expectedRevision, operationId: pending.operationId, data: pending.manifest }); guard(c);
      } catch (error) {
        // The server refuses to turn a saved post back into a draft. Decide it
        // as a conflict (by the latest-wins rule) instead of retrying forever.
        if (error?.code !== 'invalid_request' || pending.manifest.status !== 'draft' || attempt >= 2) throw error;
        const head = await remote.read(latest.remoteId); guard(c);
        if (head?.data.status !== 'saved') throw error;
        const fresh = await writeState(c, latest, { pending: null, status: 'pending', error: null });
        return resolveConflict(c, fresh, await readPost(c), attempt + 1, byRemote);
      }
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
    // The later document (remoteIsLater) stays and the other side is kept as a
    // recovery copy that itself syncs to every device.
    async function resolveConflict(c, state, post, attempt = 0, byRemote = null) {
      const row = await remote.read(state.remoteId); guard(c);
      if (!row) {
        await writeState(c, state, { remoteRevision: 0, remoteManifest: null, pending: null, conflict: null, publication: null, status: 'pending', error: null });
        return pushLocked(c, { attempt: attempt + 1, byRemote });
      }
      // The server never turns a saved post back into a draft, so this
      // device's draft cannot simply be sent over a saved server version.
      const regression = row.data.status === 'saved' && post.status === 'draft';
      if (row.revision === state.remoteRevision && !regression) return pushLocked(c, { attempt: attempt + 1, byRemote });
      const remoteWins = remoteIsLater(row, post);
      // Both outcomes that change this local document wait for an open editor,
      // checked again after the downloads (it may have opened meanwhile).
      let otherId = null; // an editing draft already here that this decision rewrites
      const waits = () => (remoteWins || regression) && held(c.ws, c.id) || !!otherId && held(c.ws, otherId);
      if (waits()) return getState(c.ws, c.id);
      const remoteDoc = await download(c, row);
      const map = byRemote || (await snapshot(c)).byRemote;
      if (waits()) return getState(c.ws, c.id);
      const same = sameContent(post, remoteDoc);
      if (remoteWins || regression) {
        const input = { postId: c.id, post: localDoc(remoteDoc, c.id, post.revision, c.ws, map), baseRevision: post.revision, binding: synced(state, row), bindingRevision: state.revision };
        if (same) { /* nothing differs: the server version is simply applied */ }
        else if (remoteWins) input.copy = conflictCopy(post);
        else {
          // The later draft wins over a saved server version. The server never
          // turns a saved post back into a draft, and the saved post keeps its
          // place and publication (a public copy changes only by an explicit
          // action). So the saved version stays in place unchanged, the later
          // draft becomes that post's editing draft (finishing it updates the
          // same post and, after an explicit republish, the same public
          // address), and the saved version's content is also kept as a
          // private recovery copy, so nothing is lost when the draft is finished.
          const exact = { id: c.id, revision: post.revision + 1 }, copies = [];
          const kept = await keptCopy(c, row, remoteDoc); if (kept) copies.push(kept);
          const derived = await conflictId(c, row, 'edit'), other = derived.existing;
          if (!derived.used) input.edit = draftCopy(post, post.title, derived.id, exact);
          else if (other?.status === 'draft' && other.replaces?.id === c.id) {
            // Another device's later draft over the same saved revision is
            // already here as this post's editing draft: the two drafts are
            // decided like any conflict. The later one stays the editing draft
            // (a tie keeps the one already here) and the other is kept.
            otherId = other.id; if (waits()) return getState(c.ws, c.id);
            const ours = writtenAt(post.updatedAt, now()) > writtenAt(other.updatedAt, now());
            input.edit = ours ? { ...draftCopy(post, post.title, other.id, exact), revision: other.revision } : { ...structuredClone(other), replaces: exact };
            if (!sameContent(post, other)) copies.push(conflictCopy(ours ? other : post));
          } else input.edit = draftCopy(post, post.title, makeId(), exact);
          if (copies.length) input.copy = copies;
          if (waits()) return getState(c.ws, c.id);
        }
        await storage.commitBlogSync(c.ws, input, { isCurrent: () => current(c) });
        guard(c); emit(c.ws, c.id); retries.delete(key(c.ws, c.id));
        kick(1000); // the kept draft reaches the other devices promptly
        return getState(c.ws, c.id);
      }
      await storage.commitBlogSync(c.ws, { postId: c.id, baseRevision: post.revision,
        binding: synced(state, row, { localRevision: state.localRevision, status: 'pending' }), bindingRevision: state.revision,
        ...(same ? {} : await keptCopy(c, row, { ...remoteDoc, id: c.id, revision: post.revision, replaces: null }).then(copy => copy ? { copy } : {})) }, { isCurrent: () => current(c) });
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
          return await withBytes(row, async () => {
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
          });
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
          return await withBytes(row, async () => {
            const doc = localDoc(await download(c, row), id, post.revision, ws, byRemote);
            if (held(ws, id)) return null; // an editor opened during the download
            await storage.commitBlogSync(ws, { postId: id, post: doc, baseRevision: post.revision, binding: synced(state, row), bindingRevision: state.revision }, { isCurrent: () => current(c) });
            guard(c); emit(ws, id); retries.delete(key(ws, id)); return id;
          });
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
      const removed = await serial(ws, id, async () => {
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
          guard(c); emit(ws, id); return { post, revision: state.remoteRevision };
        } catch (error) { await rememberError(c, error); throw explain(error); }
      });
      if (!removed) return;
      await release(ws, [id, remoteId]);
      await forget(ws, remoteId, removed);
    }
    // A recovery copy this device made of exactly the deleted revision (by a
    // conflict decided before the deletion was known) goes with it while it
    // has never left this device, unless it was changed since or is open: the
    // explicit deletion wins over what nobody has seen yet. A copy already
    // uploaded may be visible on the deleting device, where the owner chose to
    // keep it, so it stays on every device.
    async function forget(ws, remoteId, removed) {
      const copyId = await derivedId(remoteId, removed.revision, 'kept');
      await serial(ws, copyId, async () => {
        const c = context(ws, copyId);
        try {
          if (held(ws, copyId) || !(await storage.listBlogSyncStates(ws)).posts.some(row => row.id === copyId)) return;
          const state = await readState(c);
          if (state && (state.remoteRevision > 0 || state.pending)) return;
          const doc = await readPost(c);
          if (doc.status !== 'draft' || doc.replaces || doc.title !== recoveryTitle(removed.post.title, removed.post.updatedAt) || !sameContent(doc, { ...removed.post, title: doc.title })) return;
          await storage.deletePhotoPost(ws, copyId, doc.revision);
          generations.set(key(ws, copyId), (generations.get(key(ws, copyId)) || 0) + 1);
          emit(ws, copyId); kick(0);
        } catch (_) { /* The copy stays; nothing is lost. */ }
      });
    }
    // The deletion wins over editing drafts of the deleted post: each one stays
    // with its content and becomes a new post of its own (an open editor keeps
    // its draft as it is and still offers saving it as a new post).
    async function release(ws, targets) {
      const value = await storage.listBlogSyncStates(ws);
      for (const row of value.posts) {
        if (row.status !== 'draft' || held(ws, row.id)) continue;
        await serial(ws, row.id, async () => {
          const c = context(ws, row.id);
          try {
            const doc = await readPost(c);
            if (doc.status !== 'draft' || !doc.replaces || !targets.includes(doc.replaces.id) || held(ws, row.id)) return;
            await storage.savePhotoPost(ws, { ...doc, replaces: null }, doc.revision); guard(c); emit(ws, row.id);
          } catch (_) { /* The draft stays as it is; saving it as a new post remains available. */ }
        });
      }
    }
    // A deletion removes only the exact server revision this device last saw
    // (or its own unacknowledged request). A newer edit or a publication from
    // another device wins: the deletion is dropped and the next cycle installs
    // the server version here again, so nothing is lost.
    async function deleteRemote(c, tombstone) {
      const known = Number.isSafeInteger(tombstone.remoteRevision) ? tombstone.remoteRevision : null, own = Number.isSafeInteger(tombstone.pendingRevision) ? tombstone.pendingRevision : null;
      const legacy = known === null && !Object.hasOwn(tombstone, 'pendingRevision');
      let result = await remote.deletePost(tombstone.remoteId, legacy ? null : known > 0 ? known : own); guard(c);
      if (result.status === 'conflict' && own && known > 0 && result.revision === own) { result = await remote.deletePost(tombstone.remoteId, own); guard(c); }
      if (result.status === 'deleted' || result.status === 'missing') { if (result.paths.length) await remote.removeAssets(tombstone.remoteId, result.paths); guard(c); }
      else retries.delete(key(tombstone.ws, tombstone.remoteId));
      await storage.clearBlogTombstone(tombstone.ws, tombstone.remoteId);
      if (result.status === 'conflict' || result.status === 'published') kick(0);
      return result.status;
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
    async function pool(tasks, limit = concurrency) {
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
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
        // A recovery copy a conflict made here goes up only once its post is
        // confirmed on the server (one read, so a hidden page's upload-only
        // flush and a failing server list decide it too): if the post was
        // deleted on another device meanwhile, the copy that nobody has seen
        // yet is dropped with it (forget) instead of being sent. That post's
        // editing draft from the same decision goes up only after its copy,
        // so the server never holds the later draft without the losing content.
        const groups = await unseenCopies(c, local, uploads), waiting = new Set(groups.flatMap(group => [...group.copies, ...group.edits]));
        await pool(uploads.filter(item => !waiting.has(item)).map(({ ws, post }) => () => push(ws, post.id, { verify: false, byRemote: local.byRemote })));
        await pool(groups.map(group => async () => {
          await vanish(group.ws, group.localPostId, group.remoteId); // confirms the post (one read); removes it and forgets its copies when deleted
          const value = await storage.listBlogSyncStates(group.ws); guard(c);
          const present = item => value.posts.some(row => row.id === item.post.id);
          for (const item of group.copies) if (present(item)) await push(item.ws, item.post.id, { verify: false, byRemote: local.byRemote });
          for (const item of group.edits) if (present(item)) await push(item.ws, item.post.id, { verify: false, byRemote: local.byRemote });
        }));
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
          const tasks = []; let unplaced = 0;
          // Saved posts first, then the most recently written: the rows the list shows first arrive first.
          rows.sort((a, b) => Number(a.status === 'draft') - Number(b.status === 'draft') || Date.parse(b.document_updated_at) - Date.parse(a.document_updated_at));
          for (const row of rows) {
            if (deleted.has(row.id)) continue;
            const entry = local.byRemote.get(row.id);
            if (!entry) {
              const ws = await target(row);
              if (!ws) unplaced++;
              else if (!backingOff(ws, row.id)) tasks.push(() => install(ws, row, local.byRemote));
            } else if (entry.state.remoteRevision !== row.revision) {
              if (!backingOff(entry.ws, entry.localPostId)) tasks.push(() => apply(entry.ws, entry.localPostId, row, local.byRemote));
            } else if (canonical(entry.state.publication ?? null) !== canonical(row.publication ?? null)) tasks.push(() => refreshPublication(entry.ws, entry.localPostId, row));
          }
          for (const [remoteId, entry] of local.byRemote) {
            if (!seen.has(remoteId) && entry.state.remoteRevision > 0 && !backingOff(entry.ws, entry.localPostId)) tasks.push(() => vanish(entry.ws, entry.localPostId, remoteId));
          }
          await pool(tasks, receiveConcurrency);
          // A new device can list the account's posts before its first library is stored
          // (2026-11-03 CI: the second browser then waited the whole 30 s interval).
          // Look again soon, backing off up to the interval while none is there.
          unplacedDelay = unplaced ? Math.min(unplacedDelay ? unplacedDelay * 2 : 500, interval) : 0;
          if (unplacedDelay) soon = Math.min(soon ?? unplacedDelay, unplacedDelay);
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
    // Never-uploaded drafts that are the recovery copy of a bound post's
    // current server revision (by their derived id), grouped by that post with
    // the editing draft made by the same decision.
    async function unseenCopies(c, local, uploads) {
      const fresh = uploads.filter(({ ws, post }) => post.status === 'draft' && !local.workspaces.get(ws).states.get(post.id));
      if (!fresh.length) return [];
      const groups = [];
      for (const [remoteId, entry] of local.byRemote) {
        if (entry.state.remoteRevision === 0) continue;
        const kept = await derivedId(remoteId, entry.state.remoteRevision, 'kept'); guard(c);
        const copies = fresh.filter(item => item.ws === entry.ws && item.post.id === kept);
        if (!copies.length) continue;
        const edit = await derivedId(remoteId, entry.state.remoteRevision, 'edit'); guard(c);
        groups.push({ ws: entry.ws, localPostId: entry.localPostId, remoteId, copies, edits: uploads.filter(item => item.ws === entry.ws && item.post.id === edit) });
      }
      return groups;
    }
    async function tally(c, rows) {
      const libraries = await storage.listAccountLibraries(); guard(c);
      const eligible = new Set(libraries.filter(item => item.eligible !== false).map(item => item.workspaceId));
      const local = await snapshot(c, libraries.map(item => item.workspaceId)); let pending = 0, errors = 0, receiving = 0, posts = 0, drafts = 0;
      for (const [ws, value] of local.workspaces) for (const post of value.posts) {
        const status = statusOf(ws, post, value.states.get(post.id));
        if (status === 'error') errors++; else if (status === 'pending') pending++;
        // The account's blog as the home lists it: every library but recovery copies.
        if (eligible.has(ws)) { if (post.status === 'draft') drafts++; else posts++; }
      }
      for (const item of local.tombstones) if (retries.get(key(item.ws, 'delete:' + item.remoteId))?.error) errors++; else pending++;
      if (rows) {
        const deleted = new Set(local.tombstones.map(item => item.remoteId));
        for (const row of rows) if (!local.byRemote.has(row.id) && !deleted.has(row.id)) { if ([...retries].some(([k, value]) => k.endsWith('/' + row.id) && value.error)) errors++; else receiving++; }
      }
      Object.assign(summary, { pending, errors, receiving, posts, drafts, state: summary.lastError || errors ? 'error' : pending || receiving ? 'pending' : 'synced' });
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
      timer = timers.setTimeout(() => {
        timer = null;
        // A hidden page stops pulling the server list, but anything waiting
        // here (a saved edit, a draft, a kept conflict copy, a deletion) still
        // goes up. The check is local only; no request is made otherwise.
        if (events?.document?.visibilityState === 'hidden') { void localWork().then(waiting => { if (waiting && !disposed) return syncNow({ uploadOnly: true, flushDrafts: true }); }).catch(() => {}); return; }
        void syncNow();
      }, delay);
    }
    // Whether this device has anything to upload or delete, read locally.
    async function localWork() {
      const libraries = await storage.listAccountLibraries();
      for (const item of libraries) {
        if (item.eligible === false) continue;
        const value = await storage.listBlogSyncStates(item.workspaceId), states = new Map(value.states.map(entry => [entry.localPostId, entry.state]));
        if (value.tombstones.length || value.posts.some(post => dirty(states.get(post.id), post))) return true;
      }
      return false;
    }
    // A request made while a cycle runs (e.g. a kept conflict copy that should
    // go up now) is remembered: the end of the cycle must not postpone it to
    // the regular interval.
    function kick(delay = 0) { if (!started) return; if (running) soon = Math.min(soon ?? delay, delay); else schedule(delay); }
    async function syncNow(options = {}) {
      // A cached page starts nothing: script running there evicts it from the
      // back/forward cache, and an account check begun while the private view is
      // concealed must not serve the resumed page's own verification.
      if (disposed || parked) return getStatus();
      // An explicit retry or a restored connection does not wait for backoff.
      if (options.force) for (const value of retries.values()) value.until = 0;
      // Requests that land on a running cycle merge into one rerun: it stays
      // upload-only only when every merged request was (a hidden page never
      // pulls the list), and flushes drafts when any of them asked to.
      if (running) {
        rerun = rerun ? { uploadOnly: !!rerun.uploadOnly && !!options.uploadOnly, flushDrafts: !!rerun.flushDrafts || !!options.flushDrafts }
          : { uploadOnly: !!options.uploadOnly, flushDrafts: !!options.flushDrafts };
        return running;
      }
      if (timer) { timers.clearTimeout(timer); timer = null; }
      running = (async () => {
        let next = options, result;
        try {
          while (next && !disposed) { rerun = null; result = await withLock(() => cycle(next)); next = rerun; }
        } finally { running = null; const next = soon ?? interval; soon = null; schedule(next); }
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
      on(events, 'pagehide', event => { if (event?.persisted) parked = true; else void syncNow({ uploadOnly: true, flushDrafts: true }); });
      // The resumed page verifies its account first; each later cycle verifies again.
      on(events, 'pageshow', event => { if (event?.persisted && parked) { parked = false; schedule(interval); } });
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
      const copies = state.publishPending.copies?.length ? { copies: state.publishPending.copies } : {};
      try { result = await remote.publish(state.remoteId, state.publishPending.expectedRevision, state.publishPending.operationId, { ...state.publishPending.selection, ...copies, expectedPublicRevision: state.publishPending.expectedPublicRevision }); guard(c); }
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
    // Public copies (2026-11-02): every selected photo, in every format, is
    // published only as a metadata-free re-encoding (HEIC/HEIF from their JPEG
    // view). `provided` are the copies the reviewer previewed; missing ones are
    // made here. Copies are uploaded before the durable request names them.
    const copyMeta = ({ id, type, size, digest, width, height }) => ({ id, type, size, digest, width, height });
    async function publicCopies(c, post, photoIds, provided) {
      const given = new Map((Array.isArray(provided) ? provided : []).map(copy => [copy?.id, copy])), copies = [];
      for (const photoId of photoIds) {
        const photo = post.photos.find(item => item.id === photoId);
        if (!photo) continue;
        const copy = given.has(photoId) ? photoPost.checkPublicCopy(photo, given.get(photoId)) : await photoPost.publicCopy(photo); guard(c);
        if (await photoPost.digest(copy.blob) !== copy.digest) throw Object.assign(new Error('공개용 사진 사본 정보를 확인해 주세요.'), { code: 'invalid_photo_post' });
        guard(c); copies.push(copy);
      }
      return copies;
    }
    async function publish(ws, id, options = {}) {
      const choices = structuredClone(options), c = context(ws, id); await verified(c);
      const initial = await readPost(c);
      if (initial.revision !== choices.expectedLocalRevision) throw fault('local_changed');
      if (initial.status !== 'saved') throw fault('invalid_request');
      const before = await readState(c);
      const selection = { photoIds: choices.photoIds || [], author: choices.author || { name: '', intro: '' } };
      const needsCopies = selection.photoIds.length > 0;
      // A request recorded before public copies existed would publish an
      // original; it is replaced by a new request with copies.
      const usable = pending => !!pending && (!needsCopies || !!pending.copies);
      if (usable(before?.publishPending)) {
        if (before.publishPending.localRevision !== initial.revision || canonical(before.publishPending.selection) !== canonical(selection)) throw fault('local_changed');
        return serial(ws, id, async () => {
          const state = await readState(c), latest = await readPost(c);
          if (latest.revision !== initial.revision || state?.publishPending?.operationId !== before.publishPending.operationId) throw fault('local_changed');
          return finishPublication(c, state);
        });
      }
      if (choices.expectedRemoteRevision !== undefined && choices.expectedRemoteRevision !== (before?.remoteRevision || 0) || choices.expectedPublicRevision !== undefined && choices.expectedPublicRevision !== (before?.publication?.revision || 0)) throw fault('local_changed');
      const copies = await publicCopies(c, initial, selection.photoIds, choices.copies);
      await blog.publicSnapshot(initial, { ...selection, copies: copies.map(copyMeta) }); guard(c);
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
        if (usable(state.publishPending) && canonical(state.publishPending.selection) !== canonical(selection)) throw fault('operation_mismatch');
        if (!usable(state.publishPending)) {
          for (const copy of copies) { await remote.uploadPublicCopy(state.remoteId, copyMeta(copy), copy.blob); guard(c); }
          state = await writeState(c, state, { publishPending: { operationId: makeId(), expectedRevision: state.remoteRevision, expectedPublicRevision: state.publication?.revision || 0, localRevision: latest.revision, selection,
            ...(copies.length ? { copies: copies.map(copyMeta) } : {}) } });
        }
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
    if (autoSync) { live.add(api); liveStorage.set(api, storage); start(); }
    return api;
  }
  return Object.freeze({ create, noteLocalDraftSaved, forStorage, CONFLICT_PREFIX });
});

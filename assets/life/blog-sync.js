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
  // S2b: page-lifecycle wiring (sync-lifecycle.js), as the other sync engines (S2a). An older cached
  // page may lack it: the engine then binds no page events and keeps its own scheduled passes and
  // explicit syncs, until the page reloads.
  const syncLifecycle = () => root.HaedoLife?.SyncLifecycle || (typeof require === 'function' ? require('./sync-lifecycle.js') : null);
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
  // What this device can say about a post's public copy (2026-11-11). While a publish or a
  // withdrawal this device sent has no known result, the server may differ from the recorded
  // publication: the post is then neither "public" nor "private" but "unknown" until a server
  // head settles it (settleLocked). A publish request that an exact head showed as not applied
  // yet (publishChecked names it) no longer hides the recorded state; it is still kept and
  // named by publicationNotice, because a request can arrive after such a check.
  // publishRevoked: a withdrawal met an unanswered first publication that the server offers no
  // way to cancel (no publication row to move). For LATE_WINDOW after that withdrawal the
  // request may plausibly still be on its way, so the post stays "unknown"; the guard itself
  // stays for as long as that request could be applied and withdraws it when it arrives.
  const LATE_WINDOW = 2 * 60 * 1000;
  function publicationStatus(state, at = Date.now()) {
    if (state?.unpublishPending) return 'unknown';
    if (state?.publishPending && state.publishChecked !== state.publishPending.operationId) return 'unknown';
    if (state?.publishRevoked) { const age = at - Date.parse(state.publishRevoked.at); if (Number.isFinite(age) && age < LATE_WINDOW) return 'unknown'; }
    return state?.publication?.active === true ? 'public' : 'private';
  }
  // What a screen says next to a known status, so an unanswered request is never silent:
  // 'publish_unapplied' (not public; a publish request is not applied yet),
  // 'update_unapplied' (public; an update is not applied yet, the earlier copy is what is public),
  // 'late_publish_guarded' (withdrawn; an unanswered publish request is withdrawn if it arrives),
  // 'copy_unverified' (public; whether the copy is the last reviewed choice could not be told).
  function publicationNotice(state, at = Date.now()) {
    const status = publicationStatus(state, at);
    if (status === 'unknown') return null;
    if (state?.publishPending) return status === 'public' ? 'update_unapplied' : 'publish_unapplied';
    if (state?.publishRevoked) return 'late_publish_guarded';
    if (status === 'public' && state?.publicationDoubt === true) return 'copy_unverified';
    return null;
  }
  function create({ storage, auth = root.HaedoAuth, blog = root.HaedoLife?.Blog,
    photoPost = root.HaedoLife?.PhotoPost, remote = root.HaedoLife?.BlogRemote?.create({ auth, blog }),
    makeId = () => root.crypto.randomUUID(), autoSync = false, interval = 30000, concurrency = 2, receiveConcurrency = 4, downloadConcurrency = 6, receiveBytes = 160 * 1024 * 1024,
    now = () => Date.now(), timers = root, locks = root.navigator?.locks, events = root, publicReader = null } = {}) {
    const cleaner = root.HaedoLife?.BlogRemote?.clean || (error => error);
    const fault = code => cleaner({ code });
    // Publishing and withdrawing are never retried like a document save; their connection
    // failures say what is actually known (BlogRemote.publicationFault, same code).
    const publicationFault = kind => root.HaedoLife?.BlogRemote?.publicationFault?.(kind) || fault('network_error');
    // Local storage faults carry their own user message; only server faults are normalized.
    const explain = error => typeof error?.code === 'string' && /^(photo_post_|blog_post_|blog_state_|storage_|invalid_photo_post$|workspace_)/.test(error.code) ? error : cleaner(error);
    if (!storage?.account || !storage.readBlogSyncState || !storage.writeBlogSyncState || !auth || !remote || !blog?.pack || !photoPost?.validate) throw fault('auth_required');
    const owner = storage.account, queues = new Map(), listeners = new Set(), generations = new Map();
    const holds = new Map(), retries = new Map(), draftDue = new Map();
    let disposed = false, started = false, timer = null, timerDue = 0, draftTimer = null, running = null, rerun = null, soon = null;
    // Delay of the next cycle while server posts wait for this device's first library (0: none waiting).
    let unplacedDelay = 0;
    // Set between a persisted pagehide and the next pageshow (back/forward cache).
    let parked = false;
    let wiring = null;
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
      return { ...(state || {}), workspaceId: ws, localPostId: id, enabled: true, status: statusOf(ws, post, state),
        publicationStatus: publicationStatus(state, now()), publicationNotice: publicationNotice(state, now()) };
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
    // A transfer that waited for a slot starts only while its cycle is still current: after an
    // account change or dispose the queued files are not fetched, and BlogRemote aborts the ones
    // already in progress (2026-11-04).
    async function transfer(c, asset) {
      while (transfers >= downloadConcurrency) await new Promise(resolve => waitingTransfers.push(resolve));
      transfers++;
      try { guard(c); return await remote.downloadAsset(asset); }
      finally { transfers--; waitingTransfers.shift()?.(); }
    }
    async function download(c, row) {
      const files = new Map();
      // Every original and view is still downloaded and checked; only their order is concurrent.
      // All of a post's transfers end before it fails, so its byte budget is not given back early.
      const results = await Promise.allSettled(row.data.photos.map(async photo => {
        const asset = row.assets[photo.id];
        const pair = await Promise.allSettled([transfer(c, { bucket: asset.bucket, path: asset.path }), photo.view ? transfer(c, asset.view) : undefined]);
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
    // Publishing and withdrawing keep the post's remoteRevision; only the publication's own revision
    // grows. A list read before this device's later publish or withdrawal (2026-11-04: the list is
    // requested together with the account check) carries an older publication: it is not taken.
    const publicRevision = value => value?.revision || 0;
    async function refreshPublication(ws, id, head) {
      return serial(ws, id, async () => {
        const c = context(ws, id), state = await readState(c);
        if (state?.remoteId === head.id && state.remoteRevision === head.revision && canonical(state.publication ?? null) !== canonical(head.publication ?? null) && !state.publishPending && !state.unpublishPending &&
            publicRevision(head.publication) >= publicRevision(state.publication))
          await writeState(c, state, { publication: head.publication ?? null });
      });
    }
    // ---- publication settlement (2026-11-11) -----------------------------------------------
    // The exact server head decides what this device records about a post's public copy and
    // about its own unanswered publish and withdraw requests. It runs in the post's queue and
    // under the post's Web Lock (postLock), so the head it reads is never older than a result
    // this device recorded and no other tab of this browser judges a request that is still
    // being sent. Rules, with the SQL they rest on (publish/publish_copies, unpublish and the
    // Markdown commit all check receipts first, then the publication revision):
    // - A head beyond a publish request's publication revision ends that request: it was
    //   applied (the head is its result) or can no longer be applied.
    // - A publish request the head shows as not applied is never sent again from here: nothing
    //   becomes public without the owner's action. It stays for an explicit retry of the same
    //   choice and is marked checked (publishChecked). It may still arrive later, so it is
    //   never recorded as "not applied" for good.
    // - `replace` (a new explicit choice or a withdrawal) ends an unanswered publish request
    //   when the server can make that certain: with a publication row that is not active, one
    //   withdrawal request moves the publication revision and the old request can only end in
    //   conflict. With an active publication the row is left alone (withdrawing it would change
    //   the public address) and with no row at all nothing can be moved: the request is then
    //   returned as `replaced`, still able to arrive, for the caller to guard against.
    // - A withdrawal the head shows as not applied is sent again with its own operation id, only
    //   against the exact publication revision it was made for: withdrawing is the safe
    //   direction and the server receipt makes it idempotent.
    // - publishRevoked (see publicationStatus): when exactly that request's copy appears, it is
    //   withdrawn; any other publication or a newer post revision ends the guard.
    // A failed read or request leaves the state as it was (still "unknown") and throws.
    const descriptor = ({ operationId, expectedRevision, expectedPublicRevision, selection, copies }) => ({ operationId, expectedRevision, expectedPublicRevision: expectedPublicRevision || 0,
      selection: structuredClone(selection), ...(copies ? { copies: structuredClone(copies) } : {}) });
    // The author and photo copies of a public copy, read the way a visitor reads it (no private
    // session). null: not readable as public now. undefined: this page has no public reader.
    async function publicFacts(c, publication) {
      const reader = publicReader || root.HaedoLife?.BlogPublic?.createReader?.({ config: auth.config });
      if (typeof reader?.read !== 'function') return undefined;
      try {
        const post = await reader.read(publication.token); guard(c);
        return post ? { author: { name: post.snapshot.author.name, intro: post.snapshot.author.intro }, photos: post.snapshot.photos.map(photo => photo.digest) } : null;
      } catch (error) { guard(c); throw fault(['schema_missing', 'invalid_remote_data', 'request_cancelled'].includes(error?.code) ? error.code : 'network_error'); }
      finally { if (!publicReader) reader.dispose?.(); }
    }
    // Whether a public copy is what one publish request of this device asked for: the same name
    // and intro and exactly its photo copies. Without a public reader the request's revision is
    // the only evidence (the caller already matched it).
    const sameRequest = (facts, request) => facts === undefined || !!facts && canonical(facts.author) === canonical(request.selection.author) &&
      canonical([...facts.photos].sort()) === canonical((request.copies || []).map(copy => copy.digest).sort()) && facts.photos.length === request.selection.photoIds.length;
    // A state write that follows a server answer must not be lost to another tab's write of the
    // same binding (a document upload, a status): read again and apply the same fields.
    async function patch(c, change) {
      for (let attempt = 0; ; attempt++) {
        const latest = await readState(c), changes = typeof change === 'function' ? change(latest) : change;
        if (!latest || !changes || !Object.keys(changes).length) return latest;
        try { return await writeState(c, latest, changes); }
        catch (error) { if (error?.code !== 'blog_state_conflict' || attempt >= 5) throw error; }
      }
    }
    // One post's publish, withdrawal and settlement run one at a time across the tabs of this
    // browser. Without Web Locks (an older browser, tests) only this page's own queue applies.
    function postLock(ws, id, task, { ifAvailable = false } = {}) {
      if (typeof locks?.request !== 'function') return task();
      let ran = false;
      return Promise.resolve(locks.request('haedo-blog-publication:' + owner.projectUrl + ':' + owner.userId + ':' + ws + '/' + id, ifAvailable ? { ifAvailable: true } : {}, async lock => {
        if (!lock) return undefined; ran = true; return task();
      })).then(result => ran ? result : undefined);
    }
    // What the settlement did by itself, kept with the post so it is said on its screens
    // (publicationLog) and reported to the screen that is open (publication_notice).
    function logged(code) { return { publicationLog: { code, at: new Date(now()).toISOString() } }; }
    async function settleLocked(c, { replace = false, sent = null } = {}) {
      let state = await readState(c);
      if (!state?.remoteId) return { state, replaced: null, notes: [], moved: null };
      const changes = {}, notes = []; let replaced = null, moved = null;
      const differs = (name, value) => { if (canonical(state[name] ?? null) !== canonical(value ?? null)) changes[name] = value ?? null; };
      // A withdrawal request against the exact revision; a conflict means the head moved meanwhile.
      const withdraw = async (operationId, expectedRevision) => {
        if (sent) sent.value = true;
        try { await remote.unpublish(state.remoteId, expectedRevision, operationId); guard(c); }
        catch (error) { guard(c); if (error?.code !== 'blog_conflict') throw error; }
        return remote.read(state.remoteId);
      };
      let publication = null;
      // Nothing was stored on the server under this identity yet: nothing can be public.
      if (!(state.remoteRevision > 0)) { differs('publishPending', null); differs('unpublishPending', null); differs('publishRevoked', null); publication = state.publication ?? null; }
      else {
        let row = await remote.read(state.remoteId); guard(c);
        const publishing = state.publishPending, withdrawing = state.unpublishPending, revoked = state.publishRevoked;
        if (withdrawing) {
          // `ending`: this request only moves the revision of a publication that is not active, to
          // end an unanswered publish request; it is repeated until the revision has moved.
          const live = !!row?.publication?.active;
          if (row?.publication && row.publication.revision === withdrawing.expectedRevision && (live || withdrawing.ending)) {
            row = await withdraw(withdrawing.operationId, withdrawing.expectedRevision); guard(c);
            // Not silent: a withdrawal sent again long after it was asked is said on the post.
            if (live && !row?.publication?.active) { notes.push('withdrawal_resent'); Object.assign(changes, logged('withdrawal_resent')); }
          }
          changes.unpublishPending = null;
        }
        if (publishing) {
          if (!row || publicRevision(row.publication) > (publishing.expectedPublicRevision || 0)) {
            changes.publishPending = null;
            // Two unanswered requests shared this revision: say when the copy is not provably the last choice.
            if (publishing.contested && row?.publication?.active) changes.publicationDoubt = !sameRequest(await publicFacts(c, row.publication), publishing) || undefined;
          } else if (replace) { changes.publishPending = null; replaced = descriptor(publishing); }
          else if (state.publishChecked !== publishing.operationId) changes.publishChecked = publishing.operationId;
        }
        if (revoked) {
          const first = (revoked.expectedPublicRevision || 0) + 1;
          if (!row || row.revision !== revoked.expectedRevision || state.remoteRevision !== revoked.expectedRevision) changes.publishRevoked = null; // a newer post revision: it can no longer apply
          else if (!row.publication) { if (replace) { changes.publishRevoked = null; replaced ||= descriptor(revoked); } } // still able to arrive
          else if (row.publication.active && row.publication.revision === first && sameRequest(await publicFacts(c, row.publication), revoked)) {
            // The request the owner withdrew arrived afterwards: the withdrawal still stands.
            const operationId = makeId();
            state = await writeState(c, state, { ...changes, publishRevoked: null, unpublishPending: { operationId, expectedRevision: first } });
            for (const name of Object.keys(changes)) delete changes[name];
            row = await withdraw(operationId, first); guard(c);
            changes.unpublishPending = null;
            if (!row?.publication?.active) { notes.push('late_publication_withdrawn'); Object.assign(changes, logged('late_publication_withdrawn')); }
          } else changes.publishRevoked = null; // a publication row exists now: its revision check refuses that request
        }
        // A replaced request that the server can end for certain: the publication is not active,
        // so moving its revision costs no public address and no visitor anything.
        if (replaced && row?.publication && !row.publication.active) {
          const operationId = makeId(), expectedRevision = row.publication.revision;
          // The replaced request stays recorded until the revision has really moved: if this
          // request gets no answer, the next settlement repeats it (`ending`) before anything
          // forgets the request it is meant to end.
          const keep = {}; for (const name of ['publishPending', 'publishRevoked']) if (Object.hasOwn(changes, name)) { keep[name] = changes[name]; delete changes[name]; }
          state = await writeState(c, state, { ...changes, unpublishPending: { operationId, expectedRevision, ending: true } });
          for (const name of Object.keys(changes)) delete changes[name];
          row = await withdraw(operationId, expectedRevision); guard(c);
          Object.assign(changes, keep); changes.unpublishPending = null;
          // `moved`: the revision this request moved, with nothing public before or after.
          if (row?.publication && publicRevision(row.publication) > expectedRevision) { replaced = null; if (!row.publication.active && row.publication.revision === expectedRevision + 1) moved = { from: expectedRevision, to: row.publication.revision }; }
        }
        publication = row?.publication ?? null;
        if (!publication?.active && state.publicationDoubt) changes.publicationDoubt = null;
      }
      differs('publication', publication);
      if (changes.publicationDoubt === undefined) delete changes.publicationDoubt;
      if (Object.keys(changes).length) state = await writeState(c, state, changes);
      for (const code of notes) publish$({ type: 'publication_notice', code, workspaceId: c.ws, localPostId: c.id });
      return { state, replaced, notes, moved };
    }
    // One exact check for a screen's "공개 상태 확인" and before a review compares its preview.
    async function settlePublication(ws, id) {
      try {
        return await postLock(ws, id, () => serial(ws, id, async () => {
          const c = context(ws, id); await verified(c); await settleLocked(c);
          return getState(ws, id);
        }));
      } catch (error) { const failure = explain(error); throw failure?.code === 'network_error' ? publicationFault('settle_failed') : failure; }
    }
    // The cycle's own check. It does not wait for another tab that is sending this post's request
    // (that tab records the result), and a failure keeps the post "unknown" until the next cycle.
    function settleQuiet(ws, id) {
      return postLock(ws, id, () => serial(ws, id, async () => { try { await settleLocked(context(ws, id)); } catch (_) { /* Still unsettled. */ } }), { ifAvailable: true });
    }
    const unsettled = state => !!state?.unpublishPending || !!state?.publishPending || !!state?.publishRevoked;
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
      // The post comes back with the next cycle; a screen can say why (it is public on the server).
      if (result.status === 'published') publish$({ type: 'delete_refused', reason: 'published', workspaceId: tombstone.ws, remoteId: tombstone.remoteId });
      return result.status;
    }
    // ---- explicit deletion -----------------------------------------------------
    async function deletePost(ws, id, { expectedRevision } = {}) {
      return postLock(ws, id, () => serial(ws, id, async () => {
        const c = context(ws, id); guard(c);
        const post = await readPost(c);
        if (expectedRevision !== undefined && post.revision !== expectedRevision) throw Object.assign(new Error('글이 바뀌었습니다. 목록을 다시 확인한 뒤 삭제해 주세요.'), { code: 'photo_post_conflict' });
        // A publish or withdrawal without a known result: the server may hold a public copy.
        // Ask it before deleting, so a public post is refused here instead of coming back later.
        if (publicationStatus(await readState(c), now()) === 'unknown') {
          try { await verified(c); await settleLocked(c); }
          catch (error) {
            if (explain(error)?.code === 'request_cancelled') throw explain(error);
            throw Object.assign(new Error('공개 상태를 확인하지 못해 삭제하지 않았습니다. 연결을 확인한 뒤 공개 상태를 확인하고 삭제해 주세요.'), { code: 'blog_post_unsettled' });
          }
        }
        const result = await storage.deletePhotoPost(ws, id, post.revision);
        generations.set(key(ws, id), (generations.get(key(ws, id)) || 0) + 1);
        emit(ws, id); kick(0); return result;
      }));
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
      // The server post list is requested together with the cycle's account check (2026-11-04:
      // one round trip less before a new device's first row). It is read only after that check
      // passes and only when this cycle sent nothing to the server first; otherwise the list is
      // requested again at the same point as before. Each listed row stays a hint: apply,
      // install and vanish read the exact server row themselves.
      const early = uploadOnly ? null : remote.syncList();
      early?.catch(() => {});
      try {
        await verified(c);
        const libraries = await storage.listAccountLibraries(); guard(c);
        const owned = libraries.map(item => item.workspaceId), eligible = libraries.filter(item => item.eligible !== false).map(item => item.workspaceId);
        let local = await snapshot(c, owned);
        // Whether this cycle may send anything to the server before it lists (then the early list is not used).
        let sent = local.tombstones.length > 0 || local.duplicates.length > 0;
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
          if (uploads.length || groups.length) sent = true;
          local = await snapshot(c, owned);
          rows = await (early && !sent ? early.catch(() => remote.syncList()) : remote.syncList()); guard(c);
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
            } else {
              const moved = canonical(entry.state.publication ?? null) !== canonical(row.publication ?? null);
              if (entry.state.remoteRevision !== row.revision) {
                if (!backingOff(entry.ws, entry.localPostId)) tasks.push(() => apply(entry.ws, entry.localPostId, row, local.byRemote));
              } else if (moved && !unsettled(entry.state)) tasks.push(() => refreshPublication(entry.ws, entry.localPostId, row));
              // An unacknowledged publish or withdrawal is settled against the exact head, once per
              // cycle while its result is unknown and again whenever the listed publication moves.
              if (unsettled(entry.state) && (moved || publicationStatus(entry.state, now()) === 'unknown')) tasks.push(() => settleQuiet(entry.ws, entry.localPostId));
            }
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
      timerDue = now() + delay;
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
      // An upload-only pass may skip the server list; a normal pass on a hidden page
      // may skip a draft still in its quiet period. Neither replaces the already due
      // pass (including the hidden timer's draft flush). Keep its absolute deadline:
      // time spent in this cycle must not postpone it. A fired timer has been consumed
      // above, so an overdue follow-up runs once rather than retaining a zero-delay loop.
      const preservedDue = timer && (options.uploadOnly || events?.document?.visibilityState === 'hidden') ? timerDue : null;
      if (timer) {
        timers.clearTimeout(timer); timer = null;
      }
      running = (async () => {
        let next = options, result;
        try {
          while (next && !disposed) { rerun = null; result = await withLock(() => cycle(next)); next = rerun; }
        } finally {
          running = null;
          const next = soon ?? interval;
          soon = null; schedule(preservedDue === null ? next : Math.min(next, Math.max(0, preservedDue - now())));
        }
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
    // Page events. A restored connection does not wait for backoff; a page that is not kept
    // flushes its uploads and drafts; a parked page (back/forward cache) starts nothing.
    function online() { void syncNow({ force: true }); }
    function focus() { kick(0); }
    function pagehide(event) { if (event?.persisted) parked = true; else void syncNow({ uploadOnly: true, flushDrafts: true }); }
    // The resumed page verifies its account first; each later cycle verifies again.
    function pageshow(event) { if (event?.persisted && parked) { parked = false; schedule(interval); } }
    function visibility() {
      if (events?.document?.visibilityState === 'hidden') void syncNow({ uploadOnly: true, flushDrafts: true }); else kick(0);
    }
    function start() {
      if (disposed || started) return; started = true;
      // No poll: each pass schedules the next one itself (interval, backoff, drafts).
      wiring = events ? syncLifecycle()?.attach(events, {
        listen: [['window', 'online', online], ['window', 'focus', focus], ['window', 'pagehide', pagehide],
          ['window', 'pageshow', pageshow], ['document', 'visibilitychange', visibility]],
      }) || null : null;
      schedule(0);
    }
    function stop() {
      started = false; wiring?.detach(); wiring = null;
      if (timer) timers.clearTimeout(timer); if (draftTimer) timers.clearTimeout(draftTimer); timer = draftTimer = null;
    }
    // Per-post status for lists, computed locally without network.
    async function statuses(ws) {
      const value = await storage.listBlogSyncStates(ws), states = new Map(value.states.map(entry => [entry.localPostId, entry.state]));
      return Object.fromEntries(value.posts.map(post => [post.id, statusOf(ws, post, states.get(post.id))]));
    }
    // Per-post publication status ('public' | 'private' | 'unknown') for lists, computed locally.
    async function publicationStatuses(ws) {
      const value = await storage.listBlogSyncStates(ws), states = new Map(value.states.map(entry => [entry.localPostId, entry.state]));
      return Object.fromEntries(value.posts.map(post => [post.id, publicationStatus(states.get(post.id), now())]));
    }
    // The same for what a list says next to the status (publicationNotice); posts without one are left out.
    async function publicationNotices(ws) {
      const value = await storage.listBlogSyncStates(ws), states = new Map(value.states.map(entry => [entry.localPostId, entry.state]));
      return Object.fromEntries(value.posts.map(post => [post.id, publicationNotice(states.get(post.id), now())]).filter(([, notice]) => notice));
    }
    // An open editor holds its post: remote changes wait until it is released.
    function holdPost(ws, id) {
      const k = key(ws, id); holds.set(k, (holds.get(k) || 0) + 1); let released = false;
      return () => { if (released) return; released = true; const count = (holds.get(k) || 1) - 1; if (count > 0) holds.set(k, count); else { holds.delete(k); kick(500); } };
    }
    // ---- publication (explicit only) --------------------------------------------
    // `sent` is set once this call hands a request to the network (unconfirmed()).
    // `contested`: an unanswered earlier request of this device shares this request's publication
    // revision, so the server applies at most one of the two. When the earlier one arrives first
    // this explicit choice ends in conflict; it is then sent once more as an update of that copy
    // (the same public address), so the last reviewed choice is what stays public.
    async function finishPublication(c, state, { preservePendingOnConflict = false, sent = null, contested = null, again = false } = {}) {
      let result;
      const pending = state.publishPending;
      const copies = pending.copies?.length ? { copies: pending.copies } : {};
      // Route is part of the durable request, never inferred again from a later
      // local/remote document. Old pending operations retain their RPC receipt.
      const format = Object.hasOwn(pending, 'documentFormat') ? { documentFormat: pending.documentFormat } : {};
      const mine = latest => latest?.publishPending?.operationId === pending.operationId;
      if (sent) sent.value = true;
      try { result = await remote.publish(state.remoteId, pending.expectedRevision, pending.operationId, { ...pending.selection, ...copies, ...format, expectedPublicRevision: pending.expectedPublicRevision }); guard(c); }
      catch (error) {
        if (error.code === 'blog_conflict' && !preservePendingOnConflict) {
          const row = await remote.read(state.remoteId); guard(c);
          const moved = !!row?.publication?.active && row.revision === pending.expectedRevision && publicRevision(row.publication) === (pending.expectedPublicRevision || 0) + 1;
          let facts = null;
          try { if (row?.publication?.active) facts = await publicFacts(c, row.publication); } catch (failure) { if (explain(failure)?.code === 'request_cancelled') throw failure; }
          const own = !!contested && moved && sameRequest(facts ?? null, contested);
          if (own && !again) {
            const next = { ...pending, operationId: makeId(), expectedPublicRevision: publicRevision(row.publication) }; delete next.contested;
            const renewed = await patch(c, latest => mine(latest) ? { publication: row.publication, publishPending: next, publishChecked: null } : null);
            if (renewed?.publishPending?.operationId === next.operationId) return finishPublication(c, renewed, { sent, again: true });
          }
          await patch(c, latest => ({ publication: row?.publication || null, ...(mine(latest) ? { publishPending: null } : {}) }));
          // What is public now, so the screen can say it instead of guessing the cause.
          throw Object.assign(error, { ownRequest: own, publicCopy: row?.publication?.active ? { photos: facts ? facts.photos.length : null } : null });
        }
        throw error;
      }
      const latest = await remote.read(state.remoteId); guard(c);
      const publication = latest?.publication || { token: result.token, blogToken: result.blogToken, revision: result.revision, active: true };
      // The name and intro this request set for the whole public list, kept with the post on this
      // device (publicProfile reads it back while nothing is public and the server shows none).
      const publishedAuthor = { name: pending.selection.author.name, intro: pending.selection.author.intro, at: new Date(now()).toISOString() };
      await patch(c, stored => ({ publication, publishedAuthor, publicationDoubt: null, publicationLog: null, ...(mine(stored) ? { publishPending: null } : {}) }));
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
    // A connection failure while publishing or withdrawing: say what is known instead of the
    // document-save message. `sent`: this call handed its request to the network, so its result
    // is unknown ("unconfirmed"). Otherwise nothing was sent by this call ("unsent"); an earlier
    // request that is still unanswered is then named separately ("unsent_prior").
    async function unconfirmed(ws, id, error, kind, sent) {
      const failure = explain(error);
      // What a conflict found on the server stays with the error across normalization.
      if (failure && error && Object.hasOwn(error, 'publicCopy')) Object.assign(failure, { ownRequest: error.ownRequest === true, publicCopy: error.publicCopy });
      if (failure?.code !== 'network_error') return failure;
      if (sent.value) return publicationFault(kind + '_unconfirmed');
      let prior = false;
      try { prior = publicationStatus(await storage.readBlogSyncState(ws, id), now()) === 'unknown'; } catch (_) { /* Unknown: treated as none. */ }
      return publicationFault(kind + (prior ? '_unsent_prior' : '_unsent'));
    }
    async function publish(ws, id, options = {}) {
      const sent = { value: false };
      try { return await postLock(ws, id, () => publishNow(ws, id, options, sent)); }
      catch (error) { throw await unconfirmed(ws, id, error, 'publish', sent); }
    }
    async function publishNow(ws, id, options, sent) {
      const choices = structuredClone(options), c = context(ws, id); await verified(c);
      const initial = await readPost(c);
      if (initial.revision !== choices.expectedLocalRevision) throw fault('local_changed');
      if (initial.status !== 'saved') throw fault('invalid_request');
      let before = await readState(c);
      const selection = { photoIds: choices.photoIds || [], author: choices.author || { name: '', intro: '' } };
      const needsCopies = selection.photoIds.length > 0;
      // A request recorded before public copies existed would publish an
      // original; it is replaced by a new request with copies.
      const usable = pending => !!pending && (!needsCopies || !!pending.copies);
      const legacyMarkdown = pending => initial.format === 'life-post-md-v1' && !!pending && !Object.hasOwn(pending, 'documentFormat');
      // Even a pre-copy Markdown request must replay its original RPC first:
      // a completed receipt or an uncertain ACK cannot be replaced by Edge.
      // The same choice as the unacknowledged request replays that request (its receipt answers
      // when the server already applied it).
      if ((usable(before?.publishPending) || legacyMarkdown(before?.publishPending)) &&
          before.publishPending.localRevision === initial.revision && canonical(before.publishPending.selection) === canonical(selection)) {
        return serial(ws, id, async () => {
          let state = await readState(c); const latest = await readPost(c);
          if (latest.revision !== initial.revision || canonical(state?.publishPending) !== canonical(before.publishPending)) throw fault('local_changed');
          try { return await finishPublication(c, state, { preservePendingOnConflict: legacyMarkdown(state.publishPending), sent }); }
          catch (error) {
            // Only BlogRemote's exact legacy RPC rejection proves that receipt
            // replay found no completed operation and the transaction rolled back.
            // Inspect this one-call proof before further error normalization.
            if (!legacyMarkdown(state.publishPending) || error.code !== 'blog_publication_unavailable' || error.publicationRolledBack !== true) throw error;
            const fresh = await readPost(c);
            if (fresh.revision !== initial.revision || fresh.format !== 'life-post-md-v1') throw fault('local_changed');
            const pending = state.publishPending;
            if (pending.selection.photoIds.some(id => !Array.isArray(pending.copies) || !pending.copies.some(copy => copy.id === id))) throw fault('blog_public_copies_required');
            // Preserve the reviewed operation, both CAS values, author, photo
            // order and immutable copies; only the durable transport is repaired.
            state = await writeState(c, state, { publishPending: { ...pending, documentFormat: 'life-post-md-v1' } },
              { expectedLocalRevision: initial.revision, isCurrent: () => current(c) });
            return finishPublication(c, state, { sent });
          }
        });
      }
      // A different choice (other photos or name, or a newer saved revision) than the
      // unanswered request, a withdrawal without a known result, or a guarded request
      // (2026-11-11): the exact server head settles them first. An applied request becomes the
      // recorded publication, which the reviewed revision below is then compared with. One the
      // server could end for certain is gone. One that can still arrive (`contested`) shares the
      // publication revision of the new request, so the server applies at most one of the two;
      // finishPublication handles the case that the old one wins.
      let contested = null;
      if (unsettled(before)) {
        const settled = await serial(ws, id, () => settleLocked(c, { replace: true })); before = settled.state; contested = settled.replaced;
        // Ending the old request moved the publication revision without changing what is public
        // (nothing was, nothing is): the preview reviewed against the earlier revision still holds.
        if (settled.moved && choices.expectedPublicRevision === settled.moved.from) choices.expectedPublicRevision = settled.moved.to;
      }
      if (choices.expectedRemoteRevision !== undefined && choices.expectedRemoteRevision !== (before?.remoteRevision || 0) || choices.expectedPublicRevision !== undefined && choices.expectedPublicRevision !== (before?.publication?.revision || 0)) throw fault('local_changed');
      const copies = await publicCopies(c, initial, selection.photoIds, choices.copies);
      await blog.publicSnapshot(initial, { ...selection, copies: copies.map(copyMeta) }); guard(c);
      const stored = await push(ws, id, { verify: false }); guard(c); if (stored.status !== 'synced') throw fault('blog_conflict');
      return serial(ws, id, async () => {
        let state = await readState(c); const latest = await readPost(c);
        if (latest.revision !== choices.expectedLocalRevision || state.localRevision !== latest.revision || state.pending) throw fault('local_changed');
        // Another tab may have recorded a legacy request while copies were
        // prepared. Its receipt must be replayed on the next explicit retry.
        if (legacyMarkdown(state.publishPending)) throw fault('local_changed');
        // Compare the reviewed preview with the current server publication
        // before any publication request (another device may have published).
        if (!state.publishPending) {
          const head = await remote.read(state.remoteId); guard(c);
          if (!head || head.revision !== state.remoteRevision) throw fault('local_changed');
          if (canonical(head.publication ?? null) !== canonical(state.publication ?? null)) state = await writeState(c, state, { publication: head.publication ?? null });
        }
        if (choices.expectedPublicRevision !== undefined && choices.expectedPublicRevision !== (state.publication?.revision || 0)) throw fault('local_changed');
        if (usable(state.publishPending) && canonical(state.publishPending.selection) !== canonical(selection)) throw fault('operation_mismatch');
        // The earlier request can only contest a request for the same post and publication revision.
        if (contested && (contested.expectedRevision !== state.remoteRevision || contested.expectedPublicRevision !== (state.publication?.revision || 0))) contested = null;
        if (!usable(state.publishPending)) {
          for (const copy of copies) { await remote.uploadPublicCopy(state.remoteId, copyMeta(copy), copy.blob); guard(c); }
          state = await writeState(c, state, { publishPending: { operationId: makeId(), expectedRevision: state.remoteRevision, expectedPublicRevision: state.publication?.revision || 0, localRevision: latest.revision, selection,
            ...(latest.format === 'life-post-md-v1' ? { documentFormat: latest.format } : {}),
            ...(copies.length ? { copies: copies.map(copyMeta) } : {}), ...(contested ? { contested: true } : {}) } });
        }
        return finishPublication(c, state, { sent, contested });
      });
    }
    async function unpublish(ws, id, options = {}) {
      const sent = { value: false };
      try { return await postLock(ws, id, () => unpublishNow(ws, id, options, sent)); }
      catch (error) { throw await unconfirmed(ws, id, error, 'unpublish', sent); }
    }
    async function unpublishNow(ws, id, options, sent) {
      const expected = options.expectedPublicRevision;
      return serial(ws, id, async () => {
        const c = context(ws, id); await verified(c);
        // The server head says what there is to withdraw (2026-11-11): this device may not know a
        // publication made by its own unanswered request or by another device. An earlier
        // withdrawal without a known result is finished here. A publish request without a known
        // result must not publish after this withdrawal: settleLocked ends it where the server
        // can (moving the publication revision); what is still able to arrive is withdrawn below
        // together with the public copy, or guarded when there is nothing on the server to move.
        const settled = await settleLocked(c, { replace: true, sent }); let state = settled.state;
        if (!state?.publication?.active) {
          if (settled.replaced && state) {
            // No publication row exists, so no request can end the unanswered one. The withdrawal
            // is kept as a guard: if that request arrives, its copy is withdrawn (settleLocked).
            await patch(c, { publishRevoked: { ...settled.replaced, at: new Date(now()).toISOString() }, publicationLog: null });
            return { status: 'not_published', revision: 0, guarded: true };
          }
          return { status: state?.publication ? 'unpublished' : 'not_published', revision: publicRevision(state?.publication) };
        }
        if (expected !== undefined && state.publication.revision !== expected) throw fault('local_changed');
        const pending = { operationId: makeId(), expectedRevision: state.publication.revision };
        state = await writeState(c, state, { unpublishPending: pending });
        const mine = latest => latest?.unpublishPending?.operationId === pending.operationId;
        let result;
        sent.value = true;
        try { result = await remote.unpublish(state.remoteId, pending.expectedRevision, pending.operationId); guard(c); }
        catch (error) {
          if (error.code === 'blog_conflict') { const row = await remote.read(state.remoteId); guard(c); await patch(c, latest => ({ publication: row?.publication || null, ...(mine(latest) ? { unpublishPending: null } : {}) })); }
          throw error;
        }
        const latest = await remote.read(state.remoteId); guard(c);
        await patch(c, stored => ({ publication: latest?.publication || { ...state.publication, active: false, revision: result.revision }, publicationDoubt: null, publicationLog: null, ...(mine(stored) ? { unpublishPending: null } : {}) }));
        if (latest?.publication?.active || latest?.publication?.revision !== result.revision) throw fault('blog_conflict');
        return result;
      });
    }
    // Server heads joined with this device's posts, for the account overview.
    async function catalog(ws) {
      const c = context(ws, 'catalog'); await verified(c);
      const rows = await remote.syncList(); guard(c);
      let local = await snapshot(c);
      // The overview shows the server's publication; this device's own record follows it, so the
      // post's own screen does not contradict the overview.
      const tasks = [];
      for (const row of rows) {
        const entry = local.byRemote.get(row.id);
        if (!entry || entry.state.remoteRevision !== row.revision) continue;
        const moved = canonical(entry.state.publication ?? null) !== canonical(row.publication ?? null);
        if (unsettled(entry.state)) { if (moved || publicationStatus(entry.state, now()) === 'unknown') tasks.push(() => settleQuiet(entry.ws, entry.localPostId)); }
        else if (moved) tasks.push(() => refreshPublication(entry.ws, entry.localPostId, row));
      }
      if (tasks.length) { await pool(tasks, receiveConcurrency); guard(c); local = await snapshot(c); }
      return rows.map(row => {
        const entry = local.byRemote.get(row.id);
        const status = !entry ? retries.get(key(ws, row.id))?.error ? 'error' : 'pending' : statusOf(entry.ws, entry.post, entry.state) === 'error' ? 'error' :
          entry.state.remoteRevision !== row.revision || dirty(entry.state, entry.post) ? 'pending' : 'synced';
        return { id: row.id, title: row.title, revision: row.revision, status, draft: row.status === 'draft', archived: row.archived,
          updated_at: row.updated_at, publication: structuredClone(row.publication ?? null),
          localPostId: entry?.localPostId || null, localWorkspaceId: entry?.ws || null, localRevision: entry?.post.revision || null };
      });
    }
    // The public name and intro above the account's public post list. The server keeps one
    // profile per account and every publish request replaces it, so a review must start from
    // the current values (2026-11-11). They are readable only through the public list of a
    // blog token, and only while a post is public. `visible: false`: nothing is public, so no
    // visitor sees a name or intro and there is nothing to keep.
    async function publicProfile(ws) {
      const c = context(ws, 'profile'); await verified(c);
      const rows = await remote.syncList(); guard(c);
      const shown = rows.filter(row => row.publication?.active);
      if (!shown.length) {
        // Nothing is public, so the server returns no name or intro. The last values this device
        // published (account-scoped local bindings, never another account's) are offered instead
        // and marked as such; without them the review starts blank as before.
        let last = null;
        for (const entry of (await snapshot(c)).byRemote.values()) {
          const value = entry.state.publishedAuthor;
          if (value && typeof value.name === 'string' && typeof value.intro === 'string' && (!last || String(value.at) > String(last.at))) last = value;
        }
        guard(c);
        return { visible: false, author: { name: last?.name || '', intro: last?.intro || '' }, posts: 0, ...(last && (last.name || last.intro) ? { remembered: true } : {}) };
      }
      // The same anonymous reading a visitor uses: the private session is never attached to it.
      const reader = publicReader || root.HaedoLife?.BlogPublic?.createReader?.({ config: auth.config });
      if (typeof reader?.list !== 'function') throw fault('schema_missing');
      try {
        const listed = await reader.list(shown[0].publication.blogToken, { limit: 1 }); guard(c);
        return { visible: true, author: { name: listed.author.name, intro: listed.author.intro }, posts: shown.length };
      } catch (error) { guard(c); throw fault(['schema_missing', 'invalid_remote_data', 'request_cancelled'].includes(error?.code) ? error.code : 'network_error'); }
      finally { if (!publicReader) reader.dispose?.(); }
    }
    const api = Object.freeze({ getState, statuses, publicationStatuses, publicationNotices, settlePublication, publicProfile, getStatus, saveDefault, save, connect: save, sync: save, publish, unpublish, deletePost, catalog,
      syncNow, start, stop, noteLocalDraftSaved, holdPost,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      dispose() { if (disposed) return; stop(); disposed = true; live.delete(api); listeners.clear(); remote.dispose?.(); } });
    if (autoSync) { live.add(api); liveStorage.set(api, storage); start(); }
    return api;
  }
  return Object.freeze({ create, noteLocalDraftSaved, forStorage, publicationStatus, publicationNotice, LATE_WINDOW, CONFLICT_PREFIX });
});

/* Explicit per-post transfer. Original local documents and remote conflicts remain intact. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).BlogSync = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  function create({ storage, auth = root.HaedoAuth, blog = root.HaedoLife?.Blog,
    photoPost = root.HaedoLife?.PhotoPost, remote = root.HaedoLife?.BlogRemote?.create({ auth, blog }),
    makeId = () => root.crypto.randomUUID() } = {}) {
    const cleaner = root.HaedoLife?.BlogRemote?.clean || (error => error);
    const fault = code => cleaner({ code });
    if (!storage?.account || !storage.readBlogSyncState || !storage.writeBlogSyncState || !auth || !remote || !blog?.pack || !photoPost?.validate) throw fault('auth_required');
    const owner = storage.account, queues = new Map(), listeners = new Set(), generations = new Map(); let disposed = false;
    const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(name => JSON.stringify(name) + ':' + canonical(value[name])).join(',') + '}' : JSON.stringify(value);
    const key = (ws, id) => ws + '/' + id;
    const same = value => value?.userId === owner.userId && value?.projectUrl === owner.projectUrl;
    const context = (ws, id) => ({ ws, id, epoch: auth.epoch, generation: generations.get(key(ws, id)) || 0 });
    function guard(c) { if (disposed || !same(auth.getAccount()) || c.epoch !== auth.epoch || c.generation !== (generations.get(key(c.ws, c.id)) || 0)) throw fault('request_cancelled'); }
    async function verified(c) { guard(c); const user = await auth.verify(); guard(c); if (user?.id !== owner.userId) throw fault('auth_required'); }
    const emit = (ws, id) => { if (!disposed) for (const listener of listeners) { try { listener({ workspaceId: ws, localPostId: id }); } catch (_) {} } };
    function serial(ws, id, action) {
      const k = key(ws, id), previous = queues.get(k) || Promise.resolve();
      const next = previous.catch(() => {}).then(action); queues.set(k, next);
      next.finally(() => { if (queues.get(k) === next) queues.delete(k); }).catch(() => {}); return next;
    }
    async function readState(c) { const state = await storage.readBlogSyncState(c.ws, c.id); guard(c); return state; }
    async function writeState(c, state, changes) {
      guard(c); const result = await storage.writeBlogSyncState(c.ws, c.id, { ...state, ...changes }, state?.revision || 0); guard(c); emit(c.ws, c.id); return result;
    }
    async function readPost(c) { const post = await storage.readPhotoPost(c.ws, c.id); guard(c); photoPost.validate(post); return post; }
    async function getState(ws, id) {
      const c = context(ws, id); guard(c); const state = await readState(c), post = await readPost(c);
      return { ...(state || {}), workspaceId: ws, localPostId: id, enabled: !!state?.enabled,
        status: !state ? 'not_enabled' : !state.enabled ? state.enableOnSave === true ? 'pending' : 'paused' : state.conflict ? 'conflict' : state.error ? 'error' : state.pending || state.localRevision !== post.revision ? 'pending' : 'synced' };
    }
    async function rememberError(c, error) {
      try { guard(c); const current = await readState(c); if (current?.enabled) await writeState(c, current, { status: 'error', error: cleaner(error).code || 'network_error' }); } catch (_) { /* Keep durable pending state if metadata cannot be updated. */ }
    }
    async function transfer(ws, id, enable, options = {}, defaultSave = false, acceptedContext = null) {
      const expectedManifest = options.expectedManifest ? structuredClone(options.expectedManifest) : null;
      const expectedLocalRevision = options.expectedLocalRevision;
      return serial(ws, id, async () => {
        const c = acceptedContext || context(ws, id);
        let defaultIntent = false;
        try {
          if (defaultSave) {
            // Record the explicit saved-post intent locally even when remote
            // account verification is offline. No original leaves this scope
            // until the existing verified transfer below succeeds.
            guard(c);
            const local = await readPost(c), previous = await readState(c);
            if (local.status !== 'saved') throw fault('invalid_request');
            if (previous && (!previous.enabled && previous.enableOnSave !== true || previous.conflict)) return getState(ws, id);
            if (expectedLocalRevision !== undefined && local.revision !== expectedLocalRevision) throw fault('local_changed');
            if (expectedManifest && canonical(blog.pack(photoPost.compact(local))) !== canonical(expectedManifest)) throw fault('local_changed');
            if (!previous || previous.enableOnSave === true) await writeState(c, previous, { enabled: true, enableOnSave: false, remoteId: previous?.remoteId || local.id,
              remoteWorkspaceId: previous?.remoteWorkspaceId || ws, remoteRevision: previous?.remoteRevision || 0, localRevision: previous?.localRevision || 0,
              publication: previous?.publication || null, pending: previous?.pending || null, status: 'pending', error: null });
            defaultIntent = true;
          }
          await verified(c); let post = await readPost(c), state = await readState(c);
          if (post.status !== 'saved') throw fault('invalid_request');
          // Explicit local saves may start private storage, but cannot undo a
          // user's pause or resolve a conflict on their behalf.
          if (defaultSave && state && (!state.enabled || state.conflict)) return getState(ws, id);
          if (defaultSave && expectedLocalRevision !== undefined && post.revision !== expectedLocalRevision) throw fault('local_changed');
          // An explicit preparation review authorizes this frozen manifest and
          // its original blobs, even if another tab edits the document later.
          if (expectedManifest && canonical(blog.pack(photoPost.compact(post))) !== canonical(expectedManifest)) throw fault('local_changed');
          if (enable && !state?.enabled) state = await writeState(c, state, { enabled: true, remoteId: state?.remoteId || post.id,
            remoteWorkspaceId: state?.remoteWorkspaceId || ws, remoteRevision: state?.remoteRevision || 0, localRevision: state?.localRevision || 0,
            publication: state?.publication || null, pending: state?.pending || null, status: 'pending', error: null });
          if (!state) throw fault('not_enabled'); if (!state.enabled) throw fault('sync_paused');
          if (state.conflict) {
            const row = await remote.read(state.remoteId); guard(c); if (!row) throw fault('remote_missing');
            await writeState(c, state, { publication: row.publication, status: 'conflict', error: null, conflict: {
              remoteRevision: row.revision, localRevision: post.revision, remoteTitle: row.data.title, updatedAt: row.updated_at } });
            return getState(ws, id);
          }
          if (!state.pending && state.localRevision === post.revision && state.remoteRevision > 0) {
            const row = await remote.read(state.remoteId); guard(c); if (!row) throw fault('remote_missing');
            if (row.revision !== state.remoteRevision) {
              await writeState(c, state, { status: 'conflict', error: null, conflict: { remoteRevision: row.revision, localRevision: post.revision, remoteTitle: row.data.title, updatedAt: row.updated_at } });
              return getState(ws, id);
            } else {
              if (!state.remoteManifest || canonical(row.data) !== canonical(state.remoteManifest)) throw fault('invalid_remote_data');
              state = await writeState(c, state, { publication: row.publication, error: null });
              const manifest = blog.pack(photoPost.compact(post)); manifest.id = state.remoteId; manifest.replaces = null;
              // Received copies have new photo/ops IDs even at the same local
              // revision. Align those IDs through the existing verified CAS path
              // before a publication can select them on the server.
              if (canonical(manifest) === canonical(row.data)) return getState(ws, id);
            }
          }
          if (!state.pending) {
            const manifest = blog.pack(photoPost.compact(post)); manifest.id = state.remoteId; manifest.replaces = null;
            // Verify every original before preparing any remote asset or document write.
            await blog.hydrate(manifest, new Map(manifest.photos.map(photo => [photo.id, post.photos.find(item => item.id === photo.id).blob]))); guard(c);
            state = await writeState(c, state, { status: 'pending', error: null, pending: {
              operationId: makeId(), manifest, expectedRevision: state.remoteRevision, localRevision: post.revision
            } });
          }
          const pending = structuredClone(state.pending);
          if (expectedManifest) {
            const expected = structuredClone(expectedManifest); expected.id = state.remoteId; expected.replaces = null;
            if (canonical(pending.manifest) !== canonical(expected)) throw fault('local_changed');
          }
          for (const photo of pending.manifest.photos) {
            const local = post.photos.find(item => item.id === photo.id && item.digest === photo.digest);
            if (!local) {
              const asset = await remote.prepareAsset(state.remoteId, photo); guard(c);
              if (!asset.exists) { state = await writeState(c, state, { pending: null, error: 'local_changed' }); throw fault('local_changed'); }
            } else { await remote.uploadAsset(state.remoteId, photo, local.blob); guard(c); }
          }
          // Pause/account changes during a photo upload cannot commit the document.
          const current = await readState(c); if (!current?.enabled || current.pending?.operationId !== pending.operationId) throw fault('request_cancelled');
          const result = await remote.save({ workspaceId: state.remoteWorkspaceId, postId: state.remoteId,
            expectedRevision: pending.expectedRevision, operationId: pending.operationId, data: pending.manifest }); guard(c);
          if (result.status === 'stored') {
            state = await writeState(c, current, { remoteRevision: result.revision, remoteManifest: pending.manifest, localRevision: pending.localRevision, pending: null, conflict: null, error: null, status: 'synced' });
          } else if (result.status === 'conflict') {
            const other = await remote.read(state.remoteId); guard(c);
            state = await writeState(c, current, { status: 'conflict', error: null, conflict: { remoteRevision: other?.revision || result.revision,
              localRevision: post.revision, remoteTitle: other?.data?.title || '', updatedAt: other?.updated_at || null } });
          } else throw fault('remote_missing');
          return getState(ws, id);
        } catch (error) { if (!defaultSave || defaultIntent) await rememberError(c, error); throw cleaner(error); }
      });
    }
    async function saveDefault(ws, id, options = {}) {
      const choices = structuredClone(options), c = context(ws, id);
      const result = await transfer(ws, id, true, choices, true, c); guard(c);
      // A retained request belongs to an earlier explicit save. Acknowledge it
      // unchanged, then allow one further transfer of this accepted revision.
      // Keep the second call outside serial(): awaiting the same queue inside
      // itself would deadlock. A pause between steps must never be re-enabled.
      if (result.status !== 'pending' || result.pending || choices.expectedLocalRevision === undefined || result.localRevision === choices.expectedLocalRevision) return result;
      const post = await readPost(c);
      if (post.status !== 'saved' || post.revision !== choices.expectedLocalRevision) throw fault('local_changed');
      return transfer(ws, id, false, choices, true, c);
    }
    async function list(ws) {
      const c = context(ws, '*'); await verified(c); await storage.read(ws); guard(c);
      const rows = await remote.list(null); guard(c); return rows;
    }
    const catalogPriority = ['conflict', 'error', 'paused', 'local_pending', 'remote_updated', 'received'];
    async function catalog(ws) {
      const c = context(ws, 'catalog'); await verified(c); await storage.read(ws); guard(c);
      const rows = await remote.list(null); guard(c);
      const links = await storage.listBlogCopies(ws); guard(c);
      return rows.map(row => {
        const copies = links.filter(copy => copy.remoteId === row.id).map(copy => {
          let status = copy.status;
          if (status === 'received' && copy.remoteRevision !== row.revision) status = 'remote_updated';
          else if (status === 'local_pending' && copy.remoteRevision > 0 && copy.remoteRevision !== row.revision) status = 'conflict';
          return { localPostId: copy.localPostId, revision: copy.revision, remoteRevision: copy.remoteRevision, status, archived: copy.archived };
        });
        return { id: row.id, title: row.title, revision: row.revision, updated_at: row.updated_at,
          publication: structuredClone(row.publication ?? null), copies,
          status: copies.length ? catalogPriority.find(status => copies.some(copy => copy.status === status)) : 'server_only' };
      });
    }
    function chooseCopy(copies, localPostId) {
      if (localPostId !== undefined) {
        const chosen = copies.find(copy => copy.localPostId === localPostId);
        if (!chosen) throw fault('local_changed');
        return chosen;
      }
      if (copies.length > 1) throw Object.assign(new Error('이 기기에 받은 글이 여러 개입니다. 열 글을 선택해 주세요.'), {
        code: 'blog_copy_selection_required', choices: structuredClone(copies)
      });
      return copies[0] || null;
    }
    async function openRemote(ws, remoteId, options = {}) {
      const { isCurrent, ...input } = options, choices = structuredClone(input), c = context(ws, 'open:' + remoteId);
      const guardOpen = () => { guard(c); if (isCurrent && !isCurrent()) throw fault('request_cancelled'); };
      if (isCurrent !== undefined && typeof isCurrent !== 'function') throw fault('invalid_request');
      return serial(ws, 'open:' + remoteId, async () => {
        guardOpen(); await verified(c); guardOpen(); await storage.read(ws); guardOpen();
        const links = await storage.listBlogCopies(ws); guardOpen();
        const selected = chooseCopy(links.filter(copy => copy.remoteId === remoteId), choices.localPostId);
        if (selected) {
          const post = await storage.readPhotoPost(ws, selected.localPostId); guardOpen(); photoPost.validate(post);
          if (post.status !== 'saved') throw fault('local_changed');
          return { post, localPostId: post.id, remoteId, revision: selected.remoteRevision, received: false, workspaceId: ws };
        }
        if (!Number.isSafeInteger(choices.expectedRemoteRevision) || choices.expectedRemoteRevision < 1) throw fault('invalid_request');
        const row = await remote.read(remoteId); guardOpen(); if (!row) throw fault('remote_missing');
        if (row.revision !== choices.expectedRemoteRevision) throw fault('local_changed');
        const blobs = new Map();
        for (const photo of row.data.photos) { blobs.set(photo.id, await remote.downloadAsset(row.assets[photo.id])); guardOpen(); }
        const original = await blog.hydrate(row.data, blobs); guardOpen();
        const head = await remote.read(remoteId); guardOpen();
        if (!head || head.revision !== row.revision) throw fault('local_changed');
        if (head.workspace_id !== row.workspace_id || canonical(head.data) !== canonical(row.data)) throw fault('invalid_remote_data');
        let installed;
        try {
          installed = await storage.installReceivedBlogPost(ws, freshCopy(original), { enabled: true, remoteId,
            remoteWorkspaceId: row.workspace_id, remoteRevision: row.revision, localRevision: 0,
            remoteManifest: row.data, publication: head.publication, pending: null, conflict: null, status: 'synced', error: null }, { isCurrent: guardOpen });
        } catch (error) {
          guardOpen();
          if (error.code === 'blog_copy_selection_required') {
            const current = await storage.listBlogCopies(ws); guardOpen();
            chooseCopy(current.filter(copy => copy.remoteId === remoteId));
          }
          throw error;
        }
        guardOpen(); emit(ws, installed.post.id);
        const state = await storage.readBlogSyncState(ws, installed.post.id); guardOpen();
        return { post: installed.post, localPostId: installed.post.id, remoteId, revision: state.remoteRevision,
          received: installed.received, workspaceId: ws };
      });
    }
    function freshCopy(input) {
      const post = structuredClone(input), ids = new Map(); post.id = makeId(); post.revision = 0; post.replaces = null; post.status = 'saved';
      for (const photo of post.photos) { const next = makeId(); ids.set(photo.id, next); photo.id = next; }
      post.ops = post.ops.map(op => typeof op.insert === 'string' ? op : { ...op, insert: { photo: { ...op.insert.photo, id: ids.get(op.insert.photo.id) } } });
      photoPost.validate(post); return post;
    }
    async function receive(ws, remoteId) {
      return receiveCopy(ws, remoteId, true);
    }
    async function receiveCopy(ws, remoteId, enabled, options = {}) {
      return serial(ws, 'receive:' + remoteId, async () => {
        const c = context(ws, 'receive:' + remoteId);
        const check = () => { guard(c); options.guardSource?.(); };
        check(); await verified(c); check(); await storage.read(ws); check();
        const row = options.row || await remote.read(remoteId); check(); if (!row) throw fault('remote_missing');
        if (options.expectedRemoteRevision !== undefined && row.revision !== options.expectedRemoteRevision) throw fault('local_changed');
        const blobs = new Map();
        for (const photo of row.data.photos) { const blob = await remote.downloadAsset(row.assets[photo.id]); check(); blobs.set(photo.id, blob); }
        const original = await blog.hydrate(row.data, blobs); check();
        await options.checkSource?.(); check();
        const post = await storage.savePhotoPost(ws, freshCopy(original), 0); check();
        const installed = context(ws, post.id); let syncError = null;
        try { await writeState(installed, null, { enabled, remoteId, remoteWorkspaceId: row.workspace_id, remoteRevision: row.revision,
          localRevision: post.revision, remoteManifest: row.data, publication: row.publication, pending: null, conflict: null, status: enabled ? 'synced' : 'paused', error: null }); }
        catch (error) { guard(c); syncError = cleaner(error).code || 'network_error'; }
        emit(ws, post.id); return { post, localPostId: post.id, newLocalPostId: post.id, remoteId, revision: row.revision, syncError };
      });
    }
    async function pause(ws, id) {
      const k = key(ws, id); generations.set(k, (generations.get(k) || 0) + 1);
      const c = context(ws, id); await verified(c); const state = await readState(c);
      if (state) await writeState(c, state, { enabled: false, enableOnSave: false, status: 'paused', error: null }); return getState(ws, id);
    }
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
      const current = await remote.read(state.remoteId); guard(c);
      await writeState(c, state, { publication: current?.publication || { token: result.token, blogToken: result.blogToken, revision: result.revision, active: true }, publishPending: null });
      if (!current?.publication?.active || current.publication.revision !== result.revision) throw fault('blog_conflict');
      return { ...result, publicUrl: new URL('blog.html?post=' + result.token, root.location?.href || owner.projectUrl + '/').href, blogUrl: new URL('blog.html?blog=' + result.blogToken, root.location?.href || owner.projectUrl + '/').href };
    }
    async function publish(ws, id, options = {}) {
      const choices = structuredClone(options), c = context(ws, id); await verified(c);
      const initial = await readPost(c);
      if (initial.revision !== choices.expectedLocalRevision) throw fault('local_changed');
      const before = await readState(c);
      const selection = { photoIds: choices.photoIds || [], author: choices.author || { name: '', intro: '' } };
      if (before?.publishPending) {
        if (before.publishPending.localRevision !== initial.revision || canonical(before.publishPending.selection) !== canonical(selection)) throw fault('local_changed');
        return serial(ws, id, async () => {
          const state = await readState(c), current = await readPost(c);
          if (current.revision !== initial.revision || state?.publishPending?.operationId !== before.publishPending.operationId) throw fault('local_changed');
          return finishPublication(c, state);
        });
      }
      if (choices.expectedRemoteRevision !== undefined && choices.expectedRemoteRevision !== (before?.remoteRevision || 0) || choices.expectedPublicRevision !== undefined && choices.expectedPublicRevision !== (before?.publication?.revision || 0)) throw fault('local_changed');
      await blog.publicSnapshot(initial, { photoIds: choices.photoIds || [], author: choices.author || { name: '', intro: '' } }); guard(c);
      const synced = await transfer(ws, id, true); guard(c); if (synced.status !== 'synced') throw fault('blog_conflict');
      return serial(ws, id, async () => {
        let state = await readState(c); const latest = await readPost(c);
        if (latest.revision !== choices.expectedLocalRevision || state.localRevision !== latest.revision) throw fault('local_changed');
        if (choices.expectedPublicRevision !== undefined && choices.expectedPublicRevision !== (state.publication?.revision || 0)) throw fault('local_changed');
        if (state.publishPending && JSON.stringify(state.publishPending.selection) !== JSON.stringify(selection)) throw fault('operation_mismatch');
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
        const current = await remote.read(state.remoteId); guard(c);
        await writeState(c, state, { publication: current?.publication || { ...state.publication, active: false, revision: result.revision }, unpublishPending: null });
        if (current?.publication?.active || current?.publication?.revision !== result.revision) throw fault('blog_conflict');
        return result;
      });
    }
    async function resolve(ws, id, choice, expectedConflict) {
      const expected = expectedConflict && { remoteRevision: expectedConflict.remoteRevision, localRevision: expectedConflict.localRevision };
      const c = context(ws, id); await verified(c); const state = await readState(c);
      if (!state?.conflict) throw fault('blog_conflict');
      if (expected && (expected.remoteRevision !== state.conflict.remoteRevision || expected.localRevision !== state.conflict.localRevision)) throw fault('local_changed');
      if (choice !== 'local' && choice !== 'remote') throw fault('invalid_request');
      const before = await readPost(c), row = await remote.read(state.remoteId); guard(c);
      if (!row) throw fault('local_changed');
      if (row.revision !== state.conflict.remoteRevision || before.revision !== state.conflict.localRevision) {
        await writeState(c, state, { publication: row.publication, status: 'conflict', error: null, conflict: {
          remoteRevision: row.revision, localRevision: before.revision, remoteTitle: row.data.title, updatedAt: row.updated_at } });
        throw fault('local_changed');
      }
      const checkSource = async () => {
        const post = await readPost(c), current = await readState(c);
        if (post.revision !== before.revision || !current?.conflict ||
            current.conflict.localRevision !== state.conflict.localRevision || current.conflict.remoteRevision !== state.conflict.remoteRevision)
          throw fault('local_changed');
      };
      const receiveOptions = { row, expectedRemoteRevision: state.conflict.remoteRevision, guardSource: () => guard(c), checkSource };
      if (choice === 'remote') {
        // Until the original choice is still current, a received recovery is
        // paused and cannot become a competing uploader after cancellation.
        const result = await receiveCopy(ws, state.remoteId, false, receiveOptions); guard(c); await checkSource();
        await pause(ws, id);
        const completed = { ...c, generation: c.generation + 1 }; guard(completed);
        const post = await readPost(completed); if (post.revision !== before.revision) throw fault('local_changed');
        if (!result.syncError) {
          const installed = context(ws, result.localPostId), receivedState = await readState(installed); guard(completed);
          await writeState(installed, receivedState, { enabled: true, status: 'synced' }); guard(completed);
        }
        return result;
      }
      // A recovery must start paused: cancellation of the original while its
      // photos download must never leave a newly enabled competing copy.
      const recovery = await receiveCopy(ws, state.remoteId, false, receiveOptions); guard(c); await checkSource();
      const latest = await readState(c); await writeState(c, latest, { remoteRevision: row.revision, publication: row.publication, localRevision: 0, pending: null, conflict: null, error: null });
      const result = await transfer(ws, id, true); return { ...result, recoveryLocalPostId: recovery.localPostId };
    }
    return Object.freeze({ list, catalog, openRemote, connect: (ws, id, options) => transfer(ws, id, true, options), save: (ws, id, options) => transfer(ws, id, true, options),
      saveDefault,
      sync: (ws, id) => transfer(ws, id, false), receive, pause, publish, unpublish, resolve, getState,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      dispose() { if (disposed) return; disposed = true; listeners.clear(); remote.dispose?.(); } });
  }
  return Object.freeze({ create });
});

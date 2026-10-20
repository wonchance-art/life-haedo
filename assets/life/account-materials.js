/* Exact account-owned source graph registration. No publication or remote writes. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  (root.HaedoLife ||= {}).AccountMaterials = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  const HASH = /^[a-f\d]{64}$/;
  const MAX_BYTES = 16 * 1024 * 1024;
  const clone = value => structuredClone(value);
  const canonical = value => JSON.stringify(sorted(value));
  function sorted(value) {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
    return value;
  }
  function fault(code) {
    return Object.assign(new Error('계정 자료를 등록하지 못했습니다. 기존 자료는 유지됩니다. 다시 확인해 주세요.'), { code });
  }
  const check = (value, code = 'invalid_account_material') => { if (!value) throw fault(code); };
  const revision = value => Number.isSafeInteger(value) && value >= 1;
  function graph(bundle) {
    return { sources: bundle.sources, sourceVersions: bundle.sourceVersions, links: bundle.links };
  }
  function pgBound(value) {
    let margin = 0;
    const visit = entry => {
      if (Array.isArray(entry)) { margin += entry.length; entry.forEach(visit); }
      else if (entry && typeof entry === 'object') { margin += Object.keys(entry).length * 2; Object.values(entry).forEach(visit); }
    };
    visit(value);
    return new TextEncoder().encode(JSON.stringify(value)).length + margin;
  }
  async function prepare(target, snapshot) {
    const core = root.HaedoLife?.Core || (typeof require === 'function' && require('./core.js'));
    const owned = clone(snapshot), before = clone(target);
    core.validateWorkspace(before); core.validateWorkspace(owned);
    const changes = { put: { sources: [], sourceVersions: [], links: [] } };
    for (const link of owned.links) for (const ref of link.entityRefs || [])
      check(['source', 'sourceVersion', 'link'].includes(ref.entityType), 'account_material_private_reference');
    for (const kind of ['sources', 'sourceVersions', 'links']) {
      const existing = new Map(before[kind].map(item => [item.id, item]));
      for (const item of owned[kind]) {
        if (existing.has(item.id)) check(canonical(existing.get(item.id)) === canonical(item), 'account_material_identity_conflict');
        else changes.put[kind].push(clone(item));
      }
    }
    // Core checks global ID uniqueness and that all copied references still resolve
    // without bringing private excerpts or resume hints into the destination.
    const prospective = core.applyChanges(before, changes);
    check(pgBound(prospective) <= MAX_BYTES, 'account_material_too_large');
    const crypto = root.crypto || (typeof require === 'function' && require('node:crypto').webcrypto);
    const bytes = new TextEncoder().encode(canonical(graph(owned)));
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
    return { changes, fingerprint, addedSources: changes.put.sources.length };
  }
  function create({ storage, auth, core = root.HaedoLife?.Core, remoteFactory } = {}) {
    check(storage?.isAccountScoped && storage.account && typeof auth?.verify === 'function' && core, 'auth_scope_required');
    const owner = clone({ projectUrl: storage.account.projectUrl, userId: storage.account.userId });
    check(typeof owner.projectUrl === 'string' && UUID.test(owner.userId), 'auth_scope_required');
    let disposed = false, running = false, generation = 0, activeRemote = null;
    const sameOwner = value => value?.projectUrl === owner.projectUrl && value?.userId === owner.userId;
    function guard(context) {
      check(!disposed && context.generation === generation && !context.signal?.aborted && auth.epoch === context.authEpoch, 'account_material_cancelled');
      check(sameOwner(storage.account) && sameOwner(auth.getAccount?.()) && auth.user?.id === owner.userId, 'account_material_cancelled');
    }
    async function step(context, action) { guard(context); const result = await action(); guard(context); return result; }
    async function verify(context) {
      const user = await step(context, () => auth.verify());
      check(user?.id === owner.userId, 'auth_scope_required');
    }
    const blockedSync = state => state?.enabled && (state.outbox || state.conflict);
    async function cleanSync(context, workspaceId) {
      const state = await step(context, () => storage.getSyncState(workspaceId));
      check(!blockedSync(state), 'account_material_sync_pending');
    }
    function pointer(row) {
      check(row && UUID.test(row.id) && UUID.test(row.workspace_id) && row.owner_id === owner.userId && row.enabled === true && revision(row.revision) && revision(row.workspace_revision));
      return { id: row.id, revision: row.revision, sourceWorkspaceId: row.workspace_id, sourceRevision: row.workspace_revision };
    }
    function marked(value, descriptor) {
      if (!value) return false;
      check(sameOwner(value.owner) && HASH.test(value.descriptor?.fingerprint || ''), 'account_material_registration_changed');
      check(Object.keys(descriptor).every(key => value.descriptor[key] === descriptor[key]), 'account_material_registration_changed');
      return true;
    }
    async function register(workspaceId, { signal } = {}) {
      check(UUID.test(workspaceId), 'invalid_workspace');
      check(!running, 'account_material_busy');
      const context = { generation, authEpoch: auth.epoch, signal }, registrations = [];
      let addedSources = 0;
      running = true;
      const abort = () => { activeRemote?.dispose(); };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        await verify(context);
        const client = auth.client || auth.getClient?.();
        check(typeof client?.from === 'function', 'auth_scope_required');
        const response = await step(context, () => {
          let query = client.from('life_account_materials').select('id,owner_id,workspace_id,workspace_revision,revision,enabled').eq('owner_id', owner.userId).eq('enabled', true).limit(21);
          if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal);
          return query;
        });
        if (response.error) {
          if (response.status === 404 || response.error.code === 'PGRST205') return { status: 'no_registry', addedSources: 0, registrations: [] };
          throw fault('account_material_unavailable');
        }
        check(Array.isArray(response.data) && response.data.length <= 20, 'account_material_catalog_limit');
        const descriptors = response.data.map(pointer);
        check(new Set(descriptors.map(item => item.id)).size === descriptors.length, 'invalid_account_material');
        for (const descriptor of descriptors) {
          const existing = await step(context, () => storage.readAccountMaterialRegistration(workspaceId, descriptor.id));
          if (marked(existing, descriptor)) {
            registrations.push({ id: descriptor.id, status: 'already_registered', addedSources: 0 });
            continue;
          }
          await cleanSync(context, workspaceId);
          if (!activeRemote) {
            const factory = remoteFactory || ((config, options) => root.HaedoLife.PlatformRemote.create(config, options));
            activeRemote = factory(auth.config, { platformAuth: auth, core });
          }
          const snapshot = await step(context, () => activeRemote.read(descriptor.sourceWorkspaceId));
          check(snapshot?.id === descriptor.sourceWorkspaceId && snapshot.revision === descriptor.sourceRevision && snapshot.data?.workspaceId === descriptor.sourceWorkspaceId, 'account_material_source_changed');
          // PlatformRemote.read already invokes Remote.verifyData for every body SHA.
          const target = await step(context, () => storage.read(workspaceId));
          check(target?.workspaceId === workspaceId, 'invalid_workspace');
          const prepared = await step(context, () => prepare(target, snapshot.data));
          await verify(context);
          await cleanSync(context, workspaceId);
          const request = { workspaceId, baseRevision: target.revision, operationId: core.id(), changes: prepared.changes,
            accountMaterialRegistration: { ...descriptor, fingerprint: prepared.fingerprint } };
          const result = await step(context, () => storage.commitLocal(request));
          if (!['stored', 'already_registered'].includes(result?.status)) throw fault(result?.error?.code || 'account_material_conflict');
          const count = result.status === 'stored' ? prepared.addedSources : 0;
          addedSources += count;
          registrations.push({ id: descriptor.id, status: result.status, revision: result.revision, addedSources: count });
        }
        return { status: registrations.some(row => row.status === 'stored') ? 'stored' : registrations.length ? 'already_registered' : 'no_registry', addedSources, registrations };
      } catch (error) {
        if (registrations.some(row => row.status === 'stored')) throw Object.assign(fault('account_material_partial'), { registeredCount: registrations.length, addedSources });
        throw error;
      } finally {
        signal?.removeEventListener('abort', abort);
        activeRemote?.dispose(); activeRemote = null; running = false;
      }
    }
    return Object.freeze({ register, dispose() { disposed = true; generation++; activeRemote?.dispose(); } });
  }
  return Object.freeze({ prepare, create });
});

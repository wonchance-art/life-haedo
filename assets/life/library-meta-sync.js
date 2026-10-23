/* Domain adapter over the existing durable CompositionSync state machine. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).LibraryMetaSync = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  function create({ storage, sourceSync, auth = root.HaedoAuth, remote, engine = root.HaedoLife?.CompositionSync } = {}) {
    const transport = root.HaedoLife?.LibraryRemote || (typeof require === 'function' && require('./library-remote.js'));
    engine ||= typeof require === 'function' && require('./composition-sync.js');
    remote ||= transport.create({ auth });
    const adapter = {
      account: storage.account,
      getCompositionState: id => storage.getLibraryMetaState(id),
      bindCompositionSync: (...args) => storage.bindLibraryMetaSync(...args),
      pauseCompositionSync: (...args) => storage.pauseLibraryMetaSync(...args),
      prepareCompositionUpload: (...args) => storage.prepareLibraryMetaUpload(...args),
      ackCompositionSync: (...args) => storage.ackLibraryMetaSync(...args),
      applyCompositionRemote: (...args) => storage.applyLibraryMetaRemote(...args),
      setCompositionConflict: (...args) => storage.setLibraryMetaConflict(...args),
      setCompositionError: (...args) => storage.setLibraryMetaError(...args),
      resolveCompositionSync: async (...args) => {
        const result = await storage.resolveLibraryMetaSync(...args);
        return { workbench: result.metadata, metadata: result.sync, recoveryId: result.recoveryId };
      },
      readWorkbenchSnapshot: async id => {
        const value = await storage.readLibraryMetaSnapshot(id); return { bundle: value.bundle, workbench: value.metadata };
      },
      listWorkspaces: () => storage.listWorkspaces(),
      subscribe: (id, listener) => storage.subscribe(id, event => {
        if (['source_folders_changed', 'collection_changed', 'nine_board_changed'].includes(event.type)) listener({ ...event, type: 'workbench_changed' });
        else if (event.type === 'library_meta_sync_changed') listener({ ...event, type: 'composition_sync_changed' });
      })
    };
    return engine.create({ storage: adapter, sourceSync, auth, remote, errorCleaner: transport.clean,
      initialReceive: (id, binding, row, options) => storage.adoptLibraryMetaRemote(id, binding, row, options) });
  }
  return Object.freeze({ create });
});

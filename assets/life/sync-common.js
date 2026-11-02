/* Shared sync helpers (structure review S1). Pure functions: no network, storage or DOM. */
(function (root, factory) {
  'use strict'; const api = factory(); (root.HaedoLife ||= {}).SyncCommon = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function () {
  'use strict';
  // Sorted-JSON text of S0 group G3 (tests/structure-baseline.test.cjs), shared by blog-sync and
  // material-continuity-sync. The output must stay byte-identical: material-continuity-sync hashes it
  // into preparation fingerprints that are stored on devices and on the server. It is not JSON for
  // undefined values, toJSON methods or sparse-array holes, and a Date becomes {}; those are pinned
  // as they are and are not to be changed without a fingerprint migration.
  const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
  return Object.freeze({ canonical });
});

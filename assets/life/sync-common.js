/* Shared sync helpers (structure review S1). Pure functions: no network, storage or DOM. */
(function (root, factory) {
  'use strict'; const api = factory(); (root.HaedoLife ||= {}).SyncCommon = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function () {
  'use strict';
  // Sorted-JSON text of S0 group G3 (tests/structure-baseline.test.cjs), shared by blog-sync and
  // material-continuity-sync. Both use it only within one run (equality checks and a check hash that
  // is compared and dropped); its output is not stored anywhere today. The stored fingerprints come
  // from other helpers: G4 material-continuity.js fingerprint() (preparations on devices), G3
  // naver-capture.js (its own copy, run by the Naver Edge function; capture hash on the server) and G6
  // account-materials.js (registration receipts). The output stays pinned by S0 all the same: it is
  // not JSON for undefined values, toJSON methods or sparse-array holes, and a Date becomes {}.
  const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
  return Object.freeze({ canonical });
});

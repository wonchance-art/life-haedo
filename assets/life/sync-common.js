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
  // One refresh at a time (2026-11-04: each sync or library event re-read every status, ~20 overlapping
  // status refreshes on a first sign-in). A request made while a run is in progress is served by one
  // more run after it, shared by every request made meanwhile; each request therefore settles with a
  // run that started after it was made, so the last event is always read again. Runs never overlap,
  // so an earlier read cannot land after a later one. A failed run rejects only the requests it serves.
  function latest(run) {
    let active = null, again = null;
    return function request() {
      if (!active) {
        // Started at once, as a direct call would (the run captures what it reads before its first await).
        let current;
        try { current = Promise.resolve(run()); } catch (error) { current = Promise.reject(error); }
        active = current;
        current.then(() => { if (active === current) active = null; }, () => { if (active === current) active = null; });
        return current;
      }
      if (!again) again = active.then(() => {}, () => {}).then(() => { again = null; return request(); });
      return again;
    };
  }
  return Object.freeze({ canonical, latest });
});

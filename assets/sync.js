/* A document owns its timer. Writes never overlap for the same document. */
(function (root) {
  function createQueue(write, delay = 1500) {
    const timers = new Map(), running = new Map(), again = new Set();
    async function flush(id) {
      clearTimeout(timers.get(id)); timers.delete(id);
      if (running.has(id)) { again.add(id); return running.get(id); }
      const job = (async () => {
        do { again.delete(id); await write(id); } while (again.has(id));
      })();
      running.set(id, job);
      try { await job; } finally { running.delete(id); }
    }
    return {
      schedule(id) {
        clearTimeout(timers.get(id));
        timers.set(id, setTimeout(() => { flush(id).catch(() => {}); }, delay));
      },
      flush,
      pending: id => timers.has(id) || running.has(id),
      cancel(id) { clearTimeout(timers.get(id)); timers.delete(id); again.delete(id); },
      clear() { for (const id of timers.keys()) clearTimeout(timers.get(id)); timers.clear(); again.clear(); }
    };
  }
  async function writeSnapshot({ request, base, headers, row, seen }) {
    const filter = `?id=eq.${encodeURIComponent(row.id)}`;
    const check = await request(`${base}${filter}&select=updated_at`, () => ({ headers: headers() }));
    if (!check.ok) throw new Error(`HTTP ${check.status}`);
    const rows = await check.json();
    if (!Array.isArray(rows)) throw new Error('잘못된 응답');
    const remote = rows[0];
    if (!remote && seen) return { conflict: true }; // Do not resurrect a remote deletion.
    if (remote && (!seen || remote.updated_at !== seen)) return { conflict: true };
    // A conditional PATCH closes the gap between checking and updating the row.
    const url = remote ? `${base}${filter}&updated_at=eq.${encodeURIComponent(seen)}` : base;
    const response = await request(url, () => ({
      method: remote ? 'PATCH' : 'POST',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify(remote ? row : [row])
    }));
    if (response.status === 409) return { conflict: true };
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const saved = await response.json();
    if (!Array.isArray(saved) || saved.length !== 1) return { conflict: true };
    return { stamp: saved[0].updated_at || row.updated_at };
  }
  // One upload of a document at a time across this browser's tabs and pages (Web Locks). A second
  // writer waits for the first and then reads what it stored (its own dirty check sees a clean
  // document and sends nothing). Without the API it just runs: the dirty check and the
  // conditional write still keep both copies (at worst one extra request).
  function exclusive(name, run) {
    const locks = root.navigator?.locks;
    return typeof locks?.request === 'function' ? locks.request(name, () => run()) : run();
  }
  // A request that cannot hold a document's lock forever: aborted after ms. The caller treats
  // the timeout as "not sent yet" (code 'timeout') and sends again later.
  function timed(request, ms) {
    return (url, options) => {
      ms = ms ?? api.timeoutMs;
      const value = typeof options === 'function' ? options() : (options || {});
      const controller = new AbortController(), late = () => Object.assign(new Error('응답이 늦어 잠시 뒤 다시 보냅니다.'), { code: 'timeout' });
      let timer;
      // Rejects at the limit even if the request ignores the abort (the request is aborted too).
      const limit = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(late()); }, ms); });
      const sent = Promise.resolve().then(() => request(url, { ...value, signal: controller.signal }))
        .catch(error => { if (controller.signal.aborted) throw late(); throw error; });
      return Promise.race([sent, limit]).finally(() => clearTimeout(timer));
    };
  }
  // 30 s by default; checks shorten it.
  const api = { createQueue, writeSnapshot, exclusive, timed, timeoutMs: 30000 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HaedoSync = api;
})(globalThis);

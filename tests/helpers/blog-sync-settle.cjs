'use strict';
/* Owner directive 2026-11-01: every saved post and draft uploads to the
 * owner's private account storage in the background. A suite that compares a
 * stable local snapshot first waits for that cycle with an explicit condition:
 * every photo post of the workspace has a binding whose status is 'synced',
 * whose localRevision matches the post and which has no pending request.
 * An 'online' event starts an immediate cycle (no backoff); the regular
 * 30-second cycle would reach the same state without it. */
async function blogSyncState(page, workspaceId = null) {
  return page.evaluate(async requested => {
    const s = HaedoLife.Shell.storage, ws = requested || await s.getActive(), rows = await s.listPhotoPosts(ws);
    const states = await Promise.all(rows.map(row => s.readBlogSyncState(ws, row.id)));
    return rows.map((row, index) => ({ id: row.id, status: row.status, revision: row.revision, sync: states[index] &&
      { status: states[index].status, localRevision: states[index].localRevision, pending: !!states[index].pending, error: states[index].error || null } }));
  }, workspaceId);
}
const settledRow = row => row.sync?.status === 'synced' && row.sync.localRevision === row.revision && !row.sync.pending && !row.sync.error;
async function blogSyncSettled(page, workspaceId = null, { timeout = 45000, kickEvery = 3000 } = {}) {
  const start = Date.now(); let last = 0, value;
  for (;;) {
    if (Date.now() - last >= kickEvery) { last = Date.now(); await page.evaluate(() => dispatchEvent(new Event('online'))); }
    value = await blogSyncState(page, workspaceId);
    if (value.every(settledRow)) return value;
    if (Date.now() - start > timeout) throw new Error('Background blog sync did not settle: ' + JSON.stringify(value).slice(0, 800));
    await new Promise(resolve => setTimeout(resolve, 150));
  }
}
module.exports = { blogSyncState, blogSyncSettled };

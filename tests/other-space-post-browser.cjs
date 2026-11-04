/* Posts of a space this device has not received yet (2026-11-04, kept from the P1 attempt).
 * BlogSync places such a post in the active space and keeps its server space as `remoteWorkspaceId`,
 * so the list never waits for the background space receive. These checks hold the background receive
 * (its first request is the account catalog, life_library_catalog) until they release it, and prove:
 * - the post shows in the active space, and the space arriving later adds no second copy;
 * - an edit saved before the space arrives goes to the post's own server space with compare-and-set
 *   on the revision it held and leaves its receipt; the space arriving afterwards adds no copy.
 * Real app, bundled SDK and IndexedDB; anonymous FakeCloud. Not a production or Apple-device check.
 * BASE_URL=http://127.0.0.1:4173 node tests/other-space-post-browser.cjs */
'use strict';
const assert = require('node:assert/strict');
const { CompositionCloud } = require('./composition-sync-browser.cjs');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext } = require('./unified-home-browser.cjs');
const Core = require('../assets/life/core.js');
const Workbench = require('../assets/life/workbench.js');
const Metadata = require('../assets/life/library-meta.js');

const ids = ['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'];
const TITLE = '다른 공간의 최신 글';
const copy = value => structuredClone(value);
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function until(read, ok, label, timeout = 60000) {
  const end = Date.now() + timeout; let value;
  do { value = await read(); if (ok(value)) return value; await sleep(50); } while (Date.now() < end);
  throw Error(label + ' did not happen: ' + JSON.stringify(value)?.slice(0, 300));
}
async function bundles() {
  const out = [];
  for (const [w, count] of [[0, 3], [1, 2]]) {
    let bundle = Core.createWorkspace({ workspaceId: ids[w], title: '익명 자료공간 ' + (w + 1) });
    for (let n = 0; n < count; n++) {
      const prepared = await Core.prepareImport({ origin: 'obsidian', title: '익명 자료 ' + w + '-' + n, text: '# 익명 ' + n + '\n\n합성 원문입니다.\n', authorRelation: 'self', forceSeparate: true }, bundle);
      bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, prepared));
    }
    out.push(bundle);
  }
  return out;
}
function seed(rows) {
  const server = new CompositionCloud().enableAccountLibrary();
  for (const bundle of rows) {
    const key = server.key(accounts.a.id, bundle.workspaceId);
    server.rows.set(key, { owner_id: accounts.a.id, id: bundle.workspaceId, title: bundle.title, revision: 1, data: copy(bundle), updated_at: bundle.updatedAt });
    server.compositions.set(key, { workspace_id: bundle.workspaceId, revision: 1, source_revision: 1, data: Workbench.empty(bundle.workspaceId), updated_at: bundle.updatedAt });
    server.libraryMetadata.set(key, { workspace_id: bundle.workspaceId, revision: 1, source_revision: 1, data: Metadata.empty(bundle.workspaceId), updated_at: bundle.updatedAt });
  }
  server.libraryDefaults.set(accounts.a.id, { workspaceId: ids[0], defaultRevision: 1, initialHash: null, initialRevision: null });
  return server;
}
// A device whose background space receive waits for `gate`.
async function device(browser, server, name, gate) {
  const context = await makeContext(browser, server, name, accounts.a, { viewport: { width: 1280, height: 900 } });
  await context.route(cloud + '/rest/v1/rpc/life_library_catalog', async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    await gate; return route.fallback();
  });
  const page = await context.newPage(); page.setDefaultTimeout(60000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  return { context, page, errors };
}
const firstRow = page => page.evaluate(() => document.querySelector('#homePostList .home-post, #homePostList .home-draft')?.textContent || null);
const spaceReceived = (page, id) => page.evaluate(async id => (await HaedoLife.Shell.storage.listWorkspaces()).some(row => row.workspaceId === id), id);
// Local copies of one server post across the account's spaces, and its rows in the list.
async function copies(page, remoteId) {
  return page.evaluate(async remoteId => {
    const s = HaedoLife.Shell.storage; let installed = 0;
    for (const library of await s.listAccountLibraries()) installed += (await s.listBlogSyncStates(library.workspaceId)).states.filter(entry => entry.state?.remoteId === remoteId).length;
    return installed;
  }, remoteId);
}
const rowsTitled = page => page.evaluate(title => [...document.querySelectorAll('#homePostList .home-post')].filter(row => row.textContent.includes(title)).length, TITLE);

async function main() {
  const rows = await bundles();
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const results = []; let failed = 0;
  async function check(name, run) {
    try { await run(); results.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { failed++; results.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
  }
  try {
    // The newest post of the account lives in the second (non-default) space.
    const server = seed(rows);
    const writer = await device(browser, server, 'writer', Promise.resolve());
    await writer.page.goto(base + '/index.html');
    await until(() => writer.page.evaluate(async ids => {
      const s = HaedoLife.Shell?.storage; if (!s) return 0;
      return (await s.listAccountLibraries()).filter(row => ids.includes(row.workspaceId)).length;
    }, ids), n => n === 2, 'writer received both spaces');
    const newest = await writer.page.evaluate(async ({ ids, title }) => {
      const L = HaedoLife, s = L.Shell.storage, at = Date.now();
      const make = async (ws, title, offset) => {
        const doc = L.PhotoPost.create(L.Core.id, new Date(at - offset).toISOString());
        Object.assign(doc, { status: 'saved', title, ops: [{ insert: title + ' 본문\n' }] });
        return (await s.savePhotoPost(ws, doc, 0)).id;
      };
      for (let n = 0; n < 2; n++) await make(ids[0], '기본 공간의 이전 글 ' + n, 600000 + n * 1000);
      return make(ids[1], title, 0);
    }, { ids, title: TITLE });
    await until(() => server.posts.size, n => n === 3, 'posts uploaded');
    assert.deepEqual(writer.errors, []);
    await writer.context.close();

    await check('a post of a space not received yet shows in the active space with its own server space, and the space arriving later adds no copy', async () => {
      let release; const gate = new Promise(done => { release = done; });
      const d = await device(browser, server, 'new-device', gate);
      await d.page.goto(base + '/index.html');
      await until(() => firstRow(d.page), row => row?.includes(TITLE), 'the newest post shown first');
      const placed = await d.page.evaluate(async newest => {
        const s = HaedoLife.Shell.storage, active = await s.getActive(), state = await s.readBlogSyncState(active, newest);
        return { active, remoteWorkspaceId: state?.remoteWorkspaceId, local: (await s.listWorkspaces()).map(row => row.workspaceId) };
      }, newest);
      assert.equal(placed.active, ids[0]); assert.equal(placed.remoteWorkspaceId, ids[1]);
      assert.ok(!placed.local.includes(ids[1]), 'the post\'s own space is not on this device yet');
      release();
      await until(() => spaceReceived(d.page, ids[1]), Boolean, 'own space received');
      await d.page.evaluate(() => HaedoLife.BlogSync.forStorage(HaedoLife.Shell.storage).syncNow({ force: true }));
      assert.equal(await copies(d.page, newest), 1, 'the post is installed once across the account\'s spaces');
      assert.equal(await until(() => rowsTitled(d.page), n => n > 0, 'row shown'), 1, 'one row in the list');
      assert.deepEqual(d.errors, []);
      await d.context.close();
    });

    await check('an edit saved before its space arrives goes to its own server space with compare-and-set and a receipt; the space then arrives without a copy', async () => {
      let release; const gate = new Promise(done => { release = done; });
      const d = await device(browser, server, 'edit-before-receive', gate);
      await d.page.goto(base + '/index.html');
      await until(() => firstRow(d.page), row => row?.includes(TITLE), 'the newest post shown first');
      const before = [...server.posts.values()].find(row => row.id === newest), calls = server.blogCalls.length;
      const edited = await d.page.evaluate(async ({ ids, newest }) => {
        const L = HaedoLife, s = L.Shell.storage, active = await s.getActive();
        const local = (await s.listWorkspaces()).map(row => row.workspaceId);
        const post = await s.readPhotoPost(active, newest);
        await s.savePhotoPost(active, { ...post, title: post.title + ' (고침)' }, post.revision);
        await L.BlogSync.forStorage(s).syncNow({ force: true });
        const state = await s.readBlogSyncState(active, newest);
        return { local, remoteWorkspaceId: state.remoteWorkspaceId, remoteRevision: state.remoteRevision, pending: state.pending };
      }, { ids, newest });
      assert.ok(!edited.local.includes(ids[1]), 'the post\'s own space is not on this device yet');
      const after = [...server.posts.values()].find(row => row.id === newest);
      assert.equal(after.workspace_id, ids[1], 'saved to its own server space');
      assert.equal(after.revision, before.revision + 1); assert.match(after.data.title, /\(고침\)$/);
      const save = server.blogCalls.slice(calls).find(call => call.rpc === 'life_blog_save' && call.body.p_post_id === newest);
      assert.equal(save.body.p_workspace_id, ids[1]); assert.equal(save.body.p_expected_revision, before.revision, 'compare-and-set on the revision it held');
      assert.ok(server.blogReceipts.has(accounts.a.id + ':' + save.body.p_operation_id), 'the save left its receipt');
      assert.deepEqual([edited.remoteWorkspaceId, edited.remoteRevision, edited.pending], [ids[1], after.revision, null]);
      release();
      await until(() => spaceReceived(d.page, ids[1]), Boolean, 'own space received');
      await d.page.evaluate(() => HaedoLife.BlogSync.forStorage(HaedoLife.Shell.storage).syncNow({ force: true }));
      assert.equal(await copies(d.page, newest), 1, 'the post is installed once across the account\'s spaces');
      assert.equal(await until(() => rowsTitled(d.page), n => n > 0, 'row shown'), 1, 'one row in the list');
      assert.deepEqual(d.errors, []);
      await d.context.close();
    });
  } finally { await browser.close(); }
  console.log(JSON.stringify({ passed: results.filter(r => r.pass).length, total: results.length }));
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });

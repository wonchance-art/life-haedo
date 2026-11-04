/* P1 (2026-11-04, owner-approved): the background account receive (other spaces, compositions,
 * metadata) starts once the first screen has what it needs: the earliest of BlogSync's first pass
 * ending (a failed pass too), the home list showing its first post, or 5 s after the account check.
 * Its first request is the account catalog (life_library_catalog), so that request marks the start.
 * Real app, bundled SDK and IndexedDB; anonymous FakeCloud. Not a production or Apple-device check.
 * BASE_URL=http://127.0.0.1:4173 node tests/first-screen-background-browser.cjs */
'use strict';
const assert = require('node:assert/strict');
const { CompositionCloud } = require('./composition-sync-browser.cjs');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext } = require('./unified-home-browser.cjs');
const Core = require('../assets/life/core.js');
const Workbench = require('../assets/life/workbench.js');
const Metadata = require('../assets/life/library-meta.js');

const ids = ['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'];
const LIMIT = 5000;
const copy = value => structuredClone(value);
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function until(read, ok, label, timeout = 60000) {
  const end = Date.now() + timeout; let value;
  do { value = await read(); if (ok(value)) return value; await sleep(50); } while (Date.now() < end);
  throw Error(label + ' did not happen: ' + JSON.stringify(value)?.slice(0, 300));
}
async function bundles() {
  const out = [];
  for (const [w, count] of [[0, 6], [1, 3]]) {
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
// A device whose requests are timed (Date.now in Node and in the page share the machine clock).
async function device(browser, server, name, { hold = null, fail = null, listDelay = 0, catalogGate = null } = {}) {
  const context = await makeContext(browser, server, name, accounts.a, { viewport: { width: 1280, height: 900 } });
  const seen = [];
  context.on('request', request => { const url = new URL(request.url()); if (url.origin === cloud && request.method() !== 'OPTIONS') seen.push({ path: url.pathname, at: Date.now() }); });
  if (hold || fail || listDelay) await context.route(cloud + '/rest/v1/rpc/life_blog_sync_list', async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    if (fail) return route.abort('internetdisconnected');
    if (listDelay) { await sleep(listDelay); return route.fallback(); }
    await new Promise(() => {}); // never answers
  });
  // Holds the background receive (its first request is the catalog) until the test releases it.
  if (catalogGate) await context.route(cloud + '/rest/v1/rpc/life_library_catalog', async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    await catalogGate; return route.fallback();
  });
  await context.addInitScript(() => {
    const m = window.__first = { shell: null, row: null, rowTitle: null, pass: null };
    const ended = status => status && !status.running && (status.lastSyncAt || status.lastError);
    let hooked = false;
    const tick = () => {
      const app = document.getElementById('lifeApp');
      // BlogSync's first pass end, the other trigger of the background receive.
      const blog = !hooked && globalThis.HaedoLife?.Shell?.storage && globalThis.HaedoLife.BlogSync?.forStorage?.(globalThis.HaedoLife.Shell.storage);
      if (blog) { hooked = true; if (ended(blog.getStatus())) m.pass = Date.now(); else blog.subscribe(event => { if (m.pass === null && event?.type === 'status' && ended(event.status)) m.pass = Date.now(); }); }
      if (m.shell === null && app && !app.hidden && globalThis.HaedoAuth?.user) m.shell = Date.now();
      const row = document.querySelector('#homePostList .home-post, #homePostList .home-draft');
      if (m.row === null && row) { m.row = Date.now(); m.rowTitle = row.textContent; }
      if (m.row === null || m.shell === null || !hooked) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const page = await context.newPage(); page.setDefaultTimeout(60000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  return { context, page, seen, errors };
}
const catalogAt = d => d.seen.find(row => row.path === '/rest/v1/rpc/life_library_catalog')?.at ?? null;

async function main() {
  const rows = await bundles();
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const results = []; let failed = 0;
  async function check(name, run) {
    try { await run(); results.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { failed++; results.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
  }
  try {
    // One server for the post cases: the newest post lives in the second (non-default) space.
    const server = seed(rows);
    const writer = await device(browser, server, 'writer');
    await writer.page.goto(base + '/index.html');
    await until(() => writer.page.evaluate(async ids => {
      const s = HaedoLife.Shell?.storage; if (!s) return 0;
      return (await s.listAccountLibraries()).filter(row => ids.includes(row.workspaceId)).length;
    }, ids), n => n === 2, 'writer received both spaces');
    const newest = await writer.page.evaluate(async ids => {
      const L = HaedoLife, s = L.Shell.storage, at = Date.now();
      const make = async (ws, title, offset) => {
        const doc = L.PhotoPost.create(L.Core.id, new Date(at - offset).toISOString());
        Object.assign(doc, { status: 'saved', title, ops: [{ insert: title + ' 본문\n' }] });
        return (await s.savePhotoPost(ws, doc, 0)).id;
      };
      for (let n = 0; n < 3; n++) await make(ids[0], '기본 공간의 이전 글 ' + n, 600000 + n * 1000);
      return make(ids[1], '다른 공간의 최신 글', 0);
    }, ids);
    await until(() => server.posts.size, n => n === 4, 'posts uploaded');
    await writer.context.close();

    await check('a new device shows the newest post of a space it has not received yet, then starts the background receive after that first row', async () => {
      // The post list answers 800 ms late, so the first screen is ready well after the shell shows.
      const d = await device(browser, server, 'new-device', { listDelay: 800 });
      await d.page.goto(base + '/index.html');
      const first = await until(() => d.page.evaluate(() => window.__first), m => m.row !== null, 'first row');
      assert.match(first.rowTitle, /다른 공간의 최신 글/, 'the newest post comes first');
      const catalog = await until(() => catalogAt(d), Boolean, 'background receive started');
      const marks = await d.page.evaluate(() => window.__first), ready = Math.min(marks.row ?? Infinity, marks.pass ?? Infinity);
      assert.ok(Number.isFinite(ready), 'a first-screen signal was seen');
      assert.ok(catalog >= ready - 50, 'the background receive starts after the first row or the first BlogSync pass (' + (catalog - ready) + ' ms)');
      assert.ok(catalog - marks.shell >= 700, 'not right after the shell (' + (catalog - marks.shell) + ' ms)');
      assert.ok(catalog - first.shell <= LIMIT + 2000, 'and within the limit after the screen');
      // The post keeps its own server space while it sits in the active space.
      const placed = await d.page.evaluate(async ({ ids, newest }) => {
        const s = HaedoLife.Shell.storage, active = await s.getActive();
        const state = await s.readBlogSyncState(active, newest);
        return { active, remoteWorkspaceId: state?.remoteWorkspaceId };
      }, { ids, newest });
      assert.equal(placed.active, ids[0]); assert.equal(placed.remoteWorkspaceId, ids[1]);
      // The space itself still arrives through the background receive.
      await until(() => d.page.evaluate(async id => (await HaedoLife.Shell.storage.listWorkspaces()).some(row => row.workspaceId === id), ids[1]), Boolean, 'second space received');
      assert.deepEqual(d.errors, []);
      await d.context.close();
    });

    await check('a post of a space not yet received, edited before that space arrives, is saved to its own server space; the space then arrives without a duplicate', async () => {
      let release; const gate = new Promise(done => { release = done; });
      const d = await device(browser, server, 'edit-before-receive', { catalogGate: gate });
      await d.page.goto(base + '/index.html');
      await until(() => d.page.evaluate(() => window.__first), m => m.row !== null, 'first row');
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
      await until(() => d.page.evaluate(async id => (await HaedoLife.Shell.storage.listWorkspaces()).some(row => row.workspaceId === id), ids[1]), Boolean, 'own space received');
      await d.page.evaluate(() => HaedoLife.BlogSync.forStorage(HaedoLife.Shell.storage).syncNow({ force: true }));
      const copies = await d.page.evaluate(async newest => {
        const s = HaedoLife.Shell.storage; let n = 0;
        for (const library of await s.listAccountLibraries()) {
          const value = await s.listBlogSyncStates(library.workspaceId);
          n += value.states.filter(entry => entry.state?.remoteId === newest).length;
        }
        return n;
      }, newest);
      assert.equal(copies, 1, 'the post is installed once across the account\'s spaces');
      const rows = await until(() => d.page.evaluate(() => [...document.querySelectorAll('#homePostList .home-post')].filter(row => /다른 공간의 최신 글/.test(row.textContent)).length), n => n > 0, 'row shown');
      assert.equal(rows, 1, 'one row in the list');
      assert.deepEqual(d.errors, []);
      await d.context.close();
    });

    await check('when BlogSync never answers and no post shows, the background receive starts at the 5 s limit', async () => {
      const d = await device(browser, server, 'held-list', { hold: true });
      await d.page.goto(base + '/index.html');
      const first = await until(() => d.page.evaluate(() => window.__first), m => m.shell !== null, 'shell');
      const catalog = await until(() => catalogAt(d), Boolean, 'background receive started', 20000);
      const after = catalog - first.shell;
      assert.equal((await d.page.evaluate(() => window.__first)).row, null, 'no post was shown');
      assert.ok(after >= LIMIT - 2500 && after <= LIMIT + 2000, 'started at the limit (' + after + ' ms after the screen)');
      await d.context.close();
    });

    await check('a failed BlogSync pass (offline) starts the background receive without waiting for the limit', async () => {
      const d = await device(browser, server, 'failed-list', { fail: true });
      await d.page.goto(base + '/index.html');
      const first = await until(() => d.page.evaluate(() => window.__first), m => m.shell !== null, 'shell');
      const catalog = await until(() => catalogAt(d), Boolean, 'background receive started', 20000);
      assert.ok(catalog - first.shell < LIMIT - 1500, 'started before the limit (' + (catalog - first.shell) + ' ms)');
      await d.context.close();
    });

    await check('a page that leaves before the start never starts the background receive for that page', async () => {
      const d = await device(browser, server, 'left', { hold: true });
      await d.page.goto(base + '/index.html');
      await until(() => d.page.evaluate(() => window.__first), m => m.shell !== null, 'shell');
      await d.page.goto('about:blank');
      const left = Date.now();
      await sleep(LIMIT + 1500);
      assert.equal(d.seen.filter(row => row.path === '/rest/v1/rpc/life_library_catalog' && row.at >= left).length, 0);
      await d.context.close();
    });
    await check('signing out in the page before the start never starts the background receive', async () => {
      const d = await device(browser, server, 'signed-out', { hold: true });
      await d.page.goto(base + '/index.html');
      await until(() => d.page.evaluate(() => window.__first), m => m.shell !== null, 'shell');
      await d.page.evaluate(() => document.dispatchEvent(new Event('haedo:signed-out')));
      const left = Date.now();
      await sleep(LIMIT + 1500);
      assert.equal(d.seen.filter(row => row.path === '/rest/v1/rpc/life_library_catalog' && row.at >= left).length, 0);
      await d.context.close();
    });

    await check('a suspended page (back/forward cache) starts nothing past the limit; after it resumes and checks the account it starts', async () => {
      const d = await device(browser, server, 'suspended', { hold: true });
      await d.page.goto(base + '/index.html');
      await until(() => d.page.evaluate(() => window.__first), m => m.shell !== null, 'shell');
      await d.page.evaluate(() => document.dispatchEvent(new Event('haedo:page-suspend')));
      await sleep(LIMIT + 1500);
      assert.equal(catalogAt(d), null, 'nothing started while suspended');
      const resumed = Date.now();
      await d.page.evaluate(() => document.dispatchEvent(new Event('haedo:page-resume', { cancelable: true })));
      const catalog = await until(() => catalogAt(d), Boolean, 'background receive after resume', 20000);
      assert.ok(catalog >= resumed);
      const ready = await d.page.evaluate(() => !document.getElementById('lifeApp').hidden);
      assert.equal(ready, true, 'the resumed page is shown again');
      await d.context.close();
    });
  } finally { await browser.close(); }
  console.log(JSON.stringify({ passed: results.filter(r => r.pass).length, total: results.length }));
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });

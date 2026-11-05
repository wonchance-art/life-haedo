/* A deleted material-writing output must remain deleted on a device that never
 * received it. Actual app/SDK/IndexedDB and isolated PostgreSQL material, blog,
 * and account-document RPCs; synthetic Auth/Storage HTTP only. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4326';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { LocalSQLMaterialCloud } = require('./material-continuity-sql-fixture.cjs');
const { digest } = require('./blog-completion-browser.cjs');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { accounts, openAccount, cloud, base } = require('./life-sync-browser.cjs');
const { seedMaterials, seedPlan, enter } = require('./material-writing-browser.cjs');
const { call, syncMaterials } = require('./material-continuity-browser.cjs');
const { awaitCondition } = require('./helpers/await-condition.cjs');
const output = path.resolve(process.env.C3_OUTPUT_DIR || path.join(__dirname, '../.local/material-deleted-marker-sync'));
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const ACCOUNT_RPCS = new Set(['life_account_document_put', 'life_account_document_changes']);

// The existing material fixture uses real SQL for blog/materials. This narrow
// subclass also sends the two existing account-document calls to their actual
// SQL functions, rather than claiming the inherited in-memory model proves RLS.
class DeletedMarkerCloud extends LocalSQLMaterialCloud {
  constructor(options) { super(options); this.documentCalls = []; this.offlineDevices = new Set(); this.responseGates = new Map(); this.pausedMaterials = new Map(); }
  pauseMaterials(device) {
    assert(!this.pausedMaterials.has(device)); let release;
    const gate = { waiting: new Promise(resolve => { release = resolve; }), release: () => { this.pausedMaterials.delete(device); release(); } };
    this.pausedMaterials.set(device, gate); return gate;
  }
  holdResponse(kind, predicate) {
    assert(!this.responseGates.has(kind)); let entered, release;
    const gate = { predicate, arrived: new Promise(resolve => { entered = resolve; }), waiting: new Promise(resolve => { release = resolve; }),
      release: () => release(), entered: value => entered(value) };
    this.responseGates.set(kind, gate); return gate;
  }
  async waitResponse(kind, entry, response) {
    const gate = this.responseGates.get(kind);
    if (!gate?.predicate(entry, response)) return;
    this.responseGates.delete(kind); gate.entered({ entry, response }); await gate.waiting;
  }
  async prepareAll() {
    await this.prepare('supabase/migrations/20261019005829_life_material_continuity.sql');
    const bootstrap = 'create table auth.users (id uuid primary key);\ninsert into auth.users(id) values ' +
      Object.values(accounts).map(account => '(' + literal(account.id) + '::uuid)').join(',') + ';\n';
    const migrations = await Promise.all([
      'supabase/migrations/20261101090000_life_account_documents.sql',
      'supabase/migrations/20261101150000_life_account_documents_owner_lock.sql'
    ].map(name => fs.readFile(path.resolve(__dirname, '..', name), 'utf8')));
    this.docker(['exec', '-i', this.container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '--dbname', this.database], bootstrap + migrations.join('\n'));
  }
  async initialize() {
    await super.initialize();
    const rows = this.sql(`select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'args',
      (select coalesce(jsonb_agg(jsonb_build_object('name',p.proargnames[i],'type',format_type(p.proargtypes[i-1],null)) order by i),'[]')
       from generate_series(1,p.pronargs) i))),'[]')
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('life_account_document_put','life_account_document_changes');`);
    assert.equal(rows.length, 2, 'Install both real account-document RPCs in the disposable database');
    for (const row of rows) { assert(!this.functions.has(row.name)); this.functions.set(row.name, row.args); }
  }
  rpc(owner, name, input, role = owner ? 'authenticated' : 'anon') {
    if (!ACCOUNT_RPCS.has(name)) return super.rpc(owner, name, input, role);
    const signature = new Map(this.functions.get(name).map(arg => [arg.name, arg.type]));
    const args = Object.entries(input).map(([key, value]) => {
      assert.match(key, /^p_[a-z0-9_]+$/); assert(signature.has(key), 'Unexpected account-document argument');
      return key + ' => ' + this.typed(value, signature.get(key));
    }).join(',');
    const query = name === 'life_account_document_changes' ?
      `select coalesce(jsonb_agg(to_jsonb(row)),'[]'::jsonb) from public.${name}(${args}) row;` :
      `select to_jsonb(public.${name}(${args}));`;
    return this.sql(query, { owner, role });
  }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url()), rpc = url.pathname.split('/').at(-1);
    if (this.offlineDevices.has(device) && request.method() !== 'OPTIONS') { this.expectedFailures++; return route.abort('internetdisconnected'); }
    if (url.pathname.startsWith('/rest/v1/rpc/life_material_') && request.method() === 'POST') await this.pausedMaterials.get(device)?.waiting;
    const blogGate = rpc === 'life_blog_read' && request.method() === 'POST' && this.responseGates.get('blog')?.predicate({ device, body: request.postDataJSON() });
    if (!url.pathname.startsWith('/rest/v1/rpc/') || (!ACCOUNT_RPCS.has(rpc) && !blogGate)) return super.handle(route, device);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'content-type': 'application/json', 'cache-control': 'no-store' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    assert.equal(request.method(), 'POST');
    const owner = this.owner(request), body = request.postDataJSON(), entry = { owner, device, rpc, body };
    (blogGate ? this.blogRequests : this.documentCalls).push(entry);
    try {
      const response = this.rpc(owner, rpc, body); await this.waitResponse(blogGate ? 'blog' : 'document', entry, response);
      return route.fulfill({ status: 200, headers, body: JSON.stringify(response) });
    }
    catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      return route.fulfill({ status: error.code === '42501' ? 403 : 400, headers, body: JSON.stringify({ code: error.code, message: error.message }) });
    }
  }
}

async function allPlans(page) {
  return page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, rows = [];
    for (const workspace of await s.listWorkspaces()) for (const plan of (await s.readMaterialWriting(workspace.workspaceId)).plans)
      rows.push({ ws: workspace.workspaceId, plan, output: await s.readMaterialWritingOutput(workspace.workspaceId, plan.id) });
    return rows;
  });
}
async function syncDocuments(page) { await page.evaluate(() => HaedoLife.Shell.accountDocsSync.syncNow()); }
async function syncPosts(page) { await page.evaluate(() => HaedoLife.BlogSync.forStorage(HaedoLife.Shell.storage).syncNow({ force: true })); }
async function readMarkers(page) {
  return page.evaluate(async () => {
    const owner = HaedoLife.Shell.storage.account.userId;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('life-tools-v1'); request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('meta', 'readonly'), get = tx.objectStore('meta').getAll();
        get.onsuccess = () => resolve(get.result.filter(row => row.key.includes(owner) && /material-writing-output-deleted:|materialOutputDeleted:/.test(row.key)));
        tx.oncomplete = () => db.close(); tx.onerror = tx.onabort = () => reject(tx.error || Error('Marker inspection failed'));
      };
    });
  });
}
async function postCount(page, postId) {
  return page.evaluate(async id => {
    const s = HaedoLife.Shell.storage; let count = 0;
    for (const workspace of await s.listWorkspaces()) count += (await s.listPhotoPosts(workspace.workspaceId)).filter(post => post.id === id).length;
    return count;
  }, postId);
}
async function createOutput(page, title, saved = true) {
  const source = await seedMaterials(page), planId = await seedPlan(page, source, title);
  await page.evaluate(async ws => { await HaedoLife.Shell.sync.enable(ws); await HaedoLife.Shell.sync.syncNow(ws); }, source.workspaceId);
  await syncMaterials(page);
  const revision = await page.evaluate(async ws => (await HaedoLife.Shell.storage.readMaterialWriting(ws)).revision, source.workspaceId);
  const created = await call(page, 'handoff', [source.workspaceId, planId, revision]);
  if (saved) await page.evaluate(async ({ ws, postId }) => {
    const s = HaedoLife.Shell.storage, post = await s.readPhotoPost(ws, postId); post.status = 'saved'; await s.savePhotoPost(ws, post, post.revision);
  }, { ws: source.workspaceId, postId: created.postId });
  await syncPosts(page); await syncMaterials(page);
  const target = (await allPlans(page)).find(row => row.plan.id === planId);
  const state = await call(page, 'getState', [source.workspaceId, planId]);
  assert.equal(state.output.state, saved ? 'saved' : 'writing');
  return { ...source, planId, postId: created.postId, remotePostId: state.output.postId, remotePlanId: state.remoteId, original: target.plan };
}
async function openOutput(page, fixture) {
  await page.goto(base + '/index.html'); await ready(page);
  await page.locator(`#homePosts [data-photo-post-id="${fixture.postId}"] .home-post-open`).click();
  await page.locator('.photo-article').waitFor();
  const more = page.locator('.photo-read-actions .photo-more');
  if (!await more.evaluate(node => node.open)) await more.locator(':scope > summary').click();
}
async function deleteOpenOutput(page) {
  const dialog = new Promise(resolve => page.once('dialog', async event => { assert.equal(event.type(), 'confirm'); await event.accept(); resolve(); }));
  await page.locator('.photo-read-actions .photo-more-menu').getByRole('button', { name: '삭제', exact: true }).click(); await dialog;
  await page.locator('#homePosts').waitFor();
}
async function receiveWorkspace(page, fixture) {
  await page.evaluate(async ws => {
    const s = HaedoLife.Shell.storage;
    if (!(await s.listWorkspaces()).some(row => row.workspaceId === ws)) await HaedoLife.Shell.sync.download(ws, { activate: false });
    await s.setActive(ws);
  }, fixture.workspaceId);
}
async function receive(page, fixture) {
  await receiveWorkspace(page, fixture);
  await syncDocuments(page); await syncMaterials(page);
  const target = (await allPlans(page)).find(row => row.plan.id === fixture.planId);
  assert(target, 'A device first seen after output deletion must receive the original preparation');
  assert.equal(target.output.status, 'deleted', 'The received preparation must resolve to deleted, never indefinitely missing');
  assert.equal(target.output.postId, target.plan.output.postId); assert.equal(target.plan.question, fixture.original.question);
  const state = await call(page, 'getState', [target.ws, target.plan.id]);
  assert.equal(state.output.postId, fixture.remotePostId, 'The received local receipt retains the exact canonical output identity');
  const bundle = await page.evaluate(ws => HaedoLife.Shell.storage.read(ws), target.ws);
  for (const original of [fixture.first, fixture.second])
    assert(bundle.sourceVersions.some(version => version.id === original.versionId && version.contentText === original.raw && version.contentHash === digest(Buffer.from(original.raw))), 'Exact BOM/CRLF original is retained');
  assert.equal(await postCount(page, fixture.postId), 0, 'The deleted post must not arrive or be regenerated');
  return target;
}
async function removeOutput(page, fixture) {
  await page.evaluate(async ({ workspaceId, postId }) => {
    const storage = HaedoLife.Shell.storage, post = await storage.readPhotoPost(workspaceId, postId);
    await HaedoLife.BlogSync.forStorage(storage).deletePost(workspaceId, postId, { expectedRevision: post.revision });
  }, fixture);
  await syncPosts(page);
}
async function receivedPost(page, remoteId) {
  return page.evaluate(async remoteId => {
    const storage = HaedoLife.Shell.storage;
    for (const workspace of await storage.listWorkspaces()) {
      const listed = await storage.listBlogSyncStates(workspace.workspaceId);
      for (const item of listed.states) if (item.state.remoteId === remoteId && listed.posts.some(post => post.id === item.localPostId))
        return { workspaceId: workspace.workspaceId, postId: item.localPostId };
    }
    return null;
  }, remoteId);
}
function copyContent(plan) {
  return { question: plan.question, materials: plan.materials.map(({ id, ...rest }) => rest),
    blocks: plan.blocks.map(({ id, materialId, ...rest }) => rest) };
}

async function main() {
  assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)); await fs.mkdir(output, { recursive: true });
  const server = new DeletedMarkerCloud({ container: process.env.BLOG_POSTGRES_CONTAINER, database: process.env.BLOG_POSTGRES_DATABASE });
  if (process.argv.includes('--prepare-database')) await server.prepareAll(); await server.initialize();
  const report = { checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, sourceLoads: [],
    scope: 'Actual app/SDK/IndexedDB and disposable PostgreSQL material/blog/account-document RPCs and RLS. Synthetic Auth/Storage HTTP; no production accounts, real OAuth, Apple hardware or deployment.' };
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] }); report.browser = browser.version();
  const contexts = []; const only = process.env.C3_CASE || '';
  const pendingGates = [];
  async function gateArrived(gate) {
    let timer;
    try { return await Promise.race([gate.arrived, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('The expected real HTTP response did not reach its gate')), 15000); })]); }
    finally { clearTimeout(timer); }
  }
  async function device(name, owner = accounts.a) {
    const context = await makeContext(browser, server, name, owner, { viewport: { width: 1440, height: 1000 } }); contexts.push(context);
    const state = { name, context, offline: false };
    await context.route(/\/assets\/life\/(?:storage|account-docs-sync|material-continuity-sync|material-writing-ui)\.js$/, async route => {
      const file = new URL(route.request().url()).pathname;
      const override = file.endsWith('/storage.js') ? process.env.C3_STORAGE_OVERRIDE : file.endsWith('/account-docs-sync.js') ? process.env.C3_ACCOUNT_DOCS_OVERRIDE : file.endsWith('/material-writing-ui.js') ? process.env.C3_UI_OVERRIDE : process.env.C3_CONTINUITY_OVERRIDE;
      const response = await route.fetch(), body = override ? await fs.readFile(path.resolve(override)) : await response.body();
      report.sourceLoads.push({ device: name, file, sha256: digest(body), override: !!override }); await route.fulfill({ response, body });
    });
    await context.route('**/*', route => { const origin = new URL(route.request().url()).origin;
      if ([new URL(base).origin, cloud].includes(origin)) return route.fallback(); report.external.push(origin); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); state.page = page; page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', event => { if (event.type() !== 'error') return;
      if (state.offline && event.location().url.startsWith(cloud) && /^Failed to load resource:.*ERR_(INTERNET_DISCONNECTED|FAILED)/.test(event.text())) report.expectedErrors++;
      else report.consoleErrors.push(event.text()); });
    await page.goto(base + '/index.html'); await ready(page); return state;
  }
  async function capture(page, name) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      const file = name + '-' + width + '.png'; await page.screenshot({ path: path.join(output, file), fullPage: true }); report.visual.push({ name, width, file });
    }
  }
  async function switchAccount(device, account) {
    const { page, name } = device;
    await page.goto(base + '/index.html'); await ready(page); await openAccount(page);
    const previous = await page.evaluate(() => __homeInstance);
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await page.waitForFunction(previous => window.__homeInstance && __homeInstance !== previous, previous);
    await page.locator('[data-life-return-login]').waitFor(); assert.equal(await page.locator('#lifeApp').isHidden(), true);
    server.oauthAccounts.set(name, account);
    await page.locator('[data-life-return-login]').click(); await page.locator('#googleLogin').click();
    await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page);
    assert.equal(await page.evaluate(() => HaedoLife.Shell.storage.account.userId), account.id);
  }
  async function deletedUI(page, fixture, name, makeFresh = false) {
    await enter(page, fixture.planId); await page.locator('#mwDeletedCopy').waitFor();
    assert.equal(await page.locator('#mwDeletedCopy').count(), 1); assert.equal(await page.locator('#mwContinue').count(), 0);
    assert.match(await page.locator('.mw-output').innerText(), /글을 삭제했습니다/);
    await page.waitForFunction(() => document.querySelector('.mw-output-tools')?.dataset.state === 'deleted');
    assert.equal(await page.locator('#mwManageOutput').isVisible(), false); assert.equal(await page.locator('#mwPreserveOutput').isVisible(), false);
    assert.equal(await page.locator('#mwQuestion').inputValue(), fixture.original.question); await capture(page, name);
    if (!makeFresh) return;
    await page.locator('#mwDeletedCopy').click(); await page.waitForFunction(id => document.querySelector('#mwPlanSelect')?.value !== id, fixture.planId);
    await page.locator('.mw-status[data-state="saved"]').waitFor();
    const selected = await page.locator('#mwPlanSelect').inputValue(), rows = await allPlans(page), fresh = rows.find(row => row.plan.id === selected);
    assert.equal(fresh.plan.output, null); assert.deepEqual(copyContent(fresh.plan), copyContent(fixture.original));
    assert.equal(rows.find(row => row.plan.id === fixture.planId).output.status, 'deleted'); assert.equal(await postCount(page, fixture.postId), 0);
    await page.locator('#mwPreview').click(); await page.locator('#mwConsent').waitFor();
    assert.match(await page.locator('#mwPreviewContent').innerText(), /직접 쓴 나의 생각/); await capture(page, name + '-fresh');
  }
  async function check(name, run) { if (only && only !== name) return; console.log('START ' + name); await run(); report.checks.push(name); console.log('PASS ' + name); }
  try {
    await check('fresh-device', async () => {
      const a = await device('c3-fresh-a'), fixture = await createOutput(a.page, '새 기기에 도착할 삭제된 글의 준비');
      assert(server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: fixture.remotePostId }));
      await openOutput(a.page, fixture); await deleteOpenOutput(a.page); await syncPosts(a.page); await syncDocuments(a.page);
      assert.equal(server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: fixture.remotePostId }), null);
      const b = await device('c3-fresh-b'); assert.equal(await postCount(b.page, fixture.postId), 0);
      await receive(b.page, fixture); await deletedUI(b.page, fixture, 'fresh-device-deleted', true);
      await syncDocuments(b.page); await syncMaterials(b.page); await syncPosts(b.page);
      assert.equal(server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: fixture.remotePostId }), null);
      const row = server.rpc(accounts.a.id, 'life_material_get', { p_id: fixture.remotePlanId }); assert.equal(row.data.output.postId, fixture.remotePostId);
      assert.equal(server.blogRequests.some(request => /^life_blog_publish/.test(request.rpc)), false, 'Account synchronization is never publication');
      for (const context of [a.context, b.context]) await context.close();
    });
    await check('offline-reconnect', async () => {
      const a = await device('c3-offline-a'), fixture = await createOutput(a.page, '오프라인 삭제 뒤에도 남길 준비');
      await openOutput(a.page, fixture);
      const writesBefore = server.blogRequests.filter(request => request.rpc === 'life_blog_delete').length, documentsBefore = server.documentCalls.filter(request => request.rpc === 'life_account_document_put').length;
      a.offline = true; server.offlineDevices.add(a.name); await a.context.setOffline(true); assert.equal(await a.page.evaluate(() => navigator.onLine), false);
      await deleteOpenOutput(a.page); assert.equal(await postCount(a.page, fixture.postId), 0);
      assert.equal((await allPlans(a.page)).find(row => row.plan.id === fixture.planId).output.status, 'deleted');
      assert.equal(server.blogRequests.filter(request => request.rpc === 'life_blog_delete').length, writesBefore);
      assert.equal(server.documentCalls.filter(request => request.rpc === 'life_account_document_put').length, documentsBefore);
      assert(server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: fixture.remotePostId }), 'Offline deletion has not reached the server');
      server.offlineDevices.delete(a.name); await a.context.setOffline(false); await syncPosts(a.page); await syncDocuments(a.page);
      a.offline = false; assert.equal(server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: fixture.remotePostId }), null);
      const b = await device('c3-offline-fresh-b'); await receive(b.page, fixture); await deletedUI(b.page, fixture, 'offline-deleted');
      for (const context of [a.context, b.context]) await context.close();
    });
    await check('writing-marker', async () => {
      const a = await device('c3-writing-a'), fixture = await createOutput(a.page, '삭제한 초안의 준비도 다른 기기에 남기기', false);
      const before = server.rpc(accounts.a.id, 'life_material_get', { p_id: fixture.remotePlanId }); assert.equal(before.data.output.state, 'writing');
      await removeOutput(a.page, fixture); await syncDocuments(a.page); await a.context.close();
      assert.equal(server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: fixture.remotePostId }), null);
      const b = await device('c3-writing-b'); await receive(b.page, fixture);
      await deletedUI(b.page, fixture, 'writing-deleted');
      const markers = await readMarkers(b.page);
      assert(markers.some(row => row.value?.planId === fixture.planId && row.value?.postId === fixture.remotePostId), 'A writing claim has no saved-post fallback: the actual account marker must arrive');
      assert.equal(server.rpc(accounts.a.id, 'life_material_get', { p_id: fixture.remotePlanId }).data.output.state, 'writing');
      await b.context.close();
    });
    await check('late-marker', async () => {
      const a = await device('c3-late-a'), fixture = await createOutput(a.page, '늦은 삭제 표지 뒤 자동 반영할 준비', false);
      await removeOutput(a.page, fixture); await syncDocuments(a.page); await a.context.close();
      const documents = server.holdResponse('document', (entry, response) => entry.device === 'c3-late-b' && entry.rpc === 'life_account_document_changes' &&
        Array.isArray(response) && response.some(row => row.doc_key.startsWith('materialOutputDeleted:') && row.data?.postId === fixture.remotePostId));
      pendingGates.push(documents);
      const b = await device('c3-late-b'); await receiveWorkspace(b.page, fixture); await syncMaterials(b.page); await gateArrived(documents);
      const before = (await allPlans(b.page)).find(row => row.plan.id === fixture.planId);
      assert(before, 'The writing preparation arrives before its separately synced deletion receipt');
      assert.notEqual(before.output.status, 'deleted');
      assert.equal((await readMarkers(b.page)).some(row => row.value?.planId === fixture.planId), false);
      documents.release();
      // No manual refreshMaterials or timer jump: applying the real account row
      // must update the already received exact preparation automatically.
      await awaitCondition(b.page, async ({ ws, id }) => (await HaedoLife.Shell.storage.readMaterialWritingOutput(ws, id)).status === 'deleted',
        { ws: fixture.workspaceId, id: fixture.planId }, { timeout: 15000, label: 'late account deletion receipt updates its exact preparation' });
      await deletedUI(b.page, fixture, 'late-marker-deleted'); assert.equal(await postCount(b.page, fixture.postId), 0);
      await b.context.close();
    });
    await check('post-before-preparation', async () => {
      const a = await device('c3-post-first-a'), fixture = await createOutput(a.page, '글만 먼저 받은 기기가 삭제한 준비');
      await a.context.close();
      const materials = server.pauseMaterials('c3-post-first-b'); pendingGates.push(materials);
      const b = await device('c3-post-first-b'); await receiveWorkspace(b.page, fixture); await syncPosts(b.page); await syncDocuments(b.page);
      assert.equal((await allPlans(b.page)).some(row => row.plan.id === fixture.planId), false);
      const received = await receivedPost(b.page, fixture.remotePostId); assert(received, 'B must really receive the post before receiving its preparation');
      await removeOutput(b.page, received); await syncDocuments(b.page);
      assert.equal(server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: fixture.remotePostId }), null);
      assert.equal((await readMarkers(b.page)).some(row => row.value?.postId === received.postId || row.value?.planId === fixture.planId), false, 'No preparation link exists yet, so the ordinary deletion creates no material orphan');
      assert.equal(server.rpc(accounts.a.id, 'life_account_document_changes', { p_after_seq: 0, p_limit: 500 }).some(row => row.data?.planId === fixture.planId), false);
      materials.release(); await syncMaterials(b.page);
      await receive(b.page, fixture); await deletedUI(b.page, fixture, 'post-before-preparation-deleted');
      assert((await readMarkers(b.page)).some(row => row.value?.workspaceId === fixture.workspaceId && row.value?.planId === fixture.planId && row.value?.postId === fixture.remotePostId), 'The validated saved descriptor and successful null read commit an exact deletion receipt with the preparation');
      await b.context.close();
    });
    await check('account-boundary', async () => {
      const a = await device('c3-account-a'), fixture = await createOutput(a.page, '다른 계정에는 없는 삭제 준비');
      await openOutput(a.page, fixture); await deleteOpenOutput(a.page); await syncPosts(a.page); await syncDocuments(a.page);
      const b = await device('c3-account-b'); await receive(b.page, fixture); const before = await readMarkers(b.page); assert(before.length > 0);
      await switchAccount(b, accounts.b); await syncDocuments(b.page); await syncMaterials(b.page);
      assert.equal((await allPlans(b.page)).some(row => row.plan.id === fixture.planId), false); assert.deepEqual(await readMarkers(b.page), []);
      assert.deepEqual(server.rpc(accounts.b.id, 'life_account_document_changes', { p_after_seq: 0, p_limit: 500 }).filter(row => row.doc_key.startsWith('materialOutputDeleted:')), []);
      assert.equal(server.rpc(accounts.b.id, 'life_material_get', { p_id: fixture.remotePlanId }), null);
      await switchAccount(b, accounts.a);
      await receive(b.page, fixture); await deletedUI(b.page, fixture, 'account-return-deleted');
      assert.equal(server.documentCalls.some(request => request.owner === accounts.b.id && request.rpc === 'life_account_document_put' && request.body.p_data?.postId === fixture.remotePostId), false);
      for (const context of [a.context, b.context]) await context.close();
    });
    await check('unrelated-deletion', async () => {
      const a = await device('c3-unrelated', accounts.b), before = await readMarkers(a.page);
      const fixture = await a.page.evaluate(async () => {
        const s = HaedoLife.Shell.storage, ws = await s.getActive(), post = HaedoLife.PhotoPost.create(HaedoLife.Core.id);
        post.title = '준비와 관계없는 일반 글'; post.status = 'saved'; post.ops = [{ insert: '삭제 표지를 남길 필요 없는 익명 글\n' }];
        await s.savePhotoPost(ws, post, 0); return { workspaceId: ws, postId: post.id };
      });
      await syncPosts(a.page); await openOutput(a.page, fixture); await deleteOpenOutput(a.page); await syncPosts(a.page); await syncDocuments(a.page);
      assert.deepEqual(await readMarkers(a.page), before, 'An unrelated post deletion must not create an orphan material-output marker');
      assert.equal(server.rpc(accounts.b.id, 'life_account_document_changes', { p_after_seq: 0, p_limit: 500 }).some(row => row.data?.postId === fixture.postId), false);
      await a.context.close();
    });
    await check('first-sync-deleted-local', async () => {
      const a = await device('c3-unsynced-a');
      a.offline = true; server.offlineDevices.add(a.name); await a.context.setOffline(true);
      const source = await seedMaterials(a.page), planId = await seedPlan(a.page, source, '첫 연결 전에 글을 지운 준비');
      const created = await a.page.evaluate(async ({ workspaceId, planId }) => {
        const storage = HaedoLife.Shell.storage, state = await storage.readMaterialWriting(workspaceId);
        const created = await storage.createMaterialWritingPost(workspaceId, planId, state.revision);
        const post = await storage.readPhotoPost(workspaceId, created.postId); post.status = 'saved';
        await storage.savePhotoPost(workspaceId, post, post.revision); return created;
      }, { workspaceId: source.workspaceId, planId });
      const fixture = { ...source, planId, postId: created.postId, original: (await allPlans(a.page)).find(row => row.plan.id === planId).plan };
      await removeOutput(a.page, fixture);
      assert.equal((await allPlans(a.page)).find(row => row.plan.id === planId).output.status, 'deleted');
      server.offlineDevices.delete(a.name); await a.context.setOffline(false); await syncPosts(a.page); await syncDocuments(a.page); await syncMaterials(a.page); a.offline = false;
      const retained = (await allPlans(a.page)).find(row => row.plan.id === planId); assert.deepEqual(retained.plan, fixture.original);
      assert.equal(server.materialRequests.some(request => request.rpc === 'life_material_put' && request.body.p_data?.plan?.id === planId), false, 'An unsent deleted output must never be exported as output:null');
      await enter(a.page, planId); await a.page.locator('#mwDeletedCopy').waitFor();
      assert.match(await a.page.locator('.mw-output').innerText(), /이 기기에만/);
      assert.match(await a.page.locator('.mw-output').innerText(), /다른 기기로 보내려면 새 준비 사본/);
      await capture(a.page, 'first-sync-deleted-local');
      await a.page.reload(); await ready(a.page); await enter(a.page, planId); await a.page.locator('#mwDeletedCopy').waitFor();
      assert.match(await a.page.locator('.mw-output').innerText(), /이 기기에만/);
      assert.deepEqual((await allPlans(a.page)).find(row => row.plan.id === planId).plan, fixture.original);
      assert.equal(await postCount(a.page, fixture.postId), 0);
      assert.equal(server.materialRequests.some(request => request.rpc === 'life_material_put' && request.body.p_data?.plan?.id === planId), false);
      // Delay only the real storage getter used by the real UI factory. Its
      // result is never changed; this controls the completion order that a
      // slower device can encounter when the selected preparation changes.
      await a.page.goto(base + '/index.html?section=records&view=page'); await ready(a.page);
      const otherId = await a.page.evaluate(async ({ workspaceId, planId }) => {
        const storage = HaedoLife.Shell.storage, state = await storage.readMaterialWriting(workspaceId), other = HaedoLife.MaterialWriting.create(HaedoLife.Core.id);
        other.title = '늦은 응답이 바꾸면 안 되는 다른 준비'; state.plans.push(other); await storage.saveMaterialWriting(workspaceId, state, state.revision);
        const actual = HaedoLife.MaterialWritingUI;
        window.__c3DelayedLookup = { planId, used: false, entered: false };
        HaedoLife.MaterialWritingUI = { ...actual, create(options) {
          const delegate = options.storage;
          return actual.create({ ...options, storage: { ...delegate, async readMaterialContinuityState(...args) {
            const result = await delegate.readMaterialContinuityState(...args), gate = window.__c3DelayedLookup;
            if (!gate.used && args[1] === gate.planId && document.querySelector('#mwPlanSelect')?.value === gate.planId) {
              gate.used = true; gate.target = document.querySelector('.mw-output'); gate.entered = true;
              await new Promise(resolve => { gate.release = resolve; });
            }
            return result;
          } } });
        } };
        return other.id;
      }, { workspaceId: fixture.workspaceId, planId });
      await a.page.locator('#wbPageMaterialWriting').click(); await a.page.locator('#mwNew').waitFor();
      await a.page.locator('#mwPlanSelect').selectOption(planId); await a.page.waitForFunction(() => __c3DelayedLookup.entered);
      await a.page.locator('#mwPlanSelect').selectOption(otherId);
      await a.page.waitForFunction(id => document.querySelector('#mwPlanSelect')?.value === id && document.querySelector('#mwTitle')?.value === '늦은 응답이 바꾸면 안 되는 다른 준비', otherId);
      const oldMarkup = await a.page.evaluate(() => __c3DelayedLookup.target.innerHTML);
      await a.page.evaluate(async () => { __c3DelayedLookup.release(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      assert.equal(await a.page.locator('#mwPlanSelect').inputValue(), otherId);
      assert.equal(await a.page.locator('#mwDeletedCopy').count(), 0, 'A late deleted-output lookup must not add controls to the newly selected preparation');
      assert.equal(await a.page.evaluate(() => __c3DelayedLookup.target.innerHTML), oldMarkup, 'The stale output target must not be rewritten after the real lookup completes');
      await a.context.close();
    });
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } catch (error) { report.pass = false; report.error = error.stack; throw error; }
  finally {
    for (const gate of pendingGates) gate.release();
    for (const context of contexts) await context.close().catch(() => {}); await browser.close();
    report.rpcCounts = { material: server.materialRequests.length, blog: server.blogRequests.length, accountDocument: server.documentCalls.length };
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ pass: report.pass, checks: report.checks, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, expectedErrors: report.expectedErrors, output }));
}
module.exports = { DeletedMarkerCloud, main };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

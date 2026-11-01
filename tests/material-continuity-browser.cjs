'use strict';
/* Automatic preparation sync between two devices of one account: every
 * preparation, its exact selected versions and private inputs arrive in the same
 * workspace and preparation ID; latest edit wins with a recovery copy; deletions
 * propagate unless the other device holds unsent edits. Actual UI/SDK/IndexedDB
 * and isolated SQL; synthetic Auth and Storage/Edge binary transport only. */
process.env.BASE_URL ||= 'http://127.0.0.1:4215';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { LocalSQLMaterialCloud } = require('./material-continuity-sql-fixture.cjs');
const { digest } = require('./blog-completion-browser.cjs');
const { playwright, makeContext, ready, settle, nav } = require('./unified-home-browser.cjs');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { seedMaterials, seedPlan, enter, saved, snapshot } = require('./material-writing-browser.cjs');
const ZIP = require('../vendor/fflate/fflate.js');
const output = path.resolve(__dirname, '../.local/material-continuity');
const migration = 'supabase/migrations/20261019005829_life_material_continuity.sql';
async function seedContinuity(page, title = '기기 사이에서 이어 완성할 여행글') {
  const source = await seedMaterials(page), planId = await seedPlan(page, source, title);
  await page.evaluate(async ({ source, planId }) => {
    const s = HaedoLife.Shell.storage, C = HaedoLife.Core, M = HaedoLife.MaterialWriting, ws = source.workspaceId;
    const state = await s.readMaterialWriting(ws), plan = state.plans.find(p => p.id === planId), bundle = await s.read(ws);
    const link = M.material(bundle, source.link.sourceId, source.link.versionId, C.id); link.note = 'PRIVATE_LINK_NOTE_NOT_ADOPTED'; plan.materials.push(link);
    const other = M.create(C.id); other.title = 'UNSELECTED_PREPARATION_SENTINEL'; other.question = 'UNSELECTED_QUESTION_SENTINEL'; other.blocks.push({ id: C.id(), kind: 'paragraph', text: 'UNSELECTED_PRIVATE_BODY_SENTINEL' }); state.plans.push(other);
    await s.saveMaterialWriting(ws, state, state.revision);
  }, { source, planId });
  return { ...source, planId };
}
async function panel(page) {
  await page.locator('#mcPanel').waitFor(); if (!await page.locator('#mcPanel').evaluate(n => n.open)) await page.locator('#mcPanel > summary').click();
}
async function invoke(page, method, args = []) {
  return page.evaluate(async ({ method, args }) => {
    const storage = HaedoLife.Shell.storage;
    if (!window.__mcManager || window.__mcManagerStorage !== storage) {
      window.__mcManager?.dispose(); window.__mcManagerStorage = storage;
      window.__mcManager = HaedoLife.MaterialContinuitySync.create({ storage, auth: HaedoAuth });
    }
    try { return { ok: true, value: await __mcManager[method](...args) }; }
    catch (error) { return { ok: false, code: error.code, message: error.message }; }
  }, { method, args });
}
async function call(page, method, args = []) { const result = await invoke(page, method, args); assert.equal(result.ok, true, method + ': ' + result.code + ' ' + result.message); return result.value; }
async function reviewFingerprint(page, ws, id) {
  const result = await call(page, 'preview', [ws, id]); assert.match(result.fingerprint, /^[a-f0-9]{64}$/); return result.fingerprint;
}
async function connect(page, ws, id) { return call(page, 'connect', [ws, id, await reviewFingerprint(page, ws, id)]); }
// One pass of the background preparation loop (the same pass its 60 s / focus / online timer runs).
async function syncMaterials(page) {
  await page.evaluate(async () => { await HaedoLife.Shell.writingSync.refreshMaterials(); });
  await page.waitForFunction(() => !document.querySelector('#mcPanel[aria-busy="true"]'));
}
// Originals sync first (legacy capability-0 server): A uploads, B receives the same workspace ID.
async function shareWorkspace(a, b, ws) {
  await a.evaluate(async ws => { await HaedoLife.Shell.sync.enable(ws); await HaedoLife.Shell.sync.syncNow(ws); }, ws);
  await b.evaluate(async ws => { if (!(await HaedoLife.Shell.storage.listWorkspaces()).some(row => row.workspaceId === ws)) await HaedoLife.Shell.sync.download(ws, { activate: false }); await HaedoLife.Shell.sync.syncNow(ws); await HaedoLife.Shell.storage.setActive(ws); }, ws);
}
async function plans(page, ws) { return page.evaluate(async ws => (await HaedoLife.Shell.storage.readMaterialWriting(ws)).plans, ws); }
async function deletePreparation(page, ws, id) {
  return page.evaluate(async ({ ws, id }) => { const s = HaedoLife.Shell.storage, state = await s.readMaterialWriting(ws); state.plans = state.plans.filter(plan => plan.id !== id); await s.saveMaterialWriting(ws, state, state.revision); }, { ws, id });
}
const REMOVED = ['#mcReview', '#mcConsent', '#mcConnect', '#mcList', '#mcReceive', '#mcPause', '#mcCompare', '#mcResolveLocal', '#mcResolveRemote', '#mcOutputReview', '#mcShareOutput'];
async function selected(page) { return page.evaluate(async () => ({ workspaceId: await HaedoLife.Shell.storage.getActive(), planId: document.querySelector('#mwPlanSelect')?.value })); }
async function rawState(page) {
  return page.evaluate(async () => {
    const raw = await new Promise((resolve, reject) => {
      const request = indexedDB.open('life-tools-v1'); request.onerror = () => reject(request.error); request.onsuccess = () => {
        const db = request.result, names = [...db.objectStoreNames], tx = db.transaction(names, 'readonly'), result = {};
        for (const name of names) { const get = tx.objectStore(name).getAll(); get.onsuccess = () => { result[name] = get.result; }; }
        tx.oncomplete = () => { db.close(); resolve(result); }; tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || Error('raw fixture read aborted')); };
      };
    });
    async function portable(value) {
      if (value instanceof Blob) return { type: value.type, size: value.size, sha256: await HaedoLife.PhotoPost.digest(value) };
      if (Array.isArray(value)) return Promise.all(value.map(portable));
      if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, v]) => [key, await portable(v)])));
      return value;
    }
    return portable(raw);
  });
}
async function editPreparation(page, ws, id, title) {
  return page.evaluate(async ({ ws, id, title }) => { const s = HaedoLife.Shell.storage, state = await s.readMaterialWriting(ws), plan = state.plans.find(p => p.id === id); plan.title = title; plan.question = title + ' · 비공개 질문'; plan.updatedAt = new Date().toISOString(); await s.saveMaterialWriting(ws, state, state.revision); }, { ws, id, title });
}
async function allPlans(page) {
  return page.evaluate(async () => {
    const s=HaedoLife.Shell.storage, rows=[];
    for(const ws of await s.listWorkspaces()) { const preparation=await s.readMaterialWriting(ws.workspaceId),bundle=await s.read(ws.workspaceId);
      for(const plan of preparation.plans) { for(const block of plan.blocks)if(block.kind==='quote')await HaedoLife.SourceReference.resolve(bundle,block.reference); rows.push({workspaceId:ws.workspaceId,plan,continuity:await s.readMaterialContinuityState(ws.workspaceId,plan.id)}); }
    } return rows;
  });
}
async function arrived(gate,pending) {
  let timer;
  try { return await Promise.race([gate.arrived,pending.then(result=>{throw Error('The real request completed before the expected response gate: '+JSON.stringify(result));}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The real request did not reach its response gate')),20000);})]); }
  finally { clearTimeout(timer); }
}
async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)); await fs.mkdir(output, { recursive: true });
  const server = new LocalSQLMaterialCloud({ container: process.env.BLOG_POSTGRES_CONTAINER, database: process.env.BLOG_POSTGRES_DATABASE });
  if (process.argv.includes('--prepare-database')) await server.prepare(migration); await server.initialize();
  const report = { checks: [], visual: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, sourceLoads: [],migrationSha256:server.installedMigrationSha256||null,
    scope: 'Actual local UI/SDK/IndexedDB and PostgreSQL RPC/RLS. Synthetic Auth/Storage bytes/Edge only. No production accounts, real OAuth, Apple hardware or deployment.' };
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] }); report.browser = browser.version();
  const contexts = []; let page;
  async function device(name, account = accounts.a) {
    const context = await makeContext(browser, server, name, account, { viewport: { width: 1440, height: 1000 } }); contexts.push(context);
    context.on('page', p => { p.setDefaultTimeout(20000); p.on('pageerror', e => report.pageErrors.push(e.message)); p.on('console', e => {
      if (e.type() !== 'error') return;
      const expectedTransport=e.location().url.startsWith(cloud)&&/Failed to load resource:.*(?:503|ERR_FAILED)/.test(e.text());
      const revokedMedia=e.location().url.startsWith(cloud+'/functions/v1/haedo-blog-media')&&/Failed to load resource:.*404/.test(e.text());
      if(expectedTransport||revokedMedia)report.expectedErrors++;else report.consoleErrors.push(e.text());
    }); });
    await context.route(/\/assets\/life\/(?:material-continuity(?:-sync|-remote|-ui)?|material-writing-ui|storage|workbench-ui)\.js$/, async route => {
      const response = await route.fetch(), bytes = await response.body(); report.sourceLoads.push({ device: name, path: new URL(route.request().url()).pathname, sha256: digest(bytes) }); await route.fulfill({ response, body: bytes });
    });
    await context.route('**/*', route => { const origin = new URL(route.request().url()).origin; if ([new URL(base).origin, cloud].includes(origin)) return route.fallback(); report.external.push(origin); return route.abort(); });
    const p = await context.newPage(); if(account!==null){await p.goto(base + '/index.html'); await ready(p);} return { name, page: p, context };
  }
  async function capture(p, scene) { for (const width of [1440, 390]) { await p.setViewportSize({ width, height: 1000 }); await p.evaluate(() => document.fonts.ready); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false); const file = scene + '-' + width + '.png'; await p.screenshot({ path: path.join(output, file), fullPage: true }); report.visual.push({ scene, width, file }); } await p.setViewportSize({ width: 1440, height: 1000 }); }
  async function check(name, run) { console.log('START ' + name); await run(); report.checks.push(name); console.log('PASS ' + name); }
  const row = id => server.rpc(accounts.a.id, 'life_material_get', { p_id: id });
  try {
    const a = await device('continuity-a'), b = await device('continuity-b'); page = a.page;
    const f = await seedContinuity(a.page); let remoteId, otherId, otherRemoteId;
    await check('Every preparation with its exact selected versions and private inputs reaches B automatically in the same workspace and preparation ID', async () => {
      await shareWorkspace(a.page, b.page, f.workspaceId); await syncMaterials(a.page);
      const local = await plans(a.page, f.workspaceId); otherId = local.find(plan => plan.title === 'UNSELECTED_PREPARATION_SENTINEL').id;
      const stateA = await call(a.page, 'getState', [f.workspaceId, f.planId]); remoteId = stateA.remoteId; assert.equal(stateA.status, 'synced');
      otherRemoteId = (await call(a.page, 'getState', [f.workspaceId, otherId])).remoteId; assert.ok(otherRemoteId, 'every preparation is linked without a toggle');
      const remote = row(remoteId); assert.equal(remote.data.output, null); assert.equal(remote.data.plan.output, null);
      assert.equal(remote.data.plan.materials.length, 3); assert.equal(remote.data.bundle.sourceVersions.length, 3); assert(!JSON.stringify(remote.data).includes('LATEST_MUST_NOT_REPLACE_OLD'));
      await syncMaterials(b.page);
      const received = await plans(b.page, f.workspaceId), plan = received.find(value => value.id === f.planId);
      assert.ok(plan, 'same preparation ID'); assert.ok(received.some(value => value.id === otherId));
      assert.equal((await b.page.evaluate(() => HaedoLife.Shell.storage.listWorkspaces())).filter(row => row.workspaceId === f.workspaceId).length, 1, 'no new independent workspace');
      assert.equal(plan.question, 'PRIVATE_QUESTION_SENTINEL'); assert.equal(plan.materials.filter(m => m.note === 'PRIVATE_NOTE_SENTINEL').length, 2); assert(plan.materials.some(m => m.note === 'PRIVATE_LINK_NOTE_NOT_ADOPTED'));
      const bundle = await b.page.evaluate(ws => HaedoLife.Shell.storage.read(ws), f.workspaceId);
      for (const source of [f.first, f.second]) assert(bundle.sourceVersions.some(v => v.contentText === source.raw && v.contentHash === digest(Buffer.from(source.raw))));
      for (const material of plan.materials) assert(bundle.sourceVersions.some(v => v.id === material.sourceVersionId && v.contentHash === material.contentHash), 'exact version, never the latest');
      assert.equal((await call(b.page, 'getState', [f.workspaceId, f.planId])).changed, false);
      await syncMaterials(b.page); assert.equal((await plans(b.page, f.workspaceId)).length, received.length, 'a repeated pass installs nothing twice');
      await enter(b.page, f.planId); await panel(b.page); await b.page.locator('#mcStatus[data-state="synced"]').waitFor();
      for (const selector of REMOVED) assert.equal(await b.page.locator(selector).count(), 0, selector);
      assert.doesNotMatch(await b.page.locator('#mcPanel').innerText(), /다른 기기에서 이어쓰기|이 준비 받기|이 기기 준비로 이어쓰기/);
      assert.equal(server.blogRequests.filter(r => r.rpc === 'life_blog_save').length, 0); await capture(b.page, 'received-private-preparation');
    });
    await check('A change on A appears on B; edits on both keep the newest one and the other as a recovery copy with a notice that survives reload', async () => {
      await editPreparation(a.page, f.workspaceId, f.planId, 'A에서 고친 제목'); await syncMaterials(a.page); await syncMaterials(b.page);
      assert.equal((await plans(b.page, f.workspaceId)).find(p => p.id === f.planId).title, 'A에서 고친 제목');
      await editPreparation(a.page, f.workspaceId, f.planId, 'A의 더 오래된 수정'); await b.page.waitForTimeout(20);
      await editPreparation(b.page, f.workspaceId, f.planId, 'B의 더 최근 수정');
      await syncMaterials(a.page); assert.equal(row(remoteId).data.plan.title, 'A의 더 오래된 수정');
      await syncMaterials(b.page);
      assert.equal((await plans(b.page, f.workspaceId)).find(p => p.id === f.planId).title, 'B의 더 최근 수정'); assert.equal(row(remoteId).data.plan.title, 'B의 더 최근 수정');
      const recoveries = await b.page.evaluate(async () => { const s = HaedoLife.Shell.storage, rows = [];
        for (const library of await s.listAccountLibraries()) if (!library.eligible) rows.push(...(await s.readMaterialWriting(library.workspaceId)).plans.map(plan => plan.title)); return rows; });
      assert.ok(recoveries.includes('A의 더 오래된 수정'), 'the older side is kept in a private recovery copy');
      await b.page.reload(); await ready(b.page); await enter(b.page, f.planId); await panel(b.page);
      assert.match(await b.page.locator('#mcPanel').innerText(), /다른 기기 변경을 반영했고 이전 내용은 복구 목록에 있습니다/); await capture(b.page, 'latest-wins-notice');
      await b.page.locator('#mcNoticeDone').click(); await b.page.waitForFunction(() => !/복구 목록에 있습니다/.test(document.querySelector('#mcPanel')?.innerText || ''));
      await syncMaterials(a.page); assert.equal((await plans(a.page, f.workspaceId)).find(p => p.id === f.planId).title, 'B의 더 최근 수정');
    });
    await check('An open editor with unsaved Korean input is never replaced by a change from the other device', async () => {
      await enter(b.page, f.planId); const current = (await plans(b.page, f.workspaceId)).find(p => p.id === f.planId).title;
      // The editor may finish its first render after the selection; select again until it shows this preparation.
      for (let attempt = 0; ; attempt++) {
        try { await b.page.waitForFunction(({ id, current }) => document.querySelector('#mwPlanSelect')?.value === id && document.querySelector('#mwTitle')?.value === current, { id: f.planId, current }, { timeout: 3000 }); break; }
        catch (error) { if (attempt === 4) throw error; await b.page.locator('#mwPlanSelect').selectOption(f.planId); }
      }
      const title = b.page.locator('#mwTitle');
      await title.focus(); await title.evaluate(node => { window.__mcTitleNode = node; node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'ㅎ' })); node.value += ' 한글 입력 중'; node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: '한글 입력 중' })); });
      const typed = await title.inputValue();
      await editPreparation(a.page, f.workspaceId, f.planId, 'B가 입력하는 동안 A가 바꾼 제목'); await syncMaterials(a.page); await syncMaterials(b.page);
      assert.equal(await title.inputValue(), typed); assert.equal(await title.evaluate(node => node === window.__mcTitleNode), true);
      assert.notEqual((await plans(b.page, f.workspaceId)).find(p => p.id === f.planId).title, 'B가 입력하는 동안 A가 바꾼 제목', 'the busy workspace is skipped');
      await title.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '한글 입력 중' }))); await saved(b.page);
      await syncMaterials(b.page);
      assert.equal((await plans(b.page, f.workspaceId)).find(p => p.id === f.planId).title, typed, 'the newer local edit wins after input settles');
    });
    await check('Deleting a preparation on A removes an unchanged copy on B; an edit B made before hearing of it recreates it everywhere', async () => {
      await syncMaterials(a.page); await syncMaterials(b.page);
      await deletePreparation(a.page, f.workspaceId, f.planId); await syncMaterials(a.page);
      assert.equal(row(remoteId).deleted, true); assert.equal(server.rpc(accounts.a.id, 'life_material_list', {}).items.some(item => item.id === remoteId), false);
      await syncMaterials(b.page); assert.equal((await plans(b.page, f.workspaceId)).some(p => p.id === f.planId), false);
      const bundle = await b.page.evaluate(ws => HaedoLife.Shell.storage.read(ws), f.workspaceId); assert.equal(bundle.sourceVersions.length >= 3, true, 'sources stay');
      await editPreparation(b.page, f.workspaceId, otherId, 'B가 삭제 소식 전에 고친 준비');
      await deletePreparation(a.page, f.workspaceId, otherId); await syncMaterials(a.page); assert.equal(row(otherRemoteId).deleted, true);
      await syncMaterials(b.page);
      const kept = (await plans(b.page, f.workspaceId)).find(p => p.id === otherId); assert.equal(kept?.title, 'B가 삭제 소식 전에 고친 준비');
      const relinked = (await call(b.page, 'getState', [f.workspaceId, otherId])).remoteId; assert.notEqual(relinked, otherRemoteId); assert.equal(row(relinked).data.plan.title, 'B가 삭제 소식 전에 고친 준비');
      await syncMaterials(a.page); assert.equal((await plans(a.page, f.workspaceId)).find(p => p.id === otherId)?.title, 'B가 삭제 소식 전에 고친 준비');
    });
    await check('Foreign and anonymous reads or deletes reveal and change no private preparation', async () => {
      const live = (await call(a.page, 'getState', [f.workspaceId, otherId])).remoteId;
      assert.equal(server.rpc(accounts.b.id, 'life_material_get', { p_id: live }), null);
      assert.equal(server.rpc(accounts.b.id, 'life_material_list', {}).items.length, 0);
      assert.throws(() => server.rpc(null, 'life_material_get', { p_id: live }));
      assert.equal(server.rpc(accounts.b.id, 'life_material_delete', { p_id: live, p_operation_id: randomUUID(), p_expected_revision: row(live).revision }).status, 'missing');
      assert.equal(row(live).deleted, undefined);
    });
    assert.deepEqual(report.consoleErrors,[]); assert.deepEqual(report.pageErrors,[]); assert.deepEqual(report.external,[]); report.pass=true;
  } catch(error) {
    report.pass=false;report.error=error.stack;
    report.failureContexts=[];
    for(const context of contexts)for(const current of context.pages()) {
      const detail={url:current.url()};
      try { detail.dom=await current.locator('body').innerText({timeout:2000}); detail.local=await current.evaluate(async()=>{const s=HaedoLife?.Shell?.storage,ws=await s?.getActive(),planId=document.querySelector('#mwPlanSelect')?.value;return{ws,planId,preparation:ws?await s.readMaterialWriting(ws):null,continuity:ws&&planId?await s.readMaterialContinuityState(ws,planId):null};}); }
      catch(cause){detail.captureError=cause.message;}
      report.failureContexts.push(detail);
    }
    await page?.screenshot({path:path.join(output,'failure-'+Date.now()+'.png'),fullPage:true,timeout:5000}).catch(cause=>{report.screenshotError=cause.message;});throw error;
  }
  finally { server.materialGate?.release();for(const context of contexts)await context.close().catch(()=>{});await browser.close();report.rpcCounts=server.materialRequests.reduce((v,r)=>{v[r.rpc]=(v[r.rpc]||0)+1;return v;},{});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)); }
}
module.exports={seedContinuity,panel,invoke,call,reviewFingerprint,connect,selected,rawState,editPreparation,syncMaterials,shareWorkspace,plans,deletePreparation,output,migration};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});

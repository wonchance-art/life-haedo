'use strict';
/* One private preparation → a second device → the same logical saved output
 * and evidence on the first device. Actual UI/SDK/IndexedDB/isolated SQL;
 * synthetic Auth and Storage/Edge binary transport only. */
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
const migration = 'supabase/migrations/20261018161658_life_material_continuity.sql';
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
async function reviewConnection(page) {
  await panel(page); await page.locator('#mcReview').click(); await page.locator('#mcReviewContent').waitFor();
  const originals=page.locator('#mcReviewContent .mc-originals');if(!await originals.evaluate(n=>n.open))await originals.locator(':scope > summary').click();
  assert.equal(await page.locator('#mcConsent').isChecked(), false); const text = await page.locator('#mcReviewContent').innerText();
  assert(text.includes('PRIVATE_QUESTION_SENTINEL')); assert(text.includes('PRIVATE_NOTE_SENTINEL')); assert(text.includes('PRIVATE_FULL_BODY_NOT_PUBLIC')); await page.locator('#mcConsent').check(); await page.locator('#mcConnect').click();
}
async function uiReceive(page, remoteId) {
  const hadTitle=await page.evaluate(()=>{window.__mcReceiveTitleNode=document.querySelector('#mwTitle');return!!window.__mcReceiveTitleNode;});
  await panel(page); await page.locator('#mcList').click(); const row = page.locator('#mcServerList [data-remote-id="' + remoteId + '"]'); await row.getByRole('button', { name: /내용 확인$/ }).click(); await page.locator('#mcRemoteContent').waitFor(); await page.locator('#mcReceive').click();
  await page.waitForFunction(had=>!(had&&window.__mcReceiveTitleNode?.isConnected)&&!!document.querySelector('#mwPlanSelect')?.value&&!document.querySelector('#mcPanel[aria-busy="true"]')&&!document.querySelector('.life-app[aria-busy="true"]'),hadTitle); await page.locator('#mwTitle').waitFor(); await saved(page); return selected(page);
}
async function editPreparation(page, ws, id, title) {
  return page.evaluate(async ({ ws, id, title }) => { const s = HaedoLife.Shell.storage, state = await s.readMaterialWriting(ws), plan = state.plans.find(p => p.id === id); plan.title = title; plan.question = title + ' · 비공개 질문'; await s.saveMaterialWriting(ws, state, state.revision); }, { ws, id, title });
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
    const f = await seedContinuity(a.page), bOriginal = await rawState(b.page); let remoteId, bLocal, aOutput, writing, savedOutput;
    await check('Only one explicitly reviewed preparation and every selected exact version/private input arrive in a new independent workspace on B', async () => {
      await enter(a.page, f.planId); await reviewConnection(a.page); await a.page.locator('#mcStatus[data-state="synced"]').waitFor();
      const state = await call(a.page, 'getState', [f.workspaceId, f.planId]); remoteId = state.remoteId; const remote = row(remoteId); assert.equal(remote.revision, 1); assert.equal(remote.data.output, null); assert.equal(remote.data.plan.output, null);
      assert.equal(remote.data.plan.materials.length, 3); assert.equal(remote.data.bundle.sources.length, 3); assert.equal(remote.data.bundle.sourceVersions.length, 3); assert(!JSON.stringify(remote.data).includes('UNSELECTED_')); assert(!JSON.stringify(remote.data).includes('LATEST_MUST_NOT_REPLACE_OLD'));
      await enter(b.page); bLocal = await uiReceive(b.page, remoteId); assert.notEqual(bLocal.workspaceId, f.workspaceId);
      const received = await snapshot(b.page, bLocal.workspaceId); assert.equal(received.preparation.plans.length, 1); assert.equal(received.posts.length, 0); assert.equal(received.bundle.sourceVersions.length, 3);
      assert.equal(received.preparation.plans[0].question, 'PRIVATE_QUESTION_SENTINEL'); assert.equal(received.preparation.plans[0].materials.filter(m => m.note === 'PRIVATE_NOTE_SENTINEL').length, 2); assert(received.preparation.plans[0].materials.some(m => m.note === 'PRIVATE_LINK_NOTE_NOT_ADOPTED'));
      for (const source of [f.first, f.second]) assert(received.bundle.sourceVersions.some(v => v.contentText === source.raw && v.contentHash === digest(Buffer.from(source.raw))));
      assert.equal((await call(b.page, 'getState', [bLocal.workspaceId, bLocal.planId])).changed, false, 'ID remapping must preserve the canonical unchanged preparation');
      const repeat = await uiReceive(b.page,remoteId); assert.equal(repeat.workspaceId, bLocal.workspaceId); assert.equal(repeat.planId, bLocal.planId); assert.equal((await snapshot(b.page)).spaces.length, bOriginal.bundles.length + 1);
      assert.equal(server.blogRequests.length, 0); await capture(b.page, 'received-private-preparation');
    });
    await check('A lost remote writing-claim acknowledgement blocks every other device and retries the same durable claim before making one local draft', async () => {
      server.materialFailure = entry => entry.device === b.name && entry.rpc === 'life_material_put' && entry.body.p_data.output?.state === 'writing';
      await b.page.locator('#mwPreview').click(); await b.page.locator('#mwConsent').check(); await b.page.locator('#mwCreate').click(); await b.page.locator('.mw-error:not([hidden])').waitFor();
      writing = row(remoteId); assert.equal(writing.data.output.state, 'writing'); assert.equal((await snapshot(b.page)).posts.length, 0);
      await call(a.page, 'sync', [f.workspaceId, f.planId]); const revA = (await snapshot(a.page, f.workspaceId)).preparation.revision;
      const blocked = await invoke(a.page, 'handoff', [f.workspaceId, f.planId, revA]); assert.equal(blocked.ok, false); assert.equal(blocked.code,'material_output_elsewhere'); assert.equal((await snapshot(a.page, f.workspaceId)).posts.length, 0);
      const bypass = await a.page.evaluate(async ({ ws, id, revision }) => { try { await HaedoLife.Shell.storage.createMaterialWritingPost(ws, id, revision); return 'unexpected_creation'; } catch (error) { return error.code; } }, { ws: f.workspaceId, id: f.planId, revision: revA }); assert.equal(bypass,'material_claim_required');
      await b.page.locator('#mwPreview').click(); await b.page.locator('#mwConsent').check(); await b.page.locator('#mwCreate').click(); await b.page.locator('#photoTitle').waitFor();
      const claims = server.materialRequests.filter(r => r.rpc === 'life_material_put' && r.device === b.name && r.body.p_data.output?.state === 'writing'); assert.equal(claims.length, 2); assert.deepEqual(claims[0].body, claims[1].body); assert.equal(row(remoteId).revision, writing.revision);
      const local = await snapshot(b.page); assert.equal(local.posts.length, 1); assert.equal(local.posts[0].doc.id, writing.data.output.postId); assert.equal(local.posts[0].evidence.refs.length, 2); await capture(b.page, 'claimed-existing-writer');
    });
    await check('B finishes two original photos; upload failure and a lost saved-descriptor reply preserve independent preparation/post revisions and exact retries', async () => {
      await b.page.locator('#photoTitle').fill('B에서 완성한 정확한 근거의 여행글'); await b.page.evaluate(() => { const q = Quill.find(document.querySelector('.ql-container')); q.insertText(q.getLength() - 1, '\nB에서 덧붙인 나의 마지막 문단🌱\n', 'user'); q.setSelection(q.getLength() - 1, 0, 'silent'); });
      const photos = await b.page.evaluate(async () => { const result = []; for (const [width, height] of [[4032,3024],[1200,1800]]) { const c = document.createElement('canvas'); c.width = width; c.height = height; const g = c.getContext('2d'); g.fillStyle = '#d8e4dc'; g.fillRect(0,0,width,height); g.fillStyle = '#183b30'; g.fillRect(20,20,140,200); const blob = await new Promise(r => c.toBlob(r,'image/png')); result.push(Array.from(new Uint8Array(await blob.arrayBuffer()))); } return result; });
      await b.page.locator('#photoFiles').setInputFiles(photos.map((bytes,i) => ({ name: '합성 여행 원본 ' + i + '.png', mimeType: 'image/png', buffer: Buffer.from(bytes) }))); await b.page.locator('.photo-block').nth(1).waitFor(); await b.page.getByRole('button', { name:'글 저장', exact:true }).click(); await b.page.locator('.photo-article').waitFor(); await b.page.getByRole('button', { name:'작성 준비로 돌아가기', exact:true }).click(); await panel(b.page);
      const reviewOutput = async () => { await b.page.locator('#mcOutputReview').click(); await b.page.locator('#mcOutputConsent').waitFor(); assert.equal(await b.page.locator('#mcOutputConsent').isChecked(),false); await b.page.locator('#mcOutputConsent').check(); };
      await reviewOutput(); server.failure = 'upload'; await b.page.locator('#mcShareOutput').click(); await b.page.locator('.mc-error:not([hidden])').waitFor(); assert.equal(row(remoteId).data.output.state,'writing');
      const local = (await snapshot(b.page)).posts[0]; assert.equal(local.doc.photos.length,2); for(const p of local.doc.photos)assert.equal(p.actualHash,p.digest);
      await reviewOutput(); server.materialFailure = entry => entry.rpc === 'life_material_put' && entry.device === b.name && entry.body.p_data.output?.state === 'saved'; await b.page.locator('#mcShareOutput').click(); await b.page.locator('.mc-error:not([hidden])').waitFor();
      savedOutput = row(remoteId); assert.equal(savedOutput.data.output.state,'saved'); assert.equal(savedOutput.data.output.revision,1); assert.equal(savedOutput.data.output.postId,writing.data.output.postId); assert.equal(savedOutput.data.output.refs.length,2); assert.equal(server.rpc(accounts.a.id,'life_blog_read',{p_post_id:savedOutput.data.output.postId}).data.photos.length,2);
      const uploads = server.assetRequests.filter(r=>r.method==='POST').length; await call(b.page,'sync',[bLocal.workspaceId,bLocal.planId]); const replay = server.materialRequests.filter(r=>r.rpc==='life_material_put'&&r.device===b.name&&r.body.p_data.output?.state==='saved'); assert.equal(replay.length,2); assert.deepEqual(replay[0].body,replay[1].body); assert.equal(row(remoteId).revision,savedOutput.revision); assert.equal(server.assetRequests.filter(r=>r.method==='POST').length,uploads);
    });
    await check('A receives the same logical completed post with exact evidence/originals, selectively publishes one photo, withdraws it, and restores the adopted-evidence file', async () => {
      await enter(a.page,f.planId); await uiReceive(a.page,remoteId); await a.page.locator('#mwContinue').waitFor();
      const aState=await snapshot(a.page,f.workspaceId); aOutput=aState.posts.find(p=>p.doc.status==='saved'); assert(aOutput); assert.equal(aOutput.evidence.refs.length,2); assert.equal(aOutput.doc.photos.length,2); const bPost=(await snapshot(b.page,bLocal.workspaceId)).posts[0]; assert.notEqual(aOutput.doc.id,bPost.doc.id);
      for(let i=0;i<2;i++)for(const k of ['digest','actualHash','width','height','actualWidth','actualHeight'])assert.equal(aOutput.doc.photos[i][k],bPost.doc.photos[i][k]);
      for(const ref of aOutput.evidence.refs) { assert.equal(ref.workspaceId,f.workspaceId); await a.page.evaluate(async({ws,ref})=>HaedoLife.SourceReference.resolve(await HaedoLife.Shell.storage.read(ws),ref),{ws:f.workspaceId,ref}); }
      const repeat=await uiReceive(a.page,remoteId); assert.equal(repeat.workspaceId,f.workspaceId); assert.equal(repeat.planId,f.planId); assert.equal((await snapshot(a.page,f.workspaceId)).preparation.plans.find(p=>p.id===f.planId).output.postId,aOutput.doc.id); assert.equal((await snapshot(a.page,f.workspaceId)).posts.length,1);
      await a.page.locator('#mwContinue').click(); await a.page.locator('.photo-article').waitFor(); assert.match(await a.page.locator('.photo-article').innerText(),/B에서 덧붙인 나의 마지막 문단/); await a.page.getByRole('button',{name:'작성 준비로 돌아가기',exact:true}).click();
      await a.page.locator('#mwManageOutput').click(); await a.page.locator('.blog-manager-list[data-state="ready"]').waitFor(); await a.page.locator('.blog-post[data-post-id="'+aOutput.doc.id+'"]').getByRole('button',{name:'공개 내용 검토',exact:true}).click(); await a.page.locator('input[data-photo-id="'+aOutput.doc.photos[0].id+'"]').check(); await a.page.getByRole('button',{name:'공개 미리보기 갱신',exact:true}).click();
      for(const name of ['글 전체와 모든 사진 원본의 비공개 서버 보관 동의','선택한 사진 원본과 포함된 메타데이터 공개 동의','이 내용을 공개합니다'])await a.page.getByRole('checkbox',{name,exact:true}).check(); await a.page.getByRole('button',{name:'공개 게시·갱신',exact:true}).click(); const link=a.page.getByRole('link',{name:'공개한 글 열기',exact:true});await link.waitFor();const url=await link.getAttribute('href'),token=new URL(url,base).searchParams.get('post');
      const pub=server.rpc(null,'life_blog_public_read',{p_token:token});assert.equal(pub.snapshot.photos.length,1);for(const text of ['PRIVATE_NOTE_SENTINEL','PRIVATE_QUESTION_SENTINEL','PRIVATE_FULL_BODY_NOT_PUBLIC','PRIVATE_LINK_NOTE_NOT_ADOPTED','LATEST_MUST_NOT_REPLACE_OLD'])assert(!JSON.stringify(pub).includes(text),text);
      const visitor=await device('continuity-visitor',null);await visitor.page.goto(url);await visitor.page.waitForFunction(()=>document.querySelector('#blogStatus')?.dataset.state==='published');const image=visitor.page.locator('#blogContent img');await image.evaluate(n=>n.decode());assert.deepEqual(await image.evaluate(n=>[n.naturalWidth,n.naturalHeight]),[4032,3024]);const src=await image.getAttribute('src');assert.equal(await visitor.page.evaluate(async url=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(url)).arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join(''),src),aOutput.doc.photos[0].digest);assert.equal(await visitor.page.evaluate(()=>__homeDbOpens.length),0);await capture(visitor.page,'anonymous-selected-output');
      await a.page.getByRole('button',{name:'공개 철회',exact:true}).click();await a.page.getByText('공개 철회를 확인했습니다. 이 브라우저의 원래 글은 유지했습니다.',{exact:true}).waitFor();assert.equal(server.rpc(null,'life_blog_public_read',{p_token:token}),null);await visitor.page.locator('#blogRefresh').click();await visitor.page.waitForFunction(()=>document.querySelector('#blogStatus')?.dataset.state==='missing');assert.equal(await visitor.page.locator('#blogContent').innerText(),'');assert.equal(await visitor.page.evaluate(async url=>(await fetch(url)).status,src),404);await visitor.context.close();
      // Receiving remaps photo IDs. Existing BlogSync may align those IDs via
      // a new private revision during publication; the preparation descriptor
      // advances only through this separately reviewed explicit checkpoint.
      await enter(a.page,f.planId);await panel(a.page);await a.page.locator('#mcOutputReview').click();await a.page.locator('#mcOutputConsent').check();await a.page.locator('#mcShareOutput').click();await a.page.waitForFunction(()=>document.querySelector('#mcPanel')?.getAttribute('aria-busy')==='false');
      savedOutput=row(remoteId);assert.equal(savedOutput.data.output.revision,server.rpc(accounts.a.id,'life_blog_read',{p_post_id:savedOutput.data.output.postId}).revision);
      await enter(a.page,f.planId);await a.page.locator('#mwPreserveOutput').click();await a.page.locator('#lifePreservation[data-state="ready"]').waitFor();await a.page.locator('#preservationPrepareExport').click();await a.page.locator('#preservationExportReview[data-state="ready"]').waitFor();const event=a.page.waitForEvent('download');await a.page.locator('#preservationDownload').click();const archive=Buffer.from(await fs.readFile(await(await event).path()));await fs.writeFile(path.join(output,'synthetic-evidence.zip'),archive);
      const files=ZIP.unzipSync(archive),manifest=JSON.parse(ZIP.strFromU8(files['manifest.json']));assert.equal(manifest.posts.length,1);assert.equal(manifest.bundle.sourceVersions.length,2);for(const text of ['PRIVATE_NOTE_SENTINEL','PRIVATE_QUESTION_SENTINEL','PRIVATE_LINK_NOTE_NOT_ADOPTED','LATEST_MUST_NOT_REPLACE_OLD'])assert(!JSON.stringify(manifest).includes(text),text);for(const p of aOutput.doc.photos)assert.equal(digest(files['photos/'+aOutput.doc.id+'/'+p.id]),p.digest);
      await a.page.locator('#preservationFile').setInputFiles({name:'합성 근거.zip',mimeType:'application/zip',buffer:archive});await a.page.locator('#preservationImportReview[data-state="ready"]').waitFor();await a.page.locator('#preservationRestore').click();await a.page.waitForFunction(()=>!!document.querySelector('#lifePreservation')?.dataset.restoreWorkspaceId);const ws=await a.page.locator('#lifePreservation').getAttribute('data-restore-workspace-id'),restored=await snapshot(a.page,ws);assert.notEqual(ws,f.workspaceId);assert.equal(restored.posts.length,1);assert.equal(restored.preparation.plans.length,0);assert.equal(restored.posts[0].sync,null);for(const ref of restored.posts[0].evidence.refs)await a.page.evaluate(async({ws,ref})=>HaedoLife.SourceReference.resolve(await HaedoLife.Shell.storage.read(ws),ref),{ws,ref});for(let i=0;i<2;i++)assert.equal(restored.posts[0].doc.photos[i].actualHash,aOutput.doc.photos[i].digest);await capture(a.page,'evidence-new-workspace');
    });
    await a.context.close(); await b.context.close();
    // Focused failures below use actual runtime service methods in browser,
    // preserving SDK/SQL/IDB boundaries without repeating the whole UI journey.
    await check('Historical receipt replay observes the current head; both explicit conflict choices retain the other complete preparation and exact sources',async()=>{
      const left=await device('conflict-a'),right=await device('conflict-b');page=left.page;const c=await seedContinuity(page,'충돌 비교의 최초 준비');await connect(page,c.workspaceId,c.planId);const initial=await call(page,'getState',[c.workspaceId,c.planId]),id=initial.remoteId;
      const received=await call(right.page,'receive',[id,row(id).revision]);
      await editPreparation(page,c.workspaceId,c.planId,'LOST_REPLY_LOCAL_PREPARATION');server.materialFailure=e=>e.device===left.name&&e.rpc==='life_material_put';const lost=await invoke(page,'connect',[c.workspaceId,c.planId,await reviewFingerprint(page,c.workspaceId,c.planId)]);assert.equal(lost.ok,false);const lostRow=row(id);assert.equal(lostRow.data.plan.title,'LOST_REPLY_LOCAL_PREPARATION');
      await call(right.page,'sync',[received.workspaceId,received.planId]);await editPreparation(right.page,received.workspaceId,received.planId,'REMOTE_ADVANCED_AFTER_LOST_REPLY');await connect(right.page,received.workspaceId,received.planId);const advanced=row(id);assert.equal(advanced.revision,lostRow.revision+1);
      await call(page,'sync',[c.workspaceId,c.planId]);const current=await call(page,'getState',[c.workspaceId,c.planId]);assert(current.remoteRevision===advanced.revision||current.conflict?.row?.revision===advanced.revision,'An old success receipt must not be presented as the current head');const replay=server.materialRequests.filter(e=>e.device===left.name&&e.rpc==='life_material_put'&&e.body.p_data.plan.title==='LOST_REPLY_LOCAL_PREPARATION');assert.equal(replay.length,2);assert.deepEqual(replay[0].body,replay[1].body);
      if(current.status==='conflict'){const compared=await call(page,'compare',[c.workspaceId,c.planId]);await call(page,'resolve',[c.workspaceId,c.planId,'remote',compared.expected]);}
      await editPreparation(page,c.workspaceId,c.planId,'KEEP_LOCAL_INPUT_BEFORE_REMOTE_CHOICE');await editPreparation(right.page,received.workspaceId,received.planId,'KEEP_REMOTE_INPUT');await connect(right.page,received.workspaceId,received.planId);await call(page,'sync',[c.workspaceId,c.planId]);assert.equal((await call(page,'getState',[c.workspaceId,c.planId])).status,'conflict');
      await enter(page,c.planId);await panel(page);await page.locator('#mcCompare').click();await page.locator('#mcConflictContent').waitFor();for(const details of await page.locator('#mcConflictContent .mc-originals').all())if(!await details.evaluate(n=>n.open))await details.locator(':scope > summary').click();await capture(page,'conflict-exact-preparations');
      let compared=await call(page,'compare',[c.workspaceId,c.planId]);await call(page,'resolve',[c.workspaceId,c.planId,'remote',compared.expected]);let preserved=await allPlans(page);assert(preserved.some(r=>r.plan.title==='KEEP_LOCAL_INPUT_BEFORE_REMOTE_CHOICE'&&!r.continuity));assert(preserved.some(r=>r.plan.title==='KEEP_REMOTE_INPUT'));assert.equal(row(id).data.plan.title,'KEEP_REMOTE_INPUT');
      await editPreparation(page,c.workspaceId,c.planId,'CHOSEN_LOCAL_INPUT');await editPreparation(right.page,received.workspaceId,received.planId,'RECOVER_REMOTE_INPUT');await connect(right.page,received.workspaceId,received.planId);await call(page,'sync',[c.workspaceId,c.planId]);compared=await call(page,'compare',[c.workspaceId,c.planId]);
      await editPreparation(right.page,received.workspaceId,received.planId,'REMOTE_CHANGED_AFTER_COMPARISON');await connect(right.page,received.workspaceId,received.planId);const beforeStale=await rawState(page),stale=await invoke(page,'resolve',[c.workspaceId,c.planId,'local',compared.expected]);assert.equal(stale.ok,false);assert.equal(row(id).data.plan.title,'REMOTE_CHANGED_AFTER_COMPARISON');const afterStale=await rawState(page);assert.deepEqual(afterStale.bundles,beforeStale.bundles);assert.equal((await allPlans(page)).filter(r=>!r.continuity).length,preserved.filter(r=>!r.continuity).length);
      await call(page,'sync',[c.workspaceId,c.planId]);compared=await call(page,'compare',[c.workspaceId,c.planId]);await call(page,'resolve',[c.workspaceId,c.planId,'local',compared.expected]);preserved=await allPlans(page);assert.equal(row(id).data.plan.title,'CHOSEN_LOCAL_INPUT');assert(preserved.some(r=>r.plan.title==='REMOTE_CHANGED_AFTER_COMPARISON'&&!r.continuity));assert(preserved.some(r=>r.plan.title==='CHOSEN_LOCAL_INPUT'));assert(preserved.every(r=>r.plan.blocks.filter(b=>b.kind==='quote').length===2||r.plan.title==='UNSELECTED_PREPARATION_SENTINEL'));await left.context.close();await right.context.close();
    });
    await check('The final real IDB install receipt abort rolls back workspace/sources/post/evidence/binding; the identical retry installs one copy and subsequent receive reuses it',async()=>{
      const d=await device('install-abort');page=d.page;const before=await rawState(page);
      await page.evaluate(()=>{window.__mcPut=IDBObjectStore.prototype.put;window.__mcAborts=0;IDBObjectStore.prototype.put=function(...args){const request=__mcPut.apply(this,args);if(this.name==='meta'&&String(args[0]?.key).startsWith('material-continuity-install:')){__mcAborts++;this.transaction.abort();}return request;};});
      const failed=await invoke(page,'receive',[remoteId,row(remoteId).revision]);assert.equal(failed.ok,false);assert(await page.evaluate(()=>__mcAborts>0));assert.deepEqual(await rawState(page),before);await page.evaluate(()=>{IDBObjectStore.prototype.put=__mcPut;});
      const first=await call(page,'receive',[remoteId,row(remoteId).revision]),installed=await snapshot(page,first.workspaceId);assert.equal(installed.posts.length,1);assert.equal(installed.posts[0].evidence.refs.length,2);const second=await call(page,'receive',[remoteId,row(remoteId).revision]);assert.equal(second.workspaceId,first.workspaceId);assert.equal(second.planId,first.planId);assert.equal(second.postId,first.postId);assert.equal((await rawState(page)).bundles.length,before.bundles.length+1);await d.context.close();
    });
    await check('Malformed full-body hashes, quote ranges and unselected-source injection fail before installing any private row',async()=>{
      const d=await device('malformed-closure');page=d.page;const before=await rawState(page);
      const variants=[data=>{data.bundle.sourceVersions.find(v=>typeof v.contentText==='string').contentText+='MALFORMED';},data=>{data.plan.blocks.find(b=>b.kind==='quote').reference.locator.start++;},data=>{const source=structuredClone(data.bundle.sources[0]),version=structuredClone(data.bundle.sourceVersions.find(v=>v.sourceId===source.id));source.id=randomUUID();version.id=randomUUID();version.sourceId=source.id;data.bundle.sources.push(source);data.bundle.sourceVersions.push(version);}];
      for(const mutate of variants){server.materialMutation={when:e=>e.device===d.name&&e.rpc==='life_material_get',change:value=>{mutate(value.data);return value;}};const failed=await invoke(page,'receive',[remoteId,row(remoteId).revision]);assert.equal(failed.ok,false);assert.match(failed.code,/invalid_remote_data|invalid_material_continuity|invalid_source_reference/);assert.deepEqual(await rawState(page),before);}
      await d.context.close();
    });
    await check('Foreign and anonymous reads reveal no private preparation; an actual SDK account change rejects the late accepted response before installation',async()=>{
      assert.equal(server.rpc(accounts.b.id,'life_material_get',{p_id:remoteId}),null);assert.deepEqual(server.rpc(accounts.b.id,'life_material_list',{p_after_updated_at:null,p_after_id:null}).items,[]);assert.throws(()=>server.rpc(null,'life_material_get',{p_id:remoteId}),error=>error.code==='42501');
      const d=await device('late-account');page=d.page;const before=await rawState(page),oldWorkspace=before.bundles[0].workspaceId;const gate=server.holdMaterialNext(e=>e.device===d.name&&e.rpc==='life_material_get');const pending=invoke(page,'receive',[remoteId,row(remoteId).revision]);await arrived(gate,pending);
      try{const error=await page.evaluate(async account=>{const r=await HaedoAuth.client.auth.signInWithPassword({email:account.email,password:'anonymous-browser-password'});if(!r.error)await HaedoAuth.verify();return r.error?.message||null;},accounts.b);assert.equal(error,null);await page.waitForFunction(id=>HaedoAuth.user?.id===id,accounts.b.id);}finally{gate.release();}
      const result=await pending;assert.equal(result.ok,false);assert.match(result.code,/request_cancelled|account_mismatch|storage_scope_closed/);await ready(page);const after=await rawState(page);assert.deepEqual(after.bundles.filter(b=>before.bundles.some(v=>v.workspaceId===b.workspaceId)),before.bundles);assert.equal(after.meta.filter(r=>String(r.key).startsWith('material-continuity')).length,0);assert.equal((await snapshot(page)).posts.length,0);
      assert.equal(await page.evaluate(async ws=>{try{await HaedoLife.Shell.storage.readMaterialWriting(ws);return'UNEXPECTED';}catch(e){return e.code;}},oldWorkspace),'workspace_access_denied');assert.equal(server.materialRequests.filter(e=>e.device===d.name&&e.rpc==='life_material_put').length,0);await d.context.close();
    });
    await check('An unfinished editing draft blocks clean receive; explicit comparison and remote choice retain its complete body, original photos and exact evidence in an unlinked recovery workspace',async()=>{
      const left=await device('editing-draft-a'),right=await device('editing-draft-b');page=left.page;
      await enter(page);const local=await uiReceive(page,remoteId);await page.locator('#mwContinue').click();await page.locator('.photo-article').waitFor();await page.getByRole('button',{name:'글 수정',exact:true}).click();
      await page.locator('#photoTitle').fill('UNFINISHED_EDITING_DRAFT_PRIVATE_TITLE');await page.evaluate(()=>{const q=Quill.find(document.querySelector('.ql-container'));q.insertText(q.getLength()-1,'\nUNFINISHED_EDITING_DRAFT_PRIVATE_BODY🌱\n','user');});
      await page.waitForFunction(async ws=>(await HaedoLife.Shell.storage.listPhotoPosts(ws)).some(p=>p.status==='draft'&&p.title==='UNFINISHED_EDITING_DRAFT_PRIVATE_TITLE'),local.workspaceId);
      await page.locator('.photo-editor').getByRole('button',{name:'닫기',exact:true}).click();await page.locator('#mwContinue').waitFor();await saved(page);
      const before=await snapshot(page,local.workspaceId),draft=before.posts.find(p=>p.doc.status==='draft');assert(draft);assert.equal(draft.doc.photos.length,2);assert.equal(before.posts.filter(p=>p.doc.status==='saved').length,1);
      const remote=await call(right.page,'receive',[remoteId,row(remoteId).revision]);await editPreparation(right.page,remote.workspaceId,remote.planId,'REMOTE_PREPARATION_AFTER_UNFINISHED_DRAFT');await connect(right.page,remote.workspaceId,remote.planId);
      const failed=await invoke(page,'receive',[remoteId,row(remoteId).revision]);assert.equal(failed.ok,false);assert.equal(failed.code,'local_changed');assert.deepEqual((await snapshot(page,local.workspaceId)).posts,before.posts);
      await panel(page);await page.locator('#mcRefresh').click();await page.locator('#mcStatus[data-state="conflict"]').waitFor();await page.locator('#mcCompare').click();await page.locator('#mcConflictContent .mc-post-content[data-side="editing"]').waitFor();assert.match(await page.locator('#mcConflictContent .mc-post-content[data-side="editing"]').innerText(),/UNFINISHED_EDITING_DRAFT_PRIVATE_BODY🌱/);await capture(page,'conflict-with-unfinished-editing-draft');
      const compared=await call(page,'compare',[local.workspaceId,local.planId]);assert.equal(compared.local.editingDrafts.length,1);assert.equal(compared.local.editingDrafts[0].post.id,draft.doc.id);assert.equal(compared.local.editingDrafts[0].refs.length,2);
      const resolved=await call(page,'resolve',[local.workspaceId,local.planId,'remote',compared.expected]);assert.equal(resolved.editingRecovery.length,1);const recovered=await snapshot(page,resolved.editingRecovery[0].workspaceId);assert.equal(recovered.posts.length,1);const copy=recovered.posts[0];assert.equal(copy.doc.status,'draft');assert.notEqual(copy.doc.id,draft.doc.id);const expectedOps=structuredClone(draft.doc.ops),photoMap=new Map(draft.doc.photos.map((photo,i)=>[photo.id,copy.doc.photos[i].id]));for(const photo of draft.doc.photos)assert.notEqual(photoMap.get(photo.id),photo.id);for(const op of expectedOps)if(op.insert?.photo)op.insert.photo.id=photoMap.get(op.insert.photo.id);assert.deepEqual(copy.doc.ops,expectedOps);assert.equal(copy.doc.title,draft.doc.title);assert.equal(copy.sync,null);assert.equal(copy.evidence.refs.length,2);assert.equal(await page.evaluate(async({ws,id})=>HaedoLife.Shell.storage.readMaterialContinuityState(ws,id),{ws:recovered.workspaceId,id:resolved.editingRecovery[0].planId}),null);
      for(let i=0;i<2;i++)for(const key of ['digest','actualHash','width','height','actualWidth','actualHeight'])assert.equal(copy.doc.photos[i][key],draft.doc.photos[i][key]);for(const ref of copy.evidence.refs)await page.evaluate(async({ws,ref})=>HaedoLife.SourceReference.resolve(await HaedoLife.Shell.storage.read(ws),ref),{ws:recovered.workspaceId,ref});assert.deepEqual((await snapshot(page,local.workspaceId)).posts.find(p=>p.doc.id===draft.doc.id),draft);assert.equal(row(remoteId).data.plan.title,'REMOTE_PREPARATION_AFTER_UNFINISHED_DRAFT');assert(!JSON.stringify(row(remoteId)).includes('UNFINISHED_EDITING_DRAFT_PRIVATE_BODY'));await left.context.close();await right.context.close();
    });
    await check('A saved descriptor cannot silently receive a different newer private-post revision or pair its old evidence with the newer body',async()=>{
      const descriptor=row(remoteId),postId=descriptor.data.output.postId,current=server.rpc(accounts.a.id,'life_blog_read',{p_post_id:postId}),data=structuredClone(current.data);data.title='NEWER_PRIVATE_POST_WITHOUT_NEW_DESCRIPTOR';const written=server.rpc(accounts.a.id,'life_blog_save',{p_workspace_id:current.workspace_id,p_post_id:postId,p_expected_revision:current.revision,p_operation_id:randomUUID(),p_data:data});assert.equal(written.status,'stored');assert.equal(written.revision,current.revision+1);assert.equal(row(remoteId).data.output.revision,descriptor.data.output.revision);
      const d=await device('exact-output-revision');page=d.page;const before=await rawState(page),result=await invoke(page,'receive',[remoteId,descriptor.revision]);assert.equal(result.ok,false);assert.equal(result.code,'material_output_changed');assert.deepEqual(await rawState(page),before);await d.context.close();
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
module.exports={seedContinuity,panel,invoke,call,reviewFingerprint,connect,selected,rawState,reviewConnection,uiReceive,editPreparation,output,migration};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});

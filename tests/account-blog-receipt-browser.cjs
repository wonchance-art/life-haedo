/* Actual SDK + account-scoped IndexedDB receipt boundaries. Auth and private
 * blog HTTP are strict synthetic fixtures; no hosted SQL/RLS or Apple claim. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4262';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, session, base, cloud } = require('./life-sync-browser.cjs');
const output = path.resolve('.local/account-blog-receipt'), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function entered(gate) {
  let timer;
  try { await Promise.race([gate.entered.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Expected synthetic original download did not start')), 20000); })]); }
  finally { clearTimeout(timer); }
}
class ReceiptCloud extends FakeCloud {
  constructor() { super(); this.downloadGate = null; }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url()), gate = this.downloadGate;
    if (gate && device === gate.device && request.method() === 'GET' && url.pathname.startsWith('/storage/v1/object/')) {
      this.downloadGate = null; gate.entered.resolve(); await gate.release.promise;
    }
    try { return await super.handle(route, device); }
    catch (error) { if (!/closed|disposed|handled|Target page/i.test(error.message)) throw error; }
  }
}
async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  await fs.mkdir(output, { recursive: true });
  const report = { checks: [], pageErrors: [], consoleErrors: [], external: [],
    scope: 'Actual bundled SDK, image decoding and account-scoped IndexedDB. Synthetic Auth/CAS/original Storage HTTP only; no live account, hosted SQL/RLS, native IME or Apple hardware.' };
  report.sources = await Promise.all(['assets/platform-auth.js','assets/life/ui.js','assets/life/storage.js','assets/life/blog-sync.js','assets/life/account-blog-ui.js','assets/life/photo-post-ui.js'].map(async file => {
    const response = await fetch(base + '/' + file); assert(response.ok); const served = Buffer.from(await response.arrayBuffer()), disk = await fs.readFile(file);
    assert.equal(sha(served), sha(disk), 'Serve this exact checkout: ' + file); return { file, sha256: sha(disk) };
  }));
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); report.node = process.version;
  let active, number = 0;
  async function device(server, name, account = accounts.a, existing = null) {
    const context = existing || await makeContext(browser, server, name, account, { viewport: { width: 1440, height: 1000 } });
    if (!existing) await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin) || ['blob:', 'data:'].includes(u.protocol)) return route.fallback(); report.external.push(u.origin); return route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
    page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ name, message: event.text() }); });
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await ready(page);
    await page.evaluate(() => { window.__receiptStorage = HaedoLife.Shell.storage; window.__receiptSync = HaedoLife.BlogSync.create({ storage: __receiptStorage, auth: HaedoAuth }); });
    return { page, context, name };
  }
  async function fixture() {
    const server = new ReceiptCloud(), name = 'receipt-' + number++, sender = await device(server, name + '-sender');
    const original = await sender.page.evaluate(async () => {
      const L = HaedoLife, s = __receiptStorage, ws = await s.getActive(), P = L.PhotoPost, photos = [];
      for (const [width, height, type, color] of [[4032,3024,'image/png','#345f42'],[1200,1800,'image/jpeg','#886b39']]) {
        const c = document.createElement('canvas'); c.width = width; c.height = height; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0,0,width,height);
        const blob = await new Promise(resolve => c.toBlob(resolve, type));
        photos.push(await P.readPhoto(new File([blob], type === 'image/png' ? 'exact-original.png' : 'exact-original.jpg', { type }), L.Core.id));
      }
      photos.splice(1, 0, { ...photos[0], id: L.Core.id(), name: 'same-bytes-another-photo.png' });
      const d = P.create(L.Core.id); Object.assign(d, { title: '두 기기의 정확한 여행 글', status: 'saved', photos,
        attachments: [{ type: 'book', title: '명시한 책', creator: '익명', url: 'https://example.org/book' }],
        ops: [{ insert: '한글과 emoji 🌱\n기억한 본문\n' }, ...photos.flatMap((photo, i) => [{ insert: { photo: { id: photo.id, caption: '서로 다른 설명 ' + i, alt: '원본 색면 ' + i } } }, { insert: '\n' }])] });
      const saved = await s.savePhotoPost(ws, d, 0); await __receiptSync.saveDefault(ws, saved.id, { expectedLocalRevision: saved.revision });
      return { workspaceId: ws, id: saved.id, format: saved.format, ops: saved.ops, attachments: saved.attachments,
        photos: saved.photos.map(({ blob, ...photo }) => photo), state: await __receiptSync.getState(ws, saved.id) };
    });
    assert.equal(original.state.status, 'synced'); await sender.context.close();
    const target = await device(server, name + '-receiver');
    const seed = await target.page.evaluate(async () => {
      const s = __receiptStorage, ws = await s.getActive(), d = HaedoLife.PhotoPost.create(HaedoLife.Core.id); d.title = '보존할 미완성 입력'; d.ops = [{ insert: 'PRIVATE_DRAFT_UNCHANGED\n' }];
      const saved = await s.savePhotoPost(ws, d, 0); return { workspaceId: ws, draftId: saved.id };
    });
    const f = { ...target, server, original, seed, contexts: [target.context], gates: [] }; active = f; return f;
  }
  async function call(page, method, args) {
    // Playwright serializes Error name/message/stack but omits custom codes.
    const result = await page.evaluate(async ({ method, args }) => {
      try { return { ok: true, value: await __receiptSync[method](...args) }; }
      catch (error) { return { ok: false, error: { code: error.code, message: error.message } }; }
    }, { method, args });
    if (!result.ok) throw Object.assign(Error(result.error.message), { code: result.error.code });
    return result.value;
  }
  async function open(f, page = f.page) { return call(page, 'openRemote', [f.seed.workspaceId, f.original.id, { expectedRemoteRevision: f.original.state.remoteRevision }]); }
  async function audit(page, workspaceId) {
    return page.evaluate(async ws => {
      const s = __receiptStorage, rows = await s.listPhotoPosts(ws), docs = [];
      for (const row of rows) { const d = await s.readPhotoPost(ws, row.id); docs.push({ ...d, photos: await Promise.all(d.photos.map(async ({ blob, ...p }) => ({ ...p, actual: await HaedoLife.PhotoPost.digest(blob) }))) }); }
      const raw = await new Promise((resolve, reject) => { const request = indexedDB.open('life-tools-v1', 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction('meta', 'readonly'), get = tx.objectStore('meta').getAll(); get.onerror = () => { db.close(); reject(get.error); }; get.onsuccess = () => { const values = get.result.filter(row => ['photo-post:','photo-posts:','blog-sync:','blog-received:'].some(prefix => row.key.startsWith(prefix + ws))).map(row => ({ key: row.key, ...(row.key.startsWith('photo-post:') ? {} : { value: row.value }) })).sort((a,b) => a.key.localeCompare(b.key)); db.close(); resolve(values); }; }; });
      return { docs, rows, raw, copies: await s.listBlogCopies(ws), bundle: await s.read(ws) };
    }, workspaceId);
  }
  async function photoProof(page, ws, id) {
    return page.evaluate(async ({ ws, id }) => { const d = await __receiptStorage.readPhotoPost(ws,id); return Promise.all(d.photos.map(async p => { const image = await createImageBitmap(p.blob), c = document.createElement('canvas'); c.width = image.width; c.height = image.height; const g = c.getContext('2d'); g.drawImage(image,0,0); image.close(); return { id: p.id, width: c.width, height: c.height, type: p.type, size: p.blob.size, digest: await HaedoLife.PhotoPost.digest(p.blob), pixel: [...g.getImageData(0,0,1,1).data] }; })); }, { ws, id });
  }
  function readOnly(f) {
    const receiver = f.name;
    assert(f.server.blogCalls.filter(c => c.device.startsWith(receiver)).every(c => ['life_blog_list','life_blog_read'].includes(c.rpc)), 'Discovery/opening must not privately save or publish');
    assert(f.server.assetCalls.filter(c => c.device.startsWith(receiver)).every(c => c.method === 'GET'));
    assert.equal(f.server.writes().length, 0);
  }
  async function check(name, run) {
    if (process.env.ACCOUNT_BLOG_RECEIPT_MATCH && !new RegExp(process.env.ACCOUNT_BLOG_RECEIPT_MATCH).test(name)) return;
    console.log('START ' + name); const f = await fixture();
    try { await run(f); readOnly(f); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.failure = { name, message: error.message, stack: error.stack }; await f.page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error; }
    finally { for (const gate of f.gates) gate.release.resolve(); for (const context of new Set(f.contexts)) await context.close(); active = null; }
  }
  try {
    await check('Repeated catalog and concurrent tabs install one exact post, and reopening after a committed display failure reuses it', async f => {
      const baseline = await audit(f.page, f.seed.workspaceId), before = await call(f.page,'catalog',[f.seed.workspaceId]);
      assert.equal(before.find(row => row.id === f.original.id).status, 'server_only');
      assert.deepEqual(await call(f.page,'catalog',[f.seed.workspaceId]), before); assert.deepEqual(await audit(f.page,f.seed.workspaceId),baseline);
      await f.page.evaluate(async ws => {
        const host=document.createElement('section');host.id='receiptAccountHost';document.querySelector('#lifeApp').append(host);
        window.__receiptUIResults=[];window.__receiptOpenCalls=[];
        const sync={...__receiptSync,async openRemote(...args){const result=await __receiptSync.openRemote(...args);__receiptUIResults.push({localPostId:result.localPostId,received:result.received});return result;}};
        window.__receiptUI=HaedoLife.AccountBlogUI.create({storage:__receiptStorage,workspaceId:ws,blogSync:sync,isCurrent:()=>true,
          async onOpenPost(id,options){__receiptOpenCalls.push({id,options});if(__receiptOpenCalls.length===1)throw Error('Synthetic display failure after committed receive');},
          async onManagePost(){throw Error('Unexpected conflict-management route');}});
        await __receiptUI.mount(host);
      },f.seed.workspaceId);
      const row=f.page.locator('#receiptAccountHost .ab-post[data-remote-id="'+f.original.id+'"]');
      const tab = await device(f.server, f.name, accounts.a, f.context);
      const [,b] = await Promise.all([row.locator('button[data-action="receive"]').click(),open(f,tab.page)]);
      await row.locator('button[data-action="retry-open"]').waitFor();
      const a=await f.page.evaluate(()=>__receiptUIResults[0]);assert(a);
      assert.equal(a.localPostId,b.localPostId);assert.equal([a,b].filter(v=>v.received).length,1);
      const current = await audit(f.page,f.seed.workspaceId); assert.equal(current.docs.length,baseline.docs.length+1); assert.equal(current.copies.filter(c => c.remoteId === f.original.id).length,1);
      assert.deepEqual(current.docs.find(d => d.id === f.seed.draftId),baseline.docs.find(d => d.id === f.seed.draftId));
      const downloads=f.server.assetCalls.length;
      await row.locator('button[data-action="retry-open"]').click();
      assert.deepEqual(await f.page.evaluate(()=>__receiptOpenCalls.map(v=>v.id)),[a.localPostId,a.localPostId]);
      assert.equal(f.server.assetCalls.length,downloads,'Retrying a display failure must not download/install again');
      assert.deepEqual(await audit(f.page,f.seed.workspaceId),current);
      await f.page.reload({waitUntil:'domcontentloaded'}); await ready(f.page); await f.page.evaluate(()=>{window.__receiptStorage=HaedoLife.Shell.storage;window.__receiptSync=HaedoLife.BlogSync.create({storage:__receiptStorage,auth:HaedoAuth});});
      assert.equal((await open(f)).localPostId,a.localPostId); assert.deepEqual(await audit(f.page,f.seed.workspaceId),current);
    });
    await check('Aborting the final receipt write rolls back every original, index and binding; one explicit retry installs one copy', async f => {
      const before = await audit(f.page,f.seed.workspaceId);
      await f.page.evaluate(()=>{window.__receiptPut=IDBObjectStore.prototype.put;window.__receiptAborts=0;IDBObjectStore.prototype.put=function(...args){const request=__receiptPut.apply(this,args);if(this.name==='meta'&&args[0]?.key?.startsWith('blog-received:')){__receiptAborts++;this.transaction.abort();}return request;};});
      await assert.rejects(open(f)); assert.equal(await f.page.evaluate(()=>__receiptAborts),1); assert.deepEqual(await audit(f.page,f.seed.workspaceId),before);
      await f.page.evaluate(()=>IDBObjectStore.prototype.put=__receiptPut); const result=await open(f),after=await audit(f.page,f.seed.workspaceId);
      assert.equal(after.docs.length,before.docs.length+1);assert.equal(after.copies.length,1);assert.equal((await open(f)).localPostId,result.localPostId);assert.deepEqual(await audit(f.page,f.seed.workspaceId),after);
    });
    await check('Replacing a received saved post moves its binding and receipt to the new exact local ID while both ZIP formats retain original bytes', async f => {
      const received=await open(f),before=await audit(f.page,f.seed.workspaceId);
      const replacement=await f.page.evaluate(async ({ws,id})=>{const s=__receiptStorage,old=await s.readPhotoPost(ws,id),d=structuredClone(old);d.id=HaedoLife.Core.id();d.revision=0;d.replaces={id:old.id,revision:old.revision};d.title='다른 기기에서 이어 쓴 본문';d.ops.unshift({insert:'명시 수정\n'});return s.savePhotoPost(ws,d,0);},{ws:f.seed.workspaceId,id:received.localPostId});
      assert.notEqual(replacement.id,received.localPostId);assert.equal((await open(f)).localPostId,replacement.id);
      const after=await audit(f.page,f.seed.workspaceId);assert.equal(after.docs.length,before.docs.length);assert(!after.docs.some(d=>d.id===received.localPostId));assert.equal(after.copies[0].localPostId,replacement.id);
      const receipt=after.raw.find(r=>r.key===`blog-received:${f.seed.workspaceId}:${f.original.id}`);assert.equal(receipt.value.localPostId,replacement.id);
      const zip=await f.page.evaluate(async({ws,id})=>{const P=HaedoLife.PhotoPost,d=await __receiptStorage.readPhotoPost(ws,id),out=[];for(const legacy of [false,true]){const copy=structuredClone(d);if(legacy){copy.format='life-photo-post-v1';delete copy.attachments;delete copy.archived;}const blob=await P.backup(copy),restored=await P.readBackup(blob,HaedoLife.Core.id);out.push({legacy,sourceFormat:copy.format,status:restored.status,id:restored.id,photos:await Promise.all(restored.photos.map(async p=>({digest:await P.digest(p.blob),width:p.width,height:p.height,size:p.blob.size,type:p.type}))),ops:restored.ops,attachments:restored.attachments});}return out;},{ws:f.seed.workspaceId,id:replacement.id});
      for(const value of zip){assert.equal(value.status,'draft');assert.notEqual(value.id,replacement.id);assert.deepEqual(value.photos,f.original.photos.map(p=>({digest:p.digest,width:p.width,height:p.height,size:p.size,type:p.type})));}
      for(const value of zip){assert.deepEqual(value.ops.filter(op=>op.insert?.photo).map(op=>({caption:op.insert.photo.caption,alt:op.insert.photo.alt})),f.original.ops.filter(op=>op.insert?.photo).map(op=>({caption:op.insert.photo.caption,alt:op.insert.photo.alt})));assert.deepEqual(value.ops.filter(op=>typeof op.insert==='string'),replacement.ops.filter(op=>typeof op.insert==='string'));}assert.deepEqual(zip[0].attachments,f.original.attachments);assert.deepEqual(zip[1].attachments,[]);assert.deepEqual(await audit(f.page,f.seed.workspaceId),after);
    });
    await check('Changed remote heads and workspace cancellation during held downloads cannot install an unreviewed post', async f => {
      const before=await audit(f.page,f.seed.workspaceId),gate={device:f.name,entered:deferred(),release:deferred()};f.gates.push(gate);f.server.downloadGate=gate;
      const pending=open(f);const rejected=assert.rejects(pending,error=>error.code==='local_changed'||error.code==='blog_conflict');await entered(gate);
      const row=f.server.posts.get(accounts.a.id+':'+f.original.id);row.revision++;row.data.title='검토 뒤 다른 기기에서 바뀐 글';gate.release.resolve();await rejected;assert.deepEqual(await audit(f.page,f.seed.workspaceId),before);
      const mutationGate={device:f.name,entered:deferred(),release:deferred()};f.gates.push(mutationGate);f.server.downloadGate=mutationGate;
      const mutation=call(f.page,'openRemote',[f.seed.workspaceId,f.original.id,{expectedRemoteRevision:row.revision}]);const mutationRejected=assert.rejects(mutation,{code:'invalid_remote_data'});await entered(mutationGate);
      row.data.title='같은 서버 버전 번호의 다른 본문';mutationGate.release.resolve();await mutationRejected;assert.deepEqual(await audit(f.page,f.seed.workspaceId),before);
      const next=await f.page.evaluate(async ws=>{const s=__receiptStorage,other=await s.createWorkspace('독립 합성 공간');await s.setActive(ws);return other.workspaceId;},f.seed.workspaceId);
      const workspaceGate={device:f.name,entered:deferred(),release:deferred()};f.gates.push(workspaceGate);f.server.downloadGate=workspaceGate;
      await f.page.evaluate(({ws,id,revision})=>{window.__receiptCurrent=ws;window.__workspaceReceipt=__receiptSync.openRemote(ws,id,{expectedRemoteRevision:revision,isCurrent:()=>__receiptCurrent===ws}).then(v=>({ok:true,id:v.localPostId}),e=>({ok:false,code:e.code}));},{ws:f.seed.workspaceId,id:f.original.id,revision:row.revision});
      await entered(workspaceGate);await f.page.evaluate(async ws=>{await __receiptStorage.setActive(ws);window.__receiptCurrent=await __receiptStorage.getActive();},next);workspaceGate.release.resolve();
      assert.deepEqual(await f.page.evaluate(()=>__workspaceReceipt),{ok:false,code:'request_cancelled'});
      assert.deepEqual(await audit(f.page,f.seed.workspaceId),before);assert.equal((await audit(f.page,next)).docs.length,0);

    });
    await check('Corrupt bytes and an actual account change install nothing; a fresh valid receive preserves 4032px pixels, duplicate-photo identity and private drafts', async f => {
      const baseline=await audit(f.page,f.seed.workspaceId),[key,original]=[...f.server.originals.entries()][0];f.server.originals.set(key,{...original,bytes:Buffer.from('not the original image')});
      await assert.rejects(open(f));assert.deepEqual(await audit(f.page,f.seed.workspaceId),baseline);f.server.originals.set(key,original);
      const result=await open(f),proof=await photoProof(f.page,f.seed.workspaceId,result.localPostId);
      assert.deepEqual(proof.map(p=>p.digest),f.original.photos.map(p=>p.digest));assert.deepEqual(proof.map(p=>[p.width,p.height]),[[4032,3024],[4032,3024],[1200,1800]]);assert.deepEqual(proof[0].pixel,[52,95,66,255]);assert.notEqual(proof[0].id,proof[1].id);assert.equal(proof[0].digest,proof[1].digest);
      const current=await audit(f.page,f.seed.workspaceId);assert.deepEqual(current.docs.find(d=>d.id===f.seed.draftId),baseline.docs.find(d=>d.id===f.seed.draftId));
      const other=await device(f.server,f.name+'-late');f.contexts.push(other.context);const ws=await other.page.evaluate(()=>__receiptStorage.getActive()),gate={device:other.name,entered:deferred(),release:deferred()};f.gates.push(gate);f.server.downloadGate=gate;
      await other.page.evaluate(({ws,id,revision})=>{window.__oldReceiptStorage=__receiptStorage;window.__lateReceipt=__receiptSync.openRemote(ws,id,{expectedRemoteRevision:revision}).then(v=>({ok:true,id:v.localPostId}),e=>({ok:false,code:e.code}));},{ws,id:f.original.id,revision:f.original.state.remoteRevision});await entered(gate);
      await other.page.evaluate(async value=>{const result=await HaedoAuth.client.auth.setSession(value);if(result.error)throw result.error;await HaedoAuth.verify();},session(accounts.b));await other.page.waitForFunction(id=>HaedoAuth.user?.id===id,accounts.b.id);gate.release.resolve();
      const late=await other.page.evaluate(()=>__lateReceipt);assert.equal(late.ok,false);assert.equal(late.code,'request_cancelled');
      await other.page.evaluate(()=>HaedoLife.Shell.start());await ready(other.page);assert.equal(await other.page.evaluate(async()=>{const s=HaedoLife.Shell.storage;return(await s.listPhotoPosts(await s.getActive())).length;}),0);
      assert.equal(await other.page.evaluate(async ws=>{try{await __oldReceiptStorage.listPhotoPosts(ws);return false;}catch(_){return true;}},ws),true);
      const foreign=await other.page.evaluate(async id=>{const s=HaedoLife.Shell.storage,service=HaedoLife.BlogSync.create({storage:s,auth:HaedoAuth}),ws=await s.getActive();try{const rows=await service.catalog(ws);let code=null;try{await service.openRemote(ws,id,{expectedRemoteRevision:1});}catch(error){code=error.code;}return{rows,code,posts:await s.listPhotoPosts(ws)};}finally{service.dispose();}},f.original.id);
      assert.deepEqual(foreign.rows,[]);assert.equal(foreign.code,'remote_missing');assert.deepEqual(foreign.posts,[]);

    });
    report.finalSources = await Promise.all(report.sources.map(async ({file}) => {
      const response=await fetch(base+'/'+file);assert(response.ok);const served=Buffer.from(await response.arrayBuffer()),disk=await fs.readFile(file);
      assert.equal(sha(served),sha(disk),file);return {file,sha256:sha(disk)};
    }));
    assert.deepEqual(report.finalSources,report.sources,'Frozen served runtime must remain unchanged throughout the regression');
    assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.external,[]);report.pass=true;
  } catch(error){report.pass=false;report.error=error.stack;throw error;}
  finally {if(active){for(const gate of active.gates)gate.release.resolve();for(const context of new Set(active.contexts))await context.close();}await browser.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

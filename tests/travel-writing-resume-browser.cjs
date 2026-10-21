/* A retained writing session across synthetic pagehide/persisted-pageshow.
 * Real app, bundled Auth SDK, original PNG bytes and account-scoped IDB.
 * Lifecycle/composition events are simulated in Linux Chromium, not Apple OS,
 * native IME, browser eviction, crash recovery or live Google verification. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4231';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready, nav } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, session, cloud, base } = require('./life-sync-browser.cjs');
const out = path.resolve(__dirname, '../.local/travel-writing-resume');
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };
async function entered(gate) {
  let timer;
  try { await Promise.race([gate.entered.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Expected retained-session server verification did not start')), 15000); })]); }
  finally { clearTimeout(timer); }
}

async function main() {
  await fs.mkdir(out, { recursive: true });
  const report = { checks: [], visual: [], pageErrors: [], consoleErrors: [], expectedAuthErrors: [], external: [], writes: [],
    scope: 'One anonymous account-scoped SDK/IndexedDB writing journey. Synthetic persisted lifecycle and composition events in Linux Chromium; no Apple hardware, native file picker/IME, live OAuth, publication, browser eviction or crash-survival claim.' };
  report.sourceHashes = await Promise.all(['assets/platform-auth.js','assets/life/shell.js','assets/life/ui.js','assets/life/workbench-ui.js','assets/life/photo-post-ui.js'].map(async file => {
    const response = await fetch(base+'/'+file);assert(response.ok);const served=Buffer.from(await response.arrayBuffer()),disk=await fs.readFile(path.resolve(__dirname,'..',file));
    const digest=value=>createHash('sha256').update(value).digest('hex');assert.equal(digest(served),digest(disk),file+': server must serve this checkout');return {file,sha256:digest(served)};
  }));
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); report.node = process.version;
  const server = new FakeCloud(), context = await makeContext(browser, server, 'travel-resume', accounts.a, { viewport: { width: 1440, height: 1000 }, hasTouch: true });
  await context.addInitScript(()=>{window.__travelLifecycle=[];for(const kind of ['pagehide','pageshow'])addEventListener(kind,event=>{if(!event.persisted)return;__travelLifecycle.push({kind,x:scrollX,y:scrollY,active:document.activeElement?.id||document.activeElement?.tagName});},{capture:true});});
  let authGate = null, expectedAuthFailure = false;
  // Wrap only the test's real scoped API: an armed gate holds the result AFTER
  // the underlying IndexedDB transaction has committed, never fabricating it.
  await context.route(base + '/assets/life/storage.js', async route => {
    const response = await route.fetch();
    const hook = `\n;(function(){const original=HaedoLife.Storage;HaedoLife.Storage={...original,forAccount(account){const s=original.forAccount(account);return {...s,async savePhotoPost(...args){const gate=window.__travelSaveGate;if(!gate)return s.savePhotoPost(...args);window.__travelSaveGate=null;let saved;try{saved=await s.savePhotoPost(...args);}catch(error){if(gate==='failure'){window.__travelSaveFailed=true;await new Promise(resolve=>window.__travelSaveRelease=resolve);}throw error;}window.__travelSaveCommitted={id:saved.id,revision:saved.revision};await new Promise(resolve=>window.__travelSaveRelease=resolve);return saved;}};}};})();`;
    await route.fulfill({ response, body: await response.text() + hook });
  });
  await context.route(cloud + '/auth/v1/user', async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const bearer = route.request().headers().authorization?.split(' ')[1];
    const owner = bearer ? JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()).sub : null;
    if (authGate && owner === accounts.a.id) { const gate = authGate; gate.entered.resolve(); await gate.release.promise; }
    return route.fallback();
  });
  await context.route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    if ([new URL(base).origin, cloud].includes(origin)) return route.fallback();
    report.external.push(origin); return route.abort();
  });
  context.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === cloud && request.method() !== 'GET' && request.method() !== 'OPTIONS' && url.pathname.startsWith('/rest/')) report.writes.push(url.pathname);
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(15000);
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  page.on('console', event => {
    if (event.type() !== 'error') return;
    const expected = expectedAuthFailure && /ERR_INTERNET_DISCONNECTED|Failed to fetch|AuthRetryableFetchError/.test(event.text());
    (expected ? report.expectedAuthErrors : report.consoleErrors).push(event.text());
  });
  const check = async (name, run) => { await run(); report.checks.push({ name, pass: true }); console.log('PASS ' + name); };
  const saved = () => page.waitForFunction(() => document.querySelector('.photo-status')?.textContent === '브라우저에 자동 임시저장됨');
  const read = () => page.evaluate(async () => { const s = HaedoLife.Shell.storage, ws = await s.getActive(); return { ws, docs: await Promise.all((await s.listPhotoPosts(ws)).map(row => s.readPhotoPost(ws, row.id))) }; });
  const doc = async () => (await read()).docs.find(value => value.id === postId);
  const hide = () => page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  const show = () => page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  const retain = () => page.evaluate(() => {
    const input = document.querySelector('[aria-label="사진 설명"]');
    window.__travelDOM = { root: document.querySelector('.photo-editor'), editor: document.querySelector('.ql-editor'), title: document.querySelector('#photoTitle'), input, storage: HaedoLife.Shell.storage,
      active: document.activeElement, start: input?.selectionStart, end: input?.selectionEnd, direction: input?.selectionDirection,
      selection: Quill.find(document.querySelector('.ql-container')).getSelection(), scrollX, scrollY };
  });
  const assertRetained = async (focus = true) => {
    await page.waitForFunction(focus => {
      const old = __travelDOM;
      return !document.querySelector('#lifeApp').hidden && (!focus || old.active === document.activeElement) && Math.abs(old.scrollX-scrollX)<2 && Math.abs(old.scrollY-scrollY)<2;
    }, focus);
    assert.deepEqual(await page.evaluate(focus => {
      const old = __travelDOM, input = document.querySelector('[aria-label="사진 설명"]');
      return { root: old.root === document.querySelector('.photo-editor'), editor: old.editor === document.querySelector('.ql-editor'), title: old.title === document.querySelector('#photoTitle'),
        input: old.input === input, storage: old.storage === HaedoLife.Shell.storage, connected: old.editor.isConnected,
        focus: !focus || old.active === document.activeElement, range: !focus || !input || old.active !== input || (old.start === input.selectionStart && old.end === input.selectionEnd && old.direction === input.selectionDirection),
        scroll: Math.abs(old.scrollX - scrollX) < 2 && Math.abs(old.scrollY - scrollY) < 2 };
    }, focus), { root: true, editor: true, title: true, input: true, storage: true, connected: true, focus: true, range: true, scroll: true });
    assert.equal((await doc()).id, postId);
  };
  const resume = async (focus = true) => {
    authGate = { entered: deferred(), release: deferred() };
    const gate = authGate; await show(); await entered(gate);
    assert.equal(await page.locator('#lifeApp').isHidden(), true, 'No private reveal before server verification');
    assert.equal(await page.evaluate(() => __travelDOM.editor.isConnected), true, 'The suspended editor remains retained');
    authGate = null; gate.release.resolve(); await ready(page); await assertRetained(focus);
  };
  const click = async name => {
    if (name === '초안 다시 저장') { const more = page.locator('.photo-more'); if (!await more.evaluate(node => node.open)) await more.locator(':scope > summary').click(); }
    await page.getByRole('button', { name, exact: true }).click();
  };
  let postId, workspaceId, legacyId, baseline, images;
  async function legacySnapshot() {
    return page.evaluate(async legacyId => {
      const s = HaedoLife.Shell.storage, ws = await s.getActive();
      return { bundle: await s.read(ws), workbench: await s.readWorkbench(ws), drafts: await s.readPageDrafts(ws), nine: await s.readNineBoard(ws), legacy: await s.readPhotoPost(ws, legacyId) };
    }, legacyId);
  }
  try {
    await page.goto(base + '/index.html?section=records&view=page', { waitUntil: 'domcontentloaded' }); await ready(page);
    legacyId = await page.evaluate(async () => {
      const s = HaedoLife.Shell.storage, ws = await s.getActive(), P = HaedoLife.PhotoPost;
      const old = P.create(HaedoLife.Core.id); old.format = 'life-photo-post-v1'; delete old.attachments; delete old.archived; old.status = 'saved'; old.title = '기존 v1 기록'; old.ops = [{ insert: '기존 기록과 줄바꿈\nLEGACY_UNCHANGED\n' }]; await s.savePhotoPost(ws, old, 0);
      const wb = await s.readWorkbench(ws), M = HaedoLife.PagePosts, at = '2001-01-01T00:00:00.000Z', posts = wb.page.posts || [], draft = M.draft(posts, HaedoLife.Core.id(), at); draft.body = '기존 첨부 글 LEGACY_PAGE'; wb.page.posts = M.finish(posts.concat(draft), draft.id, at).posts; await s.saveWorkbench(ws, wb, wb.revision);
      return old.id;
    }); baseline = await legacySnapshot();
    images = await page.evaluate(() => [[1600,1200,'#34685c'],[1200,1600,'#b88959']].map(([width,height,color],i) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const g = canvas.getContext('2d'); g.fillStyle = color; g.fillRect(0,0,width,height); g.fillStyle = '#f5efdc'; g.fillRect(71,89,215,333); return { width, height, name: 'anonymous-travel-' + i + '.png', data: canvas.toDataURL('image/png').split(',')[1] };
    }));
    await nav(page,'home');await page.locator('[data-home-destination="write"]:visible, #homeFirstWrite').click();await page.locator('#photoTitle').fill('복귀해서 이어 쓰는 여행'); await page.locator('.ql-editor').fill('여행 첫 장면과 보관한 문장\n');
    await page.locator('#photoFiles').setInputFiles({ name: images[0].name, mimeType: 'image/png', buffer: Buffer.from(images[0].data, 'base64') }); await page.locator('.photo-block').waitFor(); await saved();
    const created = await read(); workspaceId = created.ws; postId = created.docs.find(value => value.title === '복귀해서 이어 쓰는 여행').id;
    await page.locator('.photo-block img').click(); await page.getByRole('textbox', { name: '사진 설명', exact: true }).fill('첫 사진의 보관한 설명'); await saved();

    await check('Accepted body and caption survive debounce exit, held verification and same-DOM return', async () => {
      await page.evaluate(() => {
        const q = Quill.find(document.querySelector('.ql-container')); q.insertText(q.getLength()-1,'DEBOUNCE_BODY 한글\n','user'); q.setSelection(2,3,'silent');
        const input = document.querySelector('[aria-label="사진 설명"]'); input.focus(); input.value = 'DEBOUNCE_CAPTION 둘째 줄\n설명'; input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'설명'})); input.setSelectionRange(2,7,'backward');
      }); await retain(); await hide(); assert.equal(await page.locator('#lifeApp').isHidden(), true); await resume(); await saved();
      const current = await doc(); assert(current.ops.some(op => typeof op.insert === 'string' && op.insert.includes('DEBOUNCE_BODY'))); assert(current.ops.some(op => op.insert?.photo?.caption === 'DEBOUNCE_CAPTION 둘째 줄\n설명'));
    });
    await check('Pending photo validation checkpoints accepted text without installing unverified bytes', async () => {
      await click('사진 편집 닫기');
      await page.evaluate(() => {
        const original = File.prototype.arrayBuffer; window.__travelFileOriginal = original;window.__travelFileEntered=false;
        File.prototype.arrayBuffer = async function(...args) { const data = await original.apply(this,args); if(this.name==='anonymous-travel-1.png'){window.__travelFileEntered=true;await new Promise(resolve=>window.__travelFileRelease=resolve);}return data; };
        const q = Quill.find(document.querySelector('.ql-container')); q.insertText(q.getLength()-1,'PHOTO_BUSY_ACCEPTED\n','user');
      });
      await page.locator('#photoFiles').setInputFiles({ name: images[1].name, mimeType: 'image/png', buffer: Buffer.from(images[1].data, 'base64') }); await page.waitForFunction(() => __travelFileEntered); await retain(); await hide(); await resume(false);
      const checkpoint = await doc(); assert.equal(checkpoint.photos.length,1); assert(checkpoint.ops.some(op => typeof op.insert === 'string' && op.insert.includes('PHOTO_BUSY_ACCEPTED')));
      await page.evaluate(() => { File.prototype.arrayBuffer=__travelFileOriginal;__travelFileRelease(); }); await page.locator('.photo-block').nth(1).waitFor(); await saved(); assert.equal((await doc()).photos.length,2);
    });
    await check('A real committed save remains valid when pagehide precedes its acknowledgement', async () => {
      await page.evaluate(() => { window.__travelSaveGate=true; window.__travelSaveCommitted=null; const q=Quill.find(document.querySelector('.ql-container'));q.insertText(q.getLength()-1,'COMMITTED_BEFORE_HIDE\n','user'); });
      await page.waitForFunction(() => __travelSaveCommitted); const committed = await page.evaluate(() => __travelSaveCommitted); assert.equal(committed.id,postId); await retain(); await hide(); await resume();
      assert.equal((await doc()).revision,committed.revision); await page.evaluate(() => __travelSaveRelease()); await saved(); assert.equal((await doc()).revision,committed.revision);
    });
    await check('Composition stays uncommitted in the same caption DOM and still guards ordinary navigation', async () => {
      await page.locator('.photo-block').first().focus(); await page.keyboard.press('Enter'); const caption = page.getByRole('textbox',{name:'사진 설명',exact:true}), accepted = await caption.inputValue();
      await caption.evaluate(node => { node.focus();node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'한'}));node.value='조합 중인 설명 아직 확정하지 않음';node.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,inputType:'insertCompositionText',data:'한'}));node.setSelectionRange(3,6); });
      await retain(); await hide(); await resume(); assert.equal(await caption.inputValue(),'조합 중인 설명 아직 확정하지 않음'); assert((await doc()).ops.some(op=>op.insert?.photo?.caption===accepted));
      await page.locator('[data-haedo-navigation] [data-haedo-section="home"]').click(); assert.equal(await caption.isVisible(),true); assert.equal(await caption.evaluate(node=>node===__travelDOM.input),true);
      await caption.dispatchEvent('compositionend',{data:'확정'}); await saved(); assert((await doc()).ops.some(op=>op.insert?.photo?.caption==='조합 중인 설명 아직 확정하지 않음'));
    });
    await check('An aborted checkpoint keeps accepted input and originals available for explicit save retry', async () => {
      await click('사진 편집 닫기'); const before = (await doc()).revision;
      await page.evaluate(() => {
        window.__travelPut=IDBObjectStore.prototype.put;window.__travelAborts=0;
        IDBObjectStore.prototype.put=function(...args){const request=__travelPut.apply(this,args);if(args[0]?.key?.startsWith('photo-post:')&&!__travelAborts++){this.transaction.abort();}return request;};
        const q=Quill.find(document.querySelector('.ql-container'));q.insertText(q.getLength()-1,'RETRY_ACCEPTED_BODY\n','user');
      }); await retain(); await hide(); await page.waitForFunction(()=>__travelAborts>0); await resume();
      assert.equal((await doc()).revision,before); assert.match(await page.locator('.ql-editor').innerText(),/RETRY_ACCEPTED_BODY/); await page.evaluate(()=>IDBObjectStore.prototype.put=__travelPut); await click('초안 다시 저장'); await saved(); assert((await doc()).revision>before);
      // A second actual IDB abort is held at its rejected acknowledgement. The
      // real logout handler must not reveal retained private DOM after hide.
      await page.evaluate(() => {
        window.__travelSaveGate='failure';window.__travelSaveFailed=false;window.__travelAborts=0;
        IDBObjectStore.prototype.put=function(...args){const request=__travelPut.apply(this,args);if(args[0]?.key?.startsWith('photo-post:')&&!__travelAborts++){this.transaction.abort();}return request;};
        const q=Quill.find(document.querySelector('.ql-container'));q.insertText(q.getLength()-1,'LOGOUT_FAILURE_ACCEPTED\n','user');
      }); await page.waitForFunction(()=>__travelSaveFailed);
      // The account menu is shown only in Settings. Invoke the real logout
      // handler as explicit race fault-injection, not a claimed pointer route
      // from this editor (no CSS/disabled override or forced pointer action).
      await page.evaluate(()=>document.getElementById('lifeLogout').click());await retain();await hide();
      authGate={entered:deferred(),release:deferred()};const logoutGate=authGate;await show();await entered(logoutGate);authGate=null;logoutGate.release.resolve();await page.evaluate(()=>HaedoLife.Shell.start());
      assert.equal(await page.locator('#lifeApp').isHidden(),true,'Verification cannot reveal a still-running logout');await page.evaluate(()=>__travelSaveRelease());
      await page.locator('#lifeStartup').getByRole('button',{name:'다시 확인',exact:true}).waitFor(); assert.equal(await page.locator('#lifeApp').isHidden(),true); assert.equal(await page.evaluate(()=>__travelDOM.editor.isConnected),true);
      await page.evaluate(()=>IDBObjectStore.prototype.put=__travelPut); await page.locator('#lifeStartup').getByRole('button',{name:'다시 확인',exact:true}).click();await ready(page);await assertRetained(false);
      assert.match(await page.locator('.ql-editor').innerText(),/LOGOUT_FAILURE_ACCEPTED/); await click('초안 다시 저장'); await saved();
    });
    await check('Offline re-verification keeps private input hidden until the same account is verified again', async () => {
      await page.locator('.photo-block').first().focus(); await page.keyboard.press('Enter'); await page.getByRole('textbox',{name:'사진 설명',exact:true}).focus(); await retain(); await hide();
      server.offline.add('travel-resume'); expectedAuthFailure=true; await show(); await page.locator('#lifeStartup').getByRole('button',{name:'다시 확인',exact:true}).waitFor();
      assert.equal(await page.locator('#lifeApp').isHidden(),true); assert.equal(await page.evaluate(()=>__travelDOM.input.isConnected),true);
      server.offline.delete('travel-resume'); await page.locator('#lifeStartup').getByRole('button',{name:'다시 확인',exact:true}).click(); await ready(page); expectedAuthFailure=false; await assertRetained();
    });
    await check('The resumed post preserves both original hashes and decoded pixels, legacy records, and three usable widths', async () => {
      await saved(); const hashes=await page.evaluate(async postId=>{
        const s=HaedoLife.Shell.storage,d=await s.readPhotoPost(await s.getActive(),postId);
        return Promise.all(d.photos.map(async photo=>{const bitmap=await createImageBitmap(photo.blob),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const g=c.getContext('2d');g.drawImage(bitmap,0,0);bitmap.close();const pixel=[...g.getImageData(0,0,1,1).data];return {digest:photo.digest,actual:await HaedoLife.PhotoPost.digest(photo.blob),width:c.width,height:c.height,size:photo.blob.size,pixel};}));
      },postId); assert.equal(hashes.length,2); hashes.forEach((photo,i)=>{assert.equal(photo.digest,createHash('sha256').update(Buffer.from(images[i].data,'base64')).digest('hex'));assert.equal(photo.actual,photo.digest);assert.equal(photo.width,images[i].width);assert.equal(photo.height,images[i].height);assert.equal(photo.size,Buffer.from(images[i].data,'base64').length);assert.deepEqual(photo.pixel,i?[184,137,89,255]:[52,104,92,255]);});report.originals=hashes;
      assert.deepEqual(await legacySnapshot(),baseline); assert.equal((await read()).docs.length,2);
      for(const width of [1440,820,390]){await page.setViewportSize({width,height:1000});await page.getByRole('textbox',{name:'사진 설명',exact:true}).scrollIntoViewIfNeeded();await page.evaluate(()=>document.fonts.ready);const metrics=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,inputs:[...document.querySelectorAll('.photo-editor input,.photo-editor textarea')].filter(n=>n.checkVisibility()).map(n=>({font:parseFloat(getComputedStyle(n).fontSize),height:n.getBoundingClientRect().height})),caption:document.querySelector('[aria-label="사진 설명"]').getBoundingClientRect().toJSON()}));assert(metrics.scrollWidth<=width+1);assert(metrics.inputs.every(v=>v.font>=16));assert(metrics.caption.height>=44);await page.screenshot({path:path.join(out,'retained-editor-'+width+'.png')});report.visual.push(metrics);}
    });
    await check('An actual SDK account change during held resume removes the old private DOM and rejects old storage access', async () => {
      await retain(); await hide(); authGate={entered:deferred(),release:deferred()};const gate=authGate;await show();await entered(gate);
      await page.evaluate(value=>HaedoAuth.client.auth.setSession(value),session(accounts.b)); authGate=null;gate.release.resolve();
      await page.waitForFunction(()=>!__travelDOM.editor.isConnected);assert.equal(await page.locator('.ql-editor').count(),0);
      assert.equal(await page.evaluate(async({workspaceId,postId})=>{try{await __travelDOM.storage.readPhotoPost(workspaceId,postId);return false;}catch(_){return true;}},{workspaceId,postId}),true);
      await page.evaluate(()=>HaedoLife.Shell.start()); await ready(page); const foreign=await read();assert.equal(foreign.docs.length,0);assert.equal(await page.evaluate(()=>HaedoAuth.user.id),accounts.b.id);
    });
    assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.external,[]);assert.deepEqual(report.writes,[]);assert.equal(server.writes().length,0);report.pass=true;
  } catch(error) {
    report.pass=false;report.failure={message:error.message,stack:error.stack};
    report.atFailure=await page.evaluate(()=>({hidden:document.querySelector('#lifeApp')?.hidden,mode:document.querySelector('#lifeMain')?.dataset.mode,status:document.querySelector('.photo-status')?.textContent,startup:document.querySelector('#lifeStartup')?.textContent,
      retained:!!window.__travelDOM?.editor?.isConnected,sameEditor:window.__travelDOM?.editor===document.querySelector('.ql-editor'),active:document.activeElement?.getAttribute('aria-label')||document.activeElement?.id||document.activeElement?.tagName,scrollY,expectedScroll:window.__travelDOM?.scrollY,scrollHeight:document.documentElement.scrollHeight,lifecycle:window.__travelLifecycle})).catch(()=>null);
    await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;
  }
  finally { if(authGate)authGate.release.resolve();await context.close();await browser.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)); }
  console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,visual:report.visual.length,errors:report.pageErrors.length,writes:report.writes.length,report:path.join(out,'report.json')},null,2));
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});

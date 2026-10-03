/* Protected platform integration with real SDK/IndexedDB/SW and anonymous HTTP.
 * SITE_DIR must be an output of scripts/prepare-site.mjs with test public config.
 * OLD_SITE_DIR optionally supplies the preserved Cloud v50 static fixture.
 * This does not authenticate with Google or prove production RLS/Apple behavior.
 */
'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const site=process.env.SITE_DIR;
if(!site)throw new Error('Set SITE_DIR to the prepared anonymous static site.');
const oldSite=process.env.OLD_SITE_DIR;
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.sql':'text/plain'};
let currentSite=site;
const web=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost'),name=decodeURIComponent(url.pathname);
    const relative=name==='/'?'index.html':name.slice(1);
    if(relative.split('/').includes('..') || !(relative.startsWith('assets/')||relative.startsWith('vendor/')||relative.startsWith('supabase/migrations/')||/^[\w-]+\.(html|js|svg|webmanifest)$/.test(relative))) {res.writeHead(404);res.end();return;}
    const content=await fs.readFile(path.join(currentSite,relative));
    res.writeHead(200,{'content-type':mime[path.extname(relative)]||'application/octet-stream','cache-control':'no-store'});res.end(content);
  }catch(_){res.writeHead(404);res.end();}
});
let passed=0;const failures=[],errors=[];let expectedErrors=0;
async function check(name,fn){try{await fn();passed++;console.log(`PASS ${name}`);}catch(error){failures.push(name);console.error(`FAIL ${name}\n${error.stack}`);}}
async function main(){
  await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));
  process.env.BASE_URL=`http://127.0.0.1:${web.address().port}`;
  const {FakeCloud,platformContext,accounts,cloud,base}=require('./life-sync-browser.cjs');
  const pw=require(process.env.PW_MODULE_PATH||'/opt/codex/cua_node/lib/node_modules/playwright');
  const browser=await pw.chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const server=new FakeCloud(),contexts=[];
  function observe(page){
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{
      if(message.type()!=='error')return;
      if(page.expectedTransport && message.location().url.startsWith(cloud) && /Failed to load resource:.*(ERR_INTERNET_DISCONNECTED|status of 400)/.test(message.text()))expectedErrors++;
      else errors.push(message.text());
    });
  }
  async function context(name,seed=null){
    const value=await browser.newContext({acceptDownloads:true,viewport:{width:1180,height:900}});contexts.push(value);
    await platformContext(value,server,name,seed);
    await value.addInitScript(()=>{
      window.__productDbOpens=[];const original=IDBFactory.prototype.open;
      IDBFactory.prototype.open=function(...args){__productDbOpens.push({name:args[0],verified:!!globalThis.HaedoAuth?.user});return original.apply(this,args);};
    });
    return value;
  }
  const settle=page=>page.waitForFunction(()=>!document.querySelector('.life-app[aria-busy="true"]'));
  async function click(page,name){await page.getByRole('button',{name,exact:true}).click();await settle(page);}
  async function ready(page){await page.waitForFunction(()=>globalThis.HaedoLife?.Shell?.storage && !document.querySelector('#lifeApp').hidden);await page.evaluate(()=>HaedoLife.Shell.ready);}
  async function login(page,device,account){
    server.oauthAccounts.set(device,account);
    await page.goto(`${base}/login.html?next=life.html`);
    await page.locator('#googleLogin').click();
    await page.waitForURL('**/life.html');await ready(page);
    assert.equal(await page.evaluate(()=>HaedoAuth.user.id),account.id);
  }
  const stored=page=>page.evaluate(async()=>HaedoLife.Shell.storage.read(await HaedoLife.Shell.storage.getActive()));
  async function importText(page,title,text,quote){
    await click(page,'가져오기');await page.locator('#lifeImportTitle').fill(title);await page.locator('#lifeImportText').fill(text);await click(page,'원문·출처 확인');
    if(quote){
      await page.locator('#lifeReviewText').evaluate((el,quote)=>{const start=el.value.indexOf(quote);el.focus();el.setSelectionRange(start,start+quote.length);el.dispatchEvent(new Event('select',{bubbles:true}));},quote);
      await page.locator('#lifeExcerptTopic').fill('통합 검토');await click(page,'발췌 후보 추가');await click(page,'선택한 발췌 모음에 반영');
    }else await click(page,'자료만 보관');
  }
  try{
    const ctx=await context('platform'),page=await ctx.newPage();page.setDefaultTimeout(15000);observe(page);
    let unownedId,accountAId,backup;
    await check('public home and anonymous private routes never mount account storage',async()=>{
      await page.goto(`${base}/index.html`);
      assert.equal(await page.locator('body[data-page="home"]').count(),1);
      await page.goto(`${base}/life.html?view-only=1`);
      await page.waitForFunction(()=>globalThis.HaedoLife?.Shell);
      await page.evaluate(()=>HaedoLife.Shell.ready);
      assert.deepEqual(await page.evaluate(()=>__productDbOpens),[]);
      unownedId=await page.evaluate(async()=>{
        localStorage.setItem('caeyeon_life_registry',JSON.stringify({current:'anonymous-old',docs:[{id:'anonymous-old',name:'이전 미연결 연표'}]}));
        const s=HaedoLife.Storage,c=HaedoLife.Core,b=await s.createWorkspace('이전 미연결 자료');
        const p=await c.prepareImport({origin:'other',title:'계정 없는 원문',text:'이전 미연결 원문 보존'},b);
        await s.commitLocal({operationId:c.id(),workspaceId:b.workspaceId,baseRevision:b.revision,changes:c.buildImportChanges(b,p,[])});
        return b.workspaceId;
      });
      for(const target of ['life.html','timeline.html']){
        await page.goto(`${base}/${target}`);await page.waitForURL('**/login.html?next=*');
        assert.deepEqual(await page.evaluate(()=>__productDbOpens),[]);
      }
    });
    await check('Google-button PKCE HTTP fixture opens verified A scope without automatic upload',async()=>{
      await login(page,'platform',accounts.a);
      const b=await stored(page);accountAId=b.workspaceId;
      assert.equal(b.sources.length,0);assert.notEqual(accountAId,unownedId);
      const spaces=await page.evaluate(()=>HaedoLife.Shell.storage.listWorkspaces());assert.ok(!spaces.some(w=>w.workspaceId===unownedId));
      assert.ok((await page.evaluate(()=>__productDbOpens)).every(entry=>entry.verified));
      assert.equal(server.writes().length,0);
      assert.equal(new URL(page.url()).searchParams.has('code'),false);
      assert.equal(await page.evaluate(()=>HaedoLife.Shell.sync.getAccount().userId),accounts.a.id);
    });
    await check('protected import/excerpt/source jump, reload and backup-copy restore work',async()=>{
      await importText(page,'익명 A 자료','첫 문장\n🌱 계정 A 원문 구절\n끝','🌱 계정 A 원문 구절');
      await click(page,'원문에서 보기');
      await page.waitForFunction(()=>{const el=document.querySelector('#lifeSourceText');return el?.value.slice(el.selectionStart,el.selectionEnd)==='🌱 계정 A 원문 구절';});
      await page.reload();await ready(page);assert.equal((await stored(page)).records[0].text,'🌱 계정 A 원문 구절');
      await click(page,'내보내기·사본 복원');const pending=page.waitForEvent('download');await click(page,'JSON 백업');
      backup=JSON.parse(await fs.readFile(await(await pending).path(),'utf8'));
      await page.locator('#lifeRestoreFile').setInputFiles({name:'anonymous.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await settle(page);await click(page,'새 사본으로 복원');
      const restored=await stored(page);assert.notEqual(restored.workspaceId,accountAId);accountAId=restored.workspaceId;
      assert.equal(restored.records[0].text,backup.workspace.records[0].text);
      assert.equal(server.writes().length,0,'local import/restore uploaded without consent');
      await click(page,'기기 간 동기화');await click(page,'이 작업공간 동기화 시작');
      await page.evaluate(async()=>HaedoLife.Shell.sync.syncNow(await HaedoLife.Shell.storage.getActive()));
      assert.equal(server.row(accounts.a.id,accountAId).data.records.length,1);
    });
    await check('logout/B login cannot list, read or render A and unowned data; A return restores its scope',async()=>{
      await click(page,'가져오기');await page.locator('#lifeImportTitle').fill('즉시 로그아웃 초안');await page.locator('#lifeImportText').fill('자동 보관 타이머 전 입력');
      await click(page,'로그아웃');await page.waitForFunction(()=>location.pathname.endsWith('/index.html')&&document.readyState==='complete');
      assert.doesNotMatch(await page.locator('body').innerText(),/계정 A 원문 구절/);
      await login(page,'platform',accounts.b);
      assert.equal((await stored(page)).sources.length,0);
      const rejected=await page.evaluate(async id=>{try{await HaedoLife.Shell.storage.read(id);return false;}catch(_){return true;}},accountAId);assert.equal(rejected,true);
      assert.ok(!(await page.evaluate(()=>HaedoLife.Shell.storage.listWorkspaces())).some(w=>[accountAId,unownedId].includes(w.workspaceId)));
      await importText(page,'익명 B 자료','계정 B 전용 구절');
      assert.equal(server.writes(accounts.b.id).length,0);
      await click(page,'로그아웃');await page.waitForFunction(()=>location.pathname.endsWith('/index.html')&&document.readyState==='complete');await login(page,'platform',accounts.a);
      assert.equal((await stored(page)).workspaceId,accountAId);
      assert.ok(!(await stored(page)).sourceVersions.some(v=>v.contentText==='계정 B 전용 구절'));
      const drafts=await page.evaluate(async()=>HaedoLife.Shell.storage.listStages(await HaedoLife.Shell.storage.getActive()));
      assert.ok(drafts.some(stage=>stage.input.title==='즉시 로그아웃 초안'&&stage.input.text==='자동 보관 타이머 전 입력'));
      assert.match(await page.evaluate(()=>localStorage.getItem('caeyeon_life_registry')),/이전 미연결 연표/);
    });
    await check('failed logout draft transaction restores editing and does not call shared signOut',async()=>{
      await click(page,'가져오기');await page.locator('#lifeImportTitle').fill('로그아웃 실패 보존');await page.locator('#lifeImportText').fill('저장 실패해도 유지할 익명 입력');
      const previousLogouts=server.requests.filter(r=>r.kind==='logout').length;
      await page.evaluate(()=>{
        window.__originalStagePut=IDBObjectStore.prototype.put;window.__flushAborted=0;
        IDBObjectStore.prototype.put=function(...args){const request=__originalStagePut.apply(this,args);if(this.name==='staging'&&args[0]?.input?.title==='로그아웃 실패 보존'){__flushAborted++;this.transaction.abort();}return request;};
      });
      try{
        await page.getByRole('button',{name:'로그아웃',exact:true}).click();
        await page.waitForFunction(()=>window.__flushAborted>0&&!document.querySelector('#lifeApp').hidden);
        assert.equal(await page.evaluate(()=>HaedoAuth.user.id),accounts.a.id);
        assert.equal(server.requests.filter(r=>r.kind==='logout').length,previousLogouts);
        assert.equal(await page.locator('#lifeImportText').inputValue(),'저장 실패해도 유지할 익명 입력');
        assert.ok(await page.locator('#lifeStartup').isVisible());
      }finally{await page.evaluate(()=>{IDBObjectStore.prototype.put=__originalStagePut;});}
      await click(page,'검토 내용 보관');page.once('dialog',dialog=>dialog.accept());await click(page,'이 검토 취소');
    });
    await check('offline warm local editing survives cold-load lock and online re-verification',async()=>{
      await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
      server.offline.add('platform');page.expectedTransport=true;await ctx.setOffline(true);
      try{
        await importText(page,'오프라인 보존','오프라인에서도 저장할 익명 내용');
        assert.ok((await stored(page)).sources.some(s=>s.title==='오프라인 보존'));
        await page.reload();await page.waitForFunction(()=>globalThis.HaedoLife?.Shell);await page.evaluate(()=>HaedoLife.Shell.ready);
        assert.ok(await page.locator('#lifeApp').isHidden());assert.equal(await page.evaluate(()=>HaedoLife.Shell.storage),null);
        assert.deepEqual(await page.evaluate(()=>__productDbOpens),[],'unverified cold load opened private IDB');
        assert.doesNotMatch(await page.locator('body').innerText(),/계정 A 원문 구절|오프라인에서도 저장할 익명 내용/);
      }finally{server.offline.delete('platform');await ctx.setOffline(false);page.expectedTransport=false;}
      await click(page,'다시 확인');await ready(page);
      assert.ok((await stored(page)).sources.some(s=>s.title==='오프라인 보존'));
      const cached=await page.evaluate(async()=>{
        const cache=await caches.open('haedo-v51');return(await cache.keys()).map(request=>request.url);
      });
      assert.ok(cached.length>20);assert.ok(cached.every(url=>new URL(url).origin===new URL(base).origin&&!new URL(url).search));
      assert.ok(!cached.some(url=>/auth\/|rest\/|token|code=/.test(url)));
    });
    await ctx.close();
    await check('failed callback clears credentials from address and never exposes private UI',async()=>{
      const bad=await context('bad-callback'),p=await bad.newPage();observe(p);p.expectedTransport=true;
      await p.goto(`${base}/login.html?next=life.html&code=anonymous-invalid-code&error_description=anonymous-error`);
      await p.waitForFunction(()=>globalThis.HaedoAuth);
      await p.waitForFunction(()=>!/[?&](code|access_token|refresh_token|error_description)=/.test(location.search));
      assert.equal(await p.evaluate(()=>HaedoAuth.user),null);assert.deepEqual(await p.evaluate(()=>__productDbOpens),[]);
      await bad.close();
    });
    if(oldSite)await check('preserved Cloud v50 fixture upgrades atomically to v51 without altering old local data',async()=>{
      currentSite=oldSite;
      const old=await context('upgrade'),p=await old.newPage();observe(p);
      await p.goto(`${base}/life.html`);await p.waitForFunction(()=>globalThis.HaedoLife?.Shell?.ready);await p.evaluate(()=>HaedoLife.Shell.ready);
      await p.waitForFunction(async()=>!!navigator.serviceWorker.controller&&(await caches.keys()).includes('haedo-v50'));
      const fixture=await p.evaluate(async()=>{
        const s=HaedoLife.Storage,c=HaedoLife.Core,b=await s.createWorkspace('v50 익명 원본');const prepared=await c.prepareImport({origin:'other',title:'v50 원문',text:'이전 버전 원문 유지'},b);
        await s.commitLocal({operationId:c.id(),workspaceId:b.workspaceId,baseRevision:b.revision,changes:c.buildImportChanges(b,prepared,[])});
        localStorage.setItem('caeyeon_life_registry','{"docs":[],"anonymous":"preserve-v50"}');return await s.read(b.workspaceId);
      });
      currentSite=site;await p.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update();});
      await p.waitForFunction(async()=>{const keys=await caches.keys();return keys.includes('haedo-v51')&&!keys.includes('haedo-v50');});
      await p.reload();await p.waitForURL('**/login.html?next=*');await login(p,'upgrade',accounts.a);
      assert.ok(!(await p.evaluate(()=>HaedoLife.Shell.storage.listWorkspaces())).some(w=>w.workspaceId===fixture.workspaceId));
      const original=await p.evaluate(async id=>{const db=await idb.openDB('life-tools-v1',1);try{return await db.get('bundles',id);}finally{db.close();}},fixture.workspaceId);
      assert.deepEqual(original,fixture);assert.equal(await p.evaluate(()=>localStorage.getItem('caeyeon_life_registry')),'{"docs":[],"anonymous":"preserve-v50"}');
      const runtime=await p.evaluate(async()=>{const cache=await caches.open('haedo-v51');return Promise.all(['assets/platform-auth.js','assets/platform-life-remote.js','assets/life/core.js','assets/life/storage.js','vendor/supabase/supabase.js'].map(path=>cache.match(new URL(path,location.href).href).then(Boolean)));});
      assert.ok(runtime.every(Boolean));await old.close();
    });else console.log('SKIP v50 update fixture (OLD_SITE_DIR not supplied)');
    await check('unexpected console/page errors',async()=>assert.deepEqual(errors,[]));
  }finally{await Promise.all(contexts.map(ctx=>ctx.close().catch(()=>{})));await browser.close();await new Promise(resolve=>web.close(resolve));}
  console.log(`Platform integration: ${passed} passed, ${failures.length} failed; ${expectedErrors} intentional transport/callback errors. Anonymous HTTP only; no real Google OAuth/Apple proof.`);
  if(failures.length)process.exitCode=1;
}
main().catch(error=>{console.error(error.stack);web.close();process.exitCode=1;});

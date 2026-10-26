/* Real collection UI + IndexedDB, isolated anonymous Auth interception; no production service writes. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { playwright, ready, makeContext } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, base, cloud } = require('./life-sync-browser.cjs');
const { inspect } = require('./life-workbench-browser.cjs');
const { openRecordsMenu } = require('./helpers/feature-menus.cjs');
const out = path.resolve(process.env.COLLECTION_LIBRARY_OUTPUT || '.local/collection-library');
const report = { checks: [], visual: [], errors: [], external: [], environment: 'Linux Chromium, real IndexedDB, anonymous intercepted Auth; no Apple hardware or production service access' };
const read = page => page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.readCollection(await s.getActive()); });
const go = async page => { await page.goto(base + '/index.html?section=records&view=collection'); await ready(page); await page.locator('.life-collection').waitFor(); };
const click = (page, name) => page.getByRole('button', { name, exact: true }).click();
async function save(page) { await click(page, '저장'); await page.getByRole('button', { name: '항목 수정', exact: true }).waitFor(); }
async function add(page, { title, category = 'content', type = 'book', note = '', creator = '', url = '' }) {
  await click(page, '컬렉션 항목 추가'); await click(page, '직접 입력'); await page.locator('#clCategory').selectOption(category);
  if (!(await page.locator('#clType').isDisabled())) await page.locator('#clType').selectOption(type);
  await page.locator('#clTitle').fill(title); if (await page.locator('#clCreator').count()) await page.locator('#clCreator').fill(creator);
  await page.locator('#clUrl').fill(url); await page.locator('#clTags').fill('관찰, 취향'); await page.locator('#clNote').fill(note); await save(page);
}
async function abortWrites(page, value) { await page.evaluate(value => { window.__clPut ||= IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = value ? function(...args) { const result = __clPut.apply(this,args); if(this.name==='meta' && args[0]?.key?.startsWith('collection:')) this.transaction.abort(); return result; } : __clPut; }, value); }
async function snap(page, scene, width) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await page.evaluate(() => document.fonts.ready); await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
  const fn = inspect.toString().replaceAll('.life-workbench', '.life-collection');
  const metrics = await page.evaluate('(' + fn + ')()');
  assert(!metrics.horizontalOverflow, scene + ' page overflow'); assert.deepEqual(metrics.smallTargets, [], scene + ' controls'); assert.deepEqual(metrics.smallInputs, [], scene + ' inputs'); assert.deepEqual(metrics.unnamed, [], scene + ' labels'); assert.deepEqual(metrics.contrastFailures, [], scene + ' contrast');
  await page.screenshot({ path: path.join(out, `${scene}-${width}.png`), fullPage: false }); report.visual.push({ scene, ...metrics });
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] }); report.browser = browser.version();
  const context = await makeContext(browser, new FakeCloud(), 'collection-library', accounts.a);
  context.on('page', page => { page.on('pageerror', e => report.errors.push(e.message)); page.on('console', msg => { if(msg.type()==='error') report.errors.push(msg.text()); }); });
  await context.route('**/*', route => { const origin = new URL(route.request().url()).origin; if([new URL(base).origin, cloud].includes(origin)) return route.fallback(); report.external.push(origin); return route.abort('blockedbyclient'); });
  await context.route(base + '/assets/life/storage.js', async route => {
    const response = await route.fetch();
    const hook = `\n;(()=>{const old=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...old,forAccount(...args){const actual=old.forAccount(...args);return Object.freeze({...actual,async readCollection(...args){if(window.__clReadFailure)throw new Error('검증용 조회 실패');if(window.__clHoldRead){window.__clReadEntered=true;await new Promise(resolve=>window.__clReleaseRead=()=>{window.__clHoldRead=false;resolve();});}return actual.readCollection(...args);}});}});})();`;
    await route.fulfill({response,body:await response.text()+hook});
  });
  const page = await context.newPage();
  async function check(name, fn) { await fn(); report.checks.push(name); console.log('PASS ' + name); }
  try {
    await go(page);
    let original, backup, primary;
    await check('Actual collection entry, empty state and login return route', async () => {
      assert.equal(await page.evaluate(() => HaedoAuth.safeNext('index.html?section=records&view=collection')), 'index.html?section=records&view=collection');
      await page.getByRole('button',{name:'첫 항목 추가',exact:true}).waitFor();
      for(const width of [1440,820,390]) await snap(page,'empty',width);
      original = await page.evaluate(async () => { const s=HaedoLife.Shell.storage,c=HaedoLife.Core; let b=await s.read(await s.getActive()); const p=await c.prepareImport({origin:'naver_blog',title:'보존할 원문',text:'원문\r\n정확한 구절🌱',coverage:'partial'},b); await s.commitLocal({workspaceId:b.workspaceId,baseRevision:b.revision,operationId:c.id(),changes:c.buildImportChanges(b,p,[])}); return {bundle:await s.read(b.workspaceId),workbench:await s.readWorkbench(b.workspaceId)}; });
    });
    await check('Register, reload, search and edit preserve literal Korean metadata', async () => {
      await add(page,{title:'일상의 작은 발견',note:'비공개 생각\r\n🌱',creator:'익명 저자',url:'https://example.org/book'}); primary=(await read(page)).items[0].id;
      await go(page); await page.locator('#clQuery').fill('익명'); assert.equal(await page.locator('.cl-card').count(),1);
      await page.locator('.cl-card').click(); await click(page,'항목 수정'); await page.locator('#clyear').fill('2020년경'); await page.locator('#clNote').fill('수정한 생각\n🌱'); await save(page);
      await go(page); const state=await read(page); assert.equal(state.items[0].details.year,'2020년경'); assert.equal(state.items[0].note,'수정한 생각\n🌱');
      await page.locator('#clQuery').fill('<script>'); assert.equal(await page.locator('.cl-card').count(),0); await click(page,'검색·분류 초기화');
      assert.equal(await page.locator('#clQuery').evaluate(el=>el===document.activeElement),true);
    });
    await check('Storage failure keeps form input and blocks navigation until saved', async () => {
      await page.locator('.cl-card').first().click(); await click(page,'항목 수정'); await page.locator('#clNote').fill('실패해도 지킬 입력');
      await abortWrites(page,true); await click(page,'저장'); await page.locator('#clError:not([hidden])').waitFor(); assert.equal(await page.locator('#clNote').inputValue(),'실패해도 지킬 입력'); assert.equal((await read(page)).items[0].note,'수정한 생각\n🌱');
      await page.locator('[data-haedo-section=home]').click(); assert.equal(await page.locator('#clNote').inputValue(),'실패해도 지킬 입력');
      await snap(page,'save-error',390); await abortWrites(page,false); await save(page); assert.equal((await read(page)).items[0].note,'실패해도 지킬 입력');
    });
    await check('Two-tab conflict compares latest and saves input as a separate copy', async () => {
      const second=await context.newPage(); await go(second);
      await click(page,'항목 수정'); await page.locator('#clNote').fill('첫 탭에서 남긴 생각');
      await second.locator('.cl-card').first().click(); await click(second,'항목 수정'); await second.locator('#clNote').fill('둘째 탭의 최신 생각'); await save(second);
      await click(page,'저장'); await page.getByRole('button',{name:'내 입력을 새 사본으로 저장',exact:true}).waitFor(); assert.equal(await page.locator('#clNote').inputValue(),'첫 탭에서 남긴 생각');
      await click(page,'내 입력을 새 사본으로 저장'); await page.getByRole('button',{name:'항목 수정',exact:true}).waitFor();
      const state=await read(page); assert.equal(state.items.find(i=>i.id===primary).note,'둘째 탭의 최신 생각'); assert(state.items.some(i=>i.id!==primary&&i.note==='첫 탭에서 남긴 생각')); await second.close();
    });
    await check('Archive and restore preserve the item identity and private note', async () => {
      const selected=(await read(page)).items[0]; await page.locator('.cl-files summary').click(); await click(page,'항목 보관');
      assert.equal((await read(page)).items.find(i=>i.id===selected.id).archived,true);
      await click(page,'보관한 항목 보기'); await page.locator('.cl-card').click(); await page.locator('.cl-files summary').click(); await click(page,'목록에 다시 표시');
      assert.equal((await read(page)).items.find(i=>i.id===selected.id).archived,false); await go(page);
    });
    await check('Download and recover valid backup as new identities without overwriting', async () => {
      await page.locator('.cl-files summary').click(); const downloading=page.waitForEvent('download'); await click(page,'컬렉션 백업 받기'); const file=await downloading; backup=JSON.parse(await fs.readFile(await file.path(),'utf8'));
      assert.equal(backup.format,'life-collection-backup-v1'); const before=await read(page);
      await page.locator('#clRestoreFile').setInputFiles({name:'collection.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))}); await abortWrites(page,true); await click(page,'새 항목 사본으로 복구'); await page.locator('#clError:not([hidden])').waitFor(); assert.deepEqual(await read(page),before); await abortWrites(page,false); await click(page,'새 항목 사본으로 복구');
      const after=await read(page); assert.equal(after.items.length,before.items.length*2); assert.deepEqual(after.items.slice(0,before.items.length),before.items); assert.equal(new Set(after.items.map(i=>i.id)).size,after.items.length);
      await go(page); assert.equal((await read(page)).items.length,after.items.length);
    });
    await check('Invalid and oversized backup cannot replace saved entries', async () => {
      const before=await read(page); await page.locator('.cl-files summary').click();
      for(const [name,text] of [['invalid.json','{"format":"life-backup-v1"}'],['oversize.json','x'.repeat(2*1024*1024+1)]]) { await page.locator('#clRestoreFile').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(text)}); await page.locator('#clError:not([hidden])').waitFor(); assert.deepEqual(await read(page),before); assert.equal(await page.getByRole('button',{name:'새 항목 사본으로 복구',exact:true}).count(),0); }
    });
    await check('Account and workspace boundaries reject cross-account access; source and workbench remain unchanged', async () => {
      const harness='/__collection_harness__.html'; await context.route(base+harness,r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><script src="/vendor/idb/idb.js"></script><script src="/assets/life/core.js"></script><script src="/assets/life/collection.js"></script><script src="/assets/life/storage.js"></script>'}));
      const p=await context.newPage(); await p.goto(base+harness);
      const boundaries=await p.evaluate(async ({workspaceId,backup,projectUrl})=>{
        const s=HaedoLife.Storage.forAccount({projectUrl, userId:'other-account'}); let readCode,writeCode;
        try{await s.readCollection(workspaceId);}catch(e){readCode=e.code;}
        try{await s.saveCollection(workspaceId,HaedoLife.Collection.empty(workspaceId),0);}catch(e){writeCode=e.code;}
        const own=await s.createWorkspace('다른 계정의 사본'); const initial=await s.readCollection(own.workspaceId); const copy=HaedoLife.Collection.appendBackup(initial,backup,()=>HaedoLife.Core.id()); await s.saveCollection(own.workspaceId,copy,0);
        const ownItems=(await s.readCollection(own.workspaceId)).items; s.dispose(); let closed;try{await s.readCollection(own.workspaceId);}catch(e){closed=e.code;} return {readCode,writeCode,count:ownItems.length,closed};
      },{workspaceId:original.bundle.workspaceId,backup,projectUrl:cloud});
      assert.equal(boundaries.readCode,'workspace_access_denied'); assert.equal(boundaries.writeCode,'workspace_access_denied'); assert.equal(boundaries.count,backup.items.length); assert.equal(boundaries.closed,'storage_scope_closed'); await p.close();
      const snapshot=await page.evaluate(async id=>({bundle:await HaedoLife.Shell.storage.read(id),workbench:await HaedoLife.Shell.storage.readWorkbench(id)}),original.bundle.workspaceId); assert.deepEqual(snapshot,original);
    });
    await check('Mixed Korean collection, filters, keyboard, many entries and three viewport widths', async () => {
      await go(page);
      await page.evaluate(async () => {const s=HaedoLife.Shell.storage,C=HaedoLife.Collection;let value=await s.readCollection(await s.getActive());const names={music:'밤에 다시 듣는 음악',book:'오래 쓰는 도구를 만드는 사람들의 생각과 선택에 관한 아주 긴 책 제목',film:'비가 그친 자리',video:'작은 작업실에서 만든 첫 번째 앱',article:'좋은 도구는 왜 다시 열게 되는가',artwork:'창가의 정물',tool:'작은 지도',person:'서윤',place:'동네의 조용한 서점',other:'다음에 다시 살펴볼 것'};let n=0;for(const [type,title] of Object.entries(names).reverse()){value.items.unshift({id:HaedoLife.Core.id(),type,title,creator:type==='person'?'':'익명 창작자',url:'https://example.org/'+type,note:'취향과 관찰을 남기는 익명 메모입니다. '+ ++n,tags:['관찰'],details:type==='person'?{field:'회화·드로잉'}:{},archived:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});}await s.saveCollection(value.workspaceId,value,value.revision);});
      await go(page);
      for(const width of [1440,820,390]) { await snap(page,'library',width); await click(page,'메모 보기'); await snap(page,'notes',width); await click(page,'표지 보기'); }
      await page.locator('[data-category=content]').click(); await page.locator('[data-type=film]').focus(); await page.keyboard.press('Enter'); assert.equal(await page.locator('.cl-card').count(),1);
      await page.locator('[data-category=people]').click(); assert.equal(await page.locator('.cl-card').count(),1); await page.locator('.cl-card').click(); assert.match(await page.locator('.cl-metadata').textContent(),/회화/);
      await click(page,'항목 수정'); assert.equal(await page.locator('#clCreator').count(),0); await snap(page,'person-editor',390); await click(page,'편집 취소'); await click(page,'컬렉션 목록으로');
      await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,c=HaedoLife.Collection,value=await s.readCollection(await s.getActive());const first=value.items[0];for(let i=0;i<100;i++)value.items.push({...c.clone(first),id:HaedoLife.Core.id(),title:'많은 자료 '+i});await s.saveCollection(value.workspaceId,value,value.revision);});await go(page);assert.equal(await page.locator('.cl-card').count(),40);await click(page,'40개 더 보기');assert.equal(await page.locator('.cl-card').count(),80);
    });
    await check('Pending reads cannot block navigation or paint into another section; failed reads allow retry', async () => {
      await click(page,'자료실로 돌아가기'); await openRecordsMenu(page); await page.evaluate(()=>{window.__clHoldRead=true;});
      await click(page,'컬렉션'); await page.waitForFunction(()=>window.__clReadEntered);
      await page.getByText('컬렉션을 불러오는 중…',{exact:true}).waitFor();
      for(const width of [1440,820,390]) { await page.setViewportSize({width,height:900}); await page.screenshot({path:path.join(out,`loading-${width}.png`)}); }
      await page.locator('[data-haedo-section=home]').click(); await page.waitForFunction(()=>document.querySelector('.life-main')?.dataset.mode==='home');
      await page.evaluate(()=>window.__clReleaseRead()); assert.equal(await page.locator('.life-collection').count(),0);
      await page.locator('[data-haedo-section=records]').click(); await page.waitForFunction(()=>document.querySelector('.life-main')?.dataset.mode==='collection');
      await page.locator('#clGrid').waitFor(); await click(page,'자료실로 돌아가기');
      await openRecordsMenu(page); await page.evaluate(()=>{window.__clReadFailure=true;}); await click(page,'컬렉션'); await page.getByRole('button',{name:'컬렉션 다시 불러오기',exact:true}).waitFor();
      for(const width of [1440,820,390]) await snap(page,'read-error',width);
      await page.evaluate(()=>{window.__clReadFailure=false;}); await click(page,'컬렉션 다시 불러오기'); await page.locator('#clGrid').waitFor();
    });
    await check('IME composition does not submit, workspace switching does not mix collections, and management exposes backup scope', async () => {
      await click(page,'컬렉션 항목 추가'); await click(page,'직접 입력'); await page.locator('#clTitle').fill('한글 조합 중');
      const before=await read(page); await page.locator('#clTitle').dispatchEvent('compositionstart');
      await page.locator('#clForm').dispatchEvent('submit'); assert.deepEqual(await read(page),before);
      await page.locator('#clTitle').dispatchEvent('compositionend'); await save(page); await click(page,'컬렉션 목록으로');
      const isolated=await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,id=await s.getActive();const other=await s.createWorkspace('별도 컬렉션');const items=(await s.readCollection(other.workspaceId)).items;await s.setActive(id);return {count:items.length};}); assert.equal(isolated.count,0);
      await page.locator('[data-haedo-section=manage]').click(); await click(page,'컬렉션 백업·복구'); await page.locator('#clRestoreFile').waitFor({state:'visible'});
      assert.match(await page.locator('.cl-files').innerText(),/자동 동기화되지 않습니다/);
    });
    await check('Touch viewport can add, open and return to an item', async () => {
      const touch=await makeContext(browser,new FakeCloud(),'collection-touch',accounts.a,{viewport:{width:390,height:844},hasTouch:true});
      const p=await touch.newPage();p.on('pageerror',e=>report.errors.push(e.message));
      try { await go(p); await p.getByRole('button',{name:'컬렉션 항목 추가',exact:true}).tap();await p.getByRole('button',{name:'직접 입력',exact:true}).tap(); await p.locator('#clTitle').fill('터치로 담은 음악'); await save(p); await p.getByRole('button',{name:'컬렉션 목록으로',exact:true}).tap(); await p.locator('.cl-card').tap(); await p.getByRole('button',{name:'항목 수정',exact:true}).waitFor(); await p.getByRole('button',{name:'컬렉션 목록으로',exact:true}).tap(); assert.equal(await p.locator('.cl-card').evaluate(el=>el===document.activeElement),true); }
      finally { await touch.close(); }
    });
    assert.deepEqual(report.errors,[]); assert.deepEqual(report.external,[]);
  } finally { await browser.close(); await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)); }
  console.log('Collection library: '+report.checks.length+' journeys, '+report.visual.length+' viewport states.');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});

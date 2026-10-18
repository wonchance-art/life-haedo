'use strict';
const { openSearch } = require('./search-navigation.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {playwright,makeContext,ready,nav}=require('./unified-home-browser.cjs');
const {FakeCloud,accounts,cloud,base}=require('./life-sync-browser.cjs');
const {inspect}=require('../scripts/check-site-design.cjs');
const out=path.resolve('.local/nine-board-search'),report={checks:[],visual:[],errors:[],consoleErrors:[],external:[],scope:'Anonymous account-scoped IndexedDB and Linux Chromium; Apple hardware and production installation unverified.'};
async function fixture(page){return page.evaluate(async()=>{
 const s=HaedoLife.Shell.storage,c=HaedoLife.Core,M=HaedoLife.NineBoard,id=await s.getActive();
 const state=await s.readNineBoard(id),first=M.create(c.id);first.title='다른 구성';state.boards.push(first);
 const board=M.create(c.id);board.title='산책의 작은 발견들';board.intro='나에게 오래 남겨 둘 것들을 천천히 고른다. 🌱';
 board.areas=['읽을 문장','들으며 걷기','다시 볼 작품'].map((title,index)=>({id:c.id(),title,note:index===1?'느린 관찰의 리듬':'함께 기억할 질문',items:Array.from({length:9},(_,i)=>({attachment:{type:index===1?'music':'book',title:title+' — 나에게 돌아오는 이야기 '+(i+1),creator:'익명 창작자',url:'https://example.org/original?area='+index+'&item='+i},reason:index===1&&i===6?'🌱 오래 좋아할 기준\r\n산책하며 다시 떠올린 이유.':'산책에서 다시 생각할 문장 '+(i+1)}))}));state.boards.push(board);await s.saveNineBoard(id,state,state.revision);
 const wb=await s.readWorkbench(id),post=HaedoLife.PagePosts.draft([],c.id(),new Date().toISOString());post.body='산책에서 기록한 저장 글';wb.page.posts=HaedoLife.PagePosts.finish([post],post.id,new Date().toISOString()).posts;await s.saveWorkbench(id,wb,wb.revision);
 return {id,boardId:board.id,areaId:board.areas[1].id,itemIndex:6,postId:post.id};
});}
async function main(){
 await fs.mkdir(out,{recursive:true});const browser=await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});report.browser=browser.version();
 const context=await makeContext(browser,new FakeCloud(),'nine-search',accounts.a,{viewport:{width:1440,height:1000},hasTouch:true});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if([new URL(base).origin,cloud].includes(u.origin))return route.fallback();report.external.push(u.origin);return route.abort();});
 const page=await context.newPage(),other=await context.newPage();page.setDefaultTimeout(12000);
 for(const p of [page,other]){p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});}
 const check=async(name,action)=>{await action();report.checks.push(name);console.log('PASS '+name);};
 const click=name=>page.getByRole('button',{name,exact:true}).click(),wait=()=>page.locator('#lifeFind[aria-busy=false]').waitFor(),query=text=>page.locator('#lifeFindQuery').fill(text);
 const result=()=>page.locator('[data-focus-key][data-kind=nine]');
 const open=async()=>{await nav(page,'home');await openSearch(page);await wait();};
 const back=async()=>{await click('검색 결과로 돌아가기');await wait();};
 const snapshot=()=>page.evaluate(async()=>{const s=HaedoLife.Shell.storage,id=await s.getActive();return {nine:await s.readNineBoard(id),bundle:await s.read(id),wb:await s.readWorkbench(id),cl:await s.readCollection(id),drafts:await s.readPageDrafts(id)};});
 const change=action=>other.evaluate(async action=>{const s=HaedoLife.Shell.storage,id=await s.getActive(),v=await s.readNineBoard(id),b=v.boards[1],a=b.areas[1];
  if(action==='reorder')a.items.reverse();if(action==='note')a.note='변경된 영역 설명';if(action==='remove')b.areas=b.areas.filter(x=>x.id!==a.id);
  await s.saveNineBoard(id,v,v.revision);
 },action);
 const snap=async scene=>{for(const width of [1440,820,390]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation=>animation.finished.catch(()=>{}))));const metrics=await page.evaluate(inspect);report.visual.push({scene,width,metrics});assert.equal(metrics.horizontalOverflow,false);for(const key of ['smallTargets','smallInputs','unnamed','contrastFailures'])assert.deepEqual(metrics[key],[],scene+' '+width+' '+key);await page.screenshot({path:path.join(out,scene+'-'+width+'.png')});}};
 let f,before;
 try{
  await page.goto(base+'/index.html');await ready(page);f=await fixture(page);before=await snapshot();await other.goto(base+'/index.html');await ready(other);await open();
  await check('Stored board root opens the chosen board overview and returning preserves exact result focus',async()=>{
   await query('작은 발견들');assert.equal(await result().count(),1);const key=await result().getAttribute('data-focus-key');await result().focus();await page.keyboard.press('Enter');await page.locator('.nb-areas > section').first().waitFor();assert.equal(await page.locator('#nbSelect').inputValue(),f.boardId);assert.equal(await page.locator('.nb-areas > section').count(),3);assert.equal(await page.locator('#nbTitle').count(),0);await snap('board-overview');await back();await page.waitForFunction(key=>document.activeElement?.dataset.focusKey===key,key);assert.equal(await page.locator('#lifeFindQuery').inputValue(),'작은 발견들');assert.deepEqual(await snapshot(),before);
  });
  await check('Area description and spaced Korean reason open the exact area and item with the reason visible',async()=>{
   await query('느린 관찰');await result().click();await page.getByRole('heading',{name:'들으며 걷기',exact:true}).waitFor();assert.match(await page.locator('.nb-display').textContent(),/느린 관찰의 리듬/);await back();
   await page.getByText('검색 범위·옵션',{exact:true}).click();await page.getByRole('checkbox',{name:'한글 띄어쓰기 무시',exact:true}).check();await query('오래좋아할기준');assert.equal(await result().count(),1);await result().tap();const cell=page.locator('.nb-grid [data-item-index="6"]');await cell.waitFor();await page.waitForFunction(()=>document.activeElement?.dataset.itemIndex==='6');assert.match(await cell.textContent(),/오래 좋아할 기준/);assert.equal(await cell.locator('.nb-reason').getAttribute('open'),'');assert.equal(await cell.locator('a').getAttribute('href'),'https://example.org/original?area=1&item=6');await snap('exact-reason');await back();assert.equal(await page.locator('#lifeFindQuery').inputValue(),'오래좋아할기준');assert.deepEqual(await snapshot(),before);
  });
  await check('All saved items are searchable; kind, expanded limit and focus survive return without persisting the query',async()=>{
   await query('산책');assert.equal(await result().count(),5);await page.locator('.life-find-tabs [data-kind=nine]').click();assert.equal(await result().count(),20);await click('9칸 구성 20개 더 보기');assert.equal(await result().count(),28);const key=await result().nth(25).getAttribute('data-focus-key');await result().nth(25).click();await page.locator('.nb-grid').waitFor();await back();assert.equal(await result().count(),28);await page.waitForFunction(key=>document.activeElement?.dataset.focusKey===key,key);assert.equal(await page.locator('.life-find-tabs [data-kind=nine]').getAttribute('aria-pressed'),'true');assert(!page.url().includes(encodeURIComponent('산책')));assert.deepEqual(await snapshot(),before);await page.evaluate(()=>scrollTo(0,0));await snap('search-results');
  });
  await check('A two-tab reorder invalidates the item snapshot and offers reload; changed and removed areas never open replacements',async()=>{
   await query('오래좋아할기준');await change('reorder');await page.locator('#lifeFindReload').waitFor({state:'visible'});await result().click();await page.locator('#lifeError:not([hidden])').waitFor();assert.equal(await page.locator('#lifeFind').count(),1);assert.match(await page.locator('#lifeError').textContent(),/다시 불러와/);await click('변경된 자료 다시 읽기');await wait();assert.equal(await page.locator('#lifeError').isHidden(),true);await result().click();await page.waitForFunction(()=>document.activeElement?.dataset.itemIndex==='2');await back();
   await query('느린 관찰');await change('note');await result().click();await page.locator('#lifeError:not([hidden])').waitFor();assert.equal(await page.locator('.nb-grid').count(),0);await click('변경된 자료 다시 읽기');await wait();assert.equal(await result().count(),0);await query('들으며 걷기');await change('remove');await result().first().click();await page.locator('#lifeError:not([hidden])').waitFor();assert.equal(await page.locator('#lifeFind').count(),1);await click('변경된 자료 다시 읽기');await wait();assert.equal(await result().count(),0);
  });
  await check('An aborted save sends no change notice; a committed save does, and a board read failure retains page results',async()=>{
   await query('산책');assert.equal(await page.locator('#lifeFindReload').isHidden(),true);
   await other.evaluate(async()=>{const s=HaedoLife.Shell.storage,id=await s.getActive(),v=await s.readNineBoard(id),put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const r=put.apply(this,args);if(args[0]?.key?.startsWith('nine-board:'))this.transaction.abort();return r;};try{v.boards[0].title='실패한 변경';await s.saveNineBoard(id,v,v.revision);throw Error('unexpected save');}catch(e){if(e.message==='unexpected save')throw e;}finally{IDBObjectStore.prototype.put=put;}});
   await page.waitForTimeout(150);assert.equal(await page.locator('#lifeFindReload').isHidden(),true);
   await other.evaluate(async()=>{const s=HaedoLife.Shell.storage,id=await s.getActive(),v=await s.readNineBoard(id);v.boards[0].intro='저장한 변경';await s.saveNineBoard(id,v,v.revision);});await page.locator('#lifeFindReload').waitFor({state:'visible'});
   await page.evaluate(()=>{window.__nineGet=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(key){const r=__nineGet.call(this,key);if(String(key).startsWith('nine-board:'))this.transaction.abort();return r;};});await click('변경된 자료 다시 읽기');await wait();assert.match(await page.locator('#lifeFindStatus').textContent(),/9칸 구성/);assert.equal(await result().count(),0);await page.locator('.life-find-tabs [data-kind=all]').click();assert.equal(await page.locator('[data-focus-key][data-kind=page]').count(),1);await snap('partial-failure');await page.evaluate(()=>IDBObjectStore.prototype.get=__nineGet);await click('불러오기 다시 시도');await wait();assert(await result().count()>0);
  });
  await check('Opening saved posts after a board leaves the board; unapplied edits block return and remain on screen',async()=>{
   await query('작은 발견들');await result().click();await page.locator('.nb-areas').waitFor();await back();await query('저장 글');await page.locator('[data-focus-key][data-kind=page]').click();await page.locator('[data-post-id="'+f.postId+'"]').waitFor();assert.equal(await page.locator('.nb-workspace').count(),0);await back();
   await query('작은 발견들');await result().click();await page.locator('.nb-areas').waitFor();await click('편집하기');await page.locator('#nbAreaTitle').waitFor();await page.getByRole('button',{name:/· 수정$/}).first().click();await page.locator('#nbItemTitle').fill('아직 반영하지 않은 입력');await click('검색 결과로 돌아가기');await page.locator('#lifeError:not([hidden])').waitFor();assert.equal(await page.locator('#nbItemTitle').inputValue(),'아직 반영하지 않은 입력');await click('입력 취소');await back();assert.equal(await page.locator('#lifeFindQuery').inputValue(),'작은 발견들');await query('아직 반영하지 않은 입력');assert.equal(await result().count(),0);
   await query('작은 발견들');await result().click();await page.locator('.nb-areas').waitFor();await page.locator('.nb-files > summary').click();
   const candidate=await page.evaluate(()=>{const b=HaedoLife.NineBoard.create(HaedoLife.Core.id);b.title='가져오기 파일 후보 기밀';return HaedoLife.NineBoard.backup([b]);});
   await page.getByLabel('9칸 구성 JSON 파일',{exact:true}).setInputFiles({name:'candidate.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(candidate))});await page.locator('.nb-import').waitFor();await back();await query('가져오기 파일 후보 기밀');assert.equal(await result().count(),0);
  });
  await check('Late board reads cannot reopen a departed screen; another workspace and account cannot see the query or board',async()=>{
   await nav(page,'home');await page.evaluate(()=>{window.__nineGet=IDBObjectStore.prototype.get;window.__nineHold=true;window.__nineRelease=[];IDBObjectStore.prototype.get=function(key){const r=__nineGet.call(this,key);if(String(key).startsWith('nine-board:'))r.addEventListener('success',e=>{if(__nineHold){e.stopImmediatePropagation();__nineRelease.push(()=>r.dispatchEvent(new Event('success')));}});return r;};});await openSearch(page);await page.waitForFunction(()=>__nineRelease.length>0);await nav(page,'tools');await page.evaluate(()=>{__nineHold=false;__nineRelease.forEach(fn=>fn());IDBObjectStore.prototype.get=__nineGet;});await page.waitForTimeout(100);assert.equal(await page.locator('#lifeFind').count(),0);
   const fresh=await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,b=await s.createWorkspace('새 익명 공간');await s.setActive(b.workspaceId);return b.workspaceId;});await page.goto(base+'/index.html?section=records&view=find');await ready(page);await wait();assert.equal(await page.locator('#lifeFindQuery').inputValue(),'');await query('산책');assert.equal(await result().count(),0);assert.notEqual(fresh,f.id);
   const otherContext=await makeContext(browser,new FakeCloud(),'nine-search-b',accounts.b);const p=await otherContext.newPage();await p.goto(base+'/index.html?section=records&view=find');await ready(p);await p.locator('#lifeFind[aria-busy=false]').waitFor();assert.equal(await p.locator('#lifeFindQuery').inputValue(),'');await p.locator('#lifeFindQuery').fill('산책');assert.equal(await p.locator('[data-kind=nine][data-focus-key]').count(),0);await otherContext.close();
  });
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.external,[]);report.pass=true;
 }catch(e){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw e;}
 finally{await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

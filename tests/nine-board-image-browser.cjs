'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto'),Z=require('../vendor/fflate/fflate.js');
const {playwright,ready,makeContext}=require('./unified-home-browser.cjs');
const {FakeCloud,accounts,base,cloud}=require('./life-sync-browser.cjs');
const out=path.resolve('.local/nine-board-image'),report={checks:[],screenshots:[],errors:[],consoleErrors:[],external:[],scope:'Anonymous mocked Auth, real Mac Chrome canvas and IndexedDB; viewport simulations, no Apple touch hardware or live account.'};
async function main(){
 await fs.mkdir(out,{recursive:true});const browser=await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});report.browser=browser.version();
 const server=new FakeCloud(),publicWrites=[];
 const context=await makeContext(browser,server,'nine-board-image',accounts.a,{viewport:{width:1440,height:1000}});
 context.on('request',request=>{const u=new URL(request.url());if(!['GET','HEAD','OPTIONS'].includes(request.method())&&(/\/functions\/v1\//.test(u.pathname)||/\/rest\/v1\//.test(u.pathname)))publicWrites.push(u.pathname);});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if([new URL(base).origin,cloud].includes(u.origin))return route.fallback();report.external.push(u.origin);return route.abort();});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const go=async()=>{await page.goto(base+'/index.html?section=records&view=page');await ready(page);await page.getByRole('button',{name:'9칸 구성',exact:true}).click();await page.locator('.nb-status').waitFor();};
 const read=()=>page.evaluate(async()=>{const s=HaedoLife.Shell.storage,w=await s.getActive();return {nine:await s.readNineBoard(w),collection:await s.readCollection(w),workbench:await s.readWorkbench(w),bundle:await s.read(w),drafts:await s.readPageDrafts(w)};});
 const click=name=>page.getByRole('button',{name,exact:true}).click();
 try{
  await go();await page.evaluate(async()=>{
   const s=HaedoLife.Shell.storage,w=await s.getActive(),v=await s.readNineBoard(w),M=HaedoLife.NineBoard;
   const item=(title,type='book',url='https://example.org/source?edition=1&original=yes')=>({...M.snapshot({type,title,creator:'익명 만든 사람',url}),reason:'이미지에 자동 포함하지 않는 선택 이유'});
   const b={id:'image_board',title:'내가 고른 아홉 가지 — 한글 제목과 출처를 함께 보관',intro:'이미지에서 제외할 개인 소개',areas:[{id:'first_area',title:'첫 영역',note:'이미지에서 제외할 개인 메모',items:[item('첫 영역만의 항목')]},{id:'image_area',title:'책과 음악 · 선택한 영역',note:'이 영역 메모도 제외',items:[item('오래 읽고 다시 펼치는 한글 책의 제목이 아주 길어도 글자와 줄이 겹치지 않고 아홉 칸 안에서 읽히는지 확인하는 제목 '.repeat(3)),item('함께 걷는 노래','music',''),item('이미지가 없는 영화','film'),item('띄어쓰기없는아주긴한글제목을줄바꿈하는지확인합니다'.repeat(6)),item('짧은 책'),item('줄바꿈\n그대로 확인','other')]}]};
   b.areas[1].items[1].reference={kind:'source',value:{format:'life-source-reference-v1',workspaceId:w,sourceId:'anonymous_source',sourceVersionId:'exact_version',locator:{start:0,end:4},quote:'개인근거',contentHash:'a'.repeat(64),title:'익명 근거',sourceKey:'anonymous',url:'https://example.org/exact'}};
   v.format='life-nine-board-v2';v.boards.push(b);await s.saveNineBoard(w,v,v.revision);
  });
  await go();const original=await read();await page.locator('.nb-files > summary').click();await page.locator('#nbImageArea').selectOption('image_area');
  let event=page.waitForEvent('download');await click('선택 영역 PNG 받기');const image=await event,png=await fs.readFile(await image.path());await fs.writeFile(path.join(out,'selected-area.png'),png);
  assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),1800);assert.equal(png.readUInt32BE(20),2100);
  assert.deepEqual(await read(),original);report.checks.push('Actual UI downloads 1800×2100 PNG from selected second area without changing any stored data');
  event=page.waitForEvent('download');await click('전체 구성 JSON 백업 받기');const backup=JSON.parse(await fs.readFile(await (await event).path(),'utf8'));assert.equal(backup.boards[0].areas[1].items[1].reference.value.quote,'개인근거');
  event=page.waitForEvent('download');await click('HTML 보기 파일 받기');const html=await fs.readFile(await (await event).path(),'utf8');assert.match(html,/개인근거/);assert.match(html,/이미지에 자동 포함하지 않는 선택 이유/);
  await page.getByLabel('9칸 구성 JSON 파일',{exact:true}).setInputFiles({name:'anonymous.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.locator('.nb-import input[type=checkbox]').first().check();await click('선택한 구성 새 사본으로 추가');await page.locator('.nb-import').waitFor({state:'detached'});
  const restored=await read();assert.deepEqual(restored.nine.boards[0],original.nine.boards[0]);assert.notEqual(restored.nine.boards[1].id,original.nine.boards[0].id);assert.deepEqual(restored.nine.boards[1].areas[1].items,original.nine.boards[0].areas[1].items);for(const key of ['collection','workbench','bundle','drafts'])assert.deepEqual(restored[key],original[key]);report.checks.push('JSON/HTML retain full reasons and exact evidence; JSON restores detached copy preserving originals and other stores');
  await page.locator('.nb-files > summary').click();await page.evaluate(()=>{window.__toBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(cb){cb(null);};});await click('선택 영역 PNG 받기');await page.locator('.nb-error').waitFor({state:'visible'});assert.match(await page.locator('.nb-error').textContent(),/PNG를 만들지 못했습니다/);assert.deepEqual(await read(),restored);assert.equal(await page.locator('.nb-status').textContent(),'이 브라우저에 저장됨');
  await page.evaluate(()=>HTMLCanvasElement.prototype.toBlob=__toBlob);event=page.waitForEvent('download');await click('선택 영역 PNG 받기');await event;report.checks.push('Canvas export failure preserves all data, shows useful error and retries successfully');
  for(const width of [1440,820,390]){
   await page.setViewportSize({width,height:1000});await page.locator('.nb-image-export').scrollIntoViewIfNeeded();const name='controls-'+width+'.png';await page.screenshot({path:path.join(out,name)});report.screenshots.push(name);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const bounds=await page.locator('.nb-image-export select,.nb-image-export button').evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width})));for(const b of bounds){assert(b.height>=44);assert(b.width>=44);}
  }report.checks.push('1440,820,390px export controls have no horizontal page overflow and targets are at least 44px');console.log('PASS PNG export, restore, retry and viewport flows');
  await page.setViewportSize({width:820,height:1000});await page.goto(base+'/index.html');await ready(page);await page.locator('#homePosts[aria-busy="false"]').waitFor();
  await page.locator('[data-home-destination="write"]:visible').first().click();await page.locator('#photoTitle').fill('아홉 칸에서 시작한 비공개 글');
  const description='선택한 영역의 책과 음악을 다시 읽으며 남긴 설명입니다. 전체 내용은 JSON으로 따로 보관했습니다.\n출처: https://example.org/source?edition=1&original=yes',alt='책과 음악 여섯 항목과 빈 칸 세 개를 담은 3×3 구성';
  await page.locator('.ql-editor').fill(description);await page.evaluate(()=>{const q=Quill.find(document.querySelector('.ql-container'));q.setSelection(q.getLength()-1,0,'silent');});await page.locator('#photoFiles').setInputFiles({name:'haedo-nine-board.png',mimeType:'image/png',buffer:png});await page.locator('.photo-block img').waitFor();
  await page.locator('.photo-block img').click();await page.getByRole('textbox',{name:'사진 설명',exact:true}).fill('직접 선택한 영역 · 제목과 출처');await page.locator('.photo-settings > summary').click();await page.getByRole('textbox',{name:'사진 대체 텍스트',exact:true}).fill(alt);
  await page.waitForFunction(async expected=>{const s=HaedoLife.Shell.storage,w=await s.getActive(),rows=await s.listPhotoPosts(w),row=rows.find(r=>r.title==='아홉 칸에서 시작한 비공개 글');if(!row)return false;const doc=await s.readPhotoPost(w,row.id);return doc.ops.some(op=>op.insert?.photo?.alt===expected);},alt);assert.notEqual(await page.locator('.photo-status').getAttribute('role'),'alert');await click('사진 편집 닫기');await click('글 저장');await page.locator('.photo-article').waitFor();
  const post=await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,w=await s.getActive(),rows=await s.listPhotoPosts(w),row=rows.find(r=>r.title==='아홉 칸에서 시작한 비공개 글');if(!row)throw Error('PNG post was not saved');return s.readPhotoPost(w,row.id);});
  assert.equal(post.status,'saved');assert.equal(post.photos.length,1);assert.equal(post.photos[0].width,1800);assert.equal(post.photos[0].height,2100);assert.equal(post.photos[0].digest,createHash('sha256').update(png).digest('hex'));assert(post.ops.some(op=>op.insert?.photo?.alt===alt));assert(post.ops.map(op=>typeof op.insert==='string'?op.insert:'').join('').includes(description));
  assert(!JSON.stringify(post.ops).includes('개인근거'));assert(!JSON.stringify(post.ops).includes('이미지에 자동 포함하지 않는 선택 이유'));assert.deepEqual(await read(),restored);
  await page.goto(base+'/index.html');await ready(page);await page.locator('#homePosts[aria-busy="false"]').waitFor();const row=page.locator('#homePosts [data-photo-post-id="'+post.id+'"]');await row.locator('.home-post-open').click();await page.locator('.photo-article').waitFor();await page.waitForFunction(()=>document.querySelector('.photo-read-image img')?.naturalWidth===1800);
  assert.match(await page.locator('.photo-article').innerText(),/선택한 영역의 책과 음악/);assert.equal(await page.locator('.photo-read-image img').getAttribute('alt'),alt);
  event=page.waitForEvent('download');await click('사진 포함 백업');const zip=await fs.readFile(await (await event).path());await fs.writeFile(path.join(out,'png-post-backup.zip'),zip);const files=Z.unzipSync(zip),manifest=JSON.parse(Z.strFromU8(files['manifest.json']));
  assert.equal(manifest.photos.length,1);const photo=manifest.photos[0],originalPng=Buffer.from(files['photos/'+photo.id]);assert.equal(photo.width,1800);assert.equal(photo.height,2100);assert.deepEqual(originalPng,png);assert.deepEqual(manifest.ops,post.ops);assert.equal(photo.digest,post.photos[0].digest);assert.deepEqual(await read(),restored);
  assert.deepEqual(publicWrites,[]);assert.equal(server.requests.filter(r=>r.kind==='write').length,0);report.remoteWrites=publicWrites.length;report.syncWrites=server.requests.filter(r=>r.kind==='write').length;await page.screenshot({path:path.join(out,'png-post-reopened-820.png'),fullPage:true});report.screenshots.push('png-post-reopened-820.png');report.checks.push('Downloaded PNG attaches through home writer with editable description/source/alt, saves privately, reopens and exports ZIP with byte-identical 1800×2100 PNG; no public or remote writes');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.external,[]);
 }catch(error){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw error;}
 finally{await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await context.close();await browser.close();}
 console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});

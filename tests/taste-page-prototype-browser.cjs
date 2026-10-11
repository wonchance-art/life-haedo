'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const{chromium}=require(process.env.PW_MODULE_PATH||'./browser-ci/node_modules/playwright');
const base=process.env.BASE_URL||'http://127.0.0.1:4189',out=path.resolve(process.env.TASTE_PAGE_OUTPUT||'docs/design-review/evidence/taste-page');
(async()=>{
 await fs.mkdir(out,{recursive:true});const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext(),page=await context.newPage(),errors=[],external=[],checks=[],ratios=[];
 context.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await context.route('**/*',r=>{if(new URL(r.request().url()).origin!==new URL(base).origin){external.push(r.request().url());return r.abort();}return r.continue();});
 const check=(label,v)=>{assert.ok(v,label);checks.push(label);};
 const shot=async name=>{await page.mouse.move(0,0);await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});};
 async function inspect(){
  const spills=await page.locator('.media-frame').evaluateAll(ns=>ns.filter(n=>{const a=n.getBoundingClientRect(),b=n.firstElementChild.getBoundingClientRect();return a.width&&(b.left<a.left-1||b.right>a.right+1||b.top<a.top-1||b.bottom>a.bottom+1);}).length);
  assert.equal(spills,0,'media frame contains artwork with editor open or closed');
  const bookRatios=await page.locator('.art.book').evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect()).filter(r=>r.width).map(r=>r.width/r.height));
  assert.ok(bookRatios.every(r=>Math.abs(r-2/3)<.015),'portrait book ratio remains 2:3: '+JSON.stringify({width:page.viewportSize().width,layout:await page.locator('#page').getAttribute('data-layout'),bookRatios}));
  const result=await page.evaluate(()=>{
   const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number),lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
   const visible=n=>n.getBoundingClientRect().width>0&&getComputedStyle(n).visibility!=='hidden';
   const textRatios=[...document.querySelectorAll('body *')].filter(n=>visible(n)&&!n.closest('button:disabled')&&[...n.childNodes].some(c=>c.nodeType===3&&c.textContent.trim())).map(n=>{const f=rgb(getComputedStyle(n).color);let bg=[255,255,255];for(let p=n;p;p=p.parentElement){const c=rgb(getComputedStyle(p).backgroundColor);if(c.length===3||c[3]===1){bg=c;break;}}const a=lum(f),b=lum(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});
   return{overflow:document.documentElement.scrollWidth>innerWidth,small:[...document.querySelectorAll('button,select,textarea,a,.toggle')].filter(n=>visible(n)&&!n.classList.contains('skip')&&n.getBoundingClientRect().height<43.5).map(n=>n.id||n.textContent),tinyInputs:[...document.querySelectorAll('input:not([type=checkbox]),textarea,select')].filter(n=>visible(n)&&parseFloat(getComputedStyle(n).fontSize)<16).length,textRatios};
  });assert.equal(result.overflow,false);assert.deepEqual(result.small,[]);assert.equal(result.tinyInputs,0);assert.ok(result.textRatios.every(x=>x>=4.5),'text contrast >=4.5, min '+Math.min(...result.textRatios));ratios.push(...result.textRatios);
 }
 const open=async()=>{await page.locator('#customize').click();await page.locator('#editor').waitFor({state:'visible'});};
 const close=async()=>page.locator('#closeEditor').click();
 try{
 await page.goto(base+'/docs/prototypes/taste-page/');await page.locator('#featuredAlbum .object').waitFor();
 check('fictional cover asset loaded',await page.evaluate(async()=>{const i=new Image();i.src='media/cover-studies.png';await i.decode();return i.naturalWidth>1000;}));
 for(const width of[1440,820,390]){
  await page.setViewportSize({width,height:width===390?844:1000});
  for(const layout of['gallery','editorial','archive']){await open();await page.locator(`[data-layout-choice="${layout}"]`).click();await close();await inspect();await shot(`${layout}-${width}`);}
  checks.push('three layouts, readable Korean, 44px targets, contrast at '+width);
 }
 await open();await page.locator('[data-layout-choice="gallery"]').click();await page.locator('#titleInput').fill('음악과 책, 오래 쓰는 도구에 관하여');await page.locator('#descriptionInput').fill('커스터마이징한 소개입니다.');await page.locator('#noteInput').fill('내가 직접 고른 이유를 남깁니다.');
 await page.locator('#accentInput').selectOption('violet');await page.locator('#paperInput').selectOption('warm');await page.locator('#fontInput').selectOption('serif');await page.locator('#densityInput').selectOption('close');await page.locator('#albumInput').selectOption('m2');await inspect();await shot('editor-390');
 await page.locator('#editorPreview').click();check('preview preserves edited title',await page.locator('#pageTitle').textContent()==='음악과 책, 오래 쓰는 도구에 관하여');check('chosen album shown',await page.locator('#featuredAlbum [data-item="m2"]').count()===1);check('preview is explicitly private',await page.locator('#previewBar').textContent().then(t=>t.includes('게시하지 않음')));await inspect();await shot('custom-preview-390');
 await page.locator('#returnEdit').click();check('preview returns focus',await page.locator('#customize').evaluate(n=>n===document.activeElement));await open();check('fields survive preview',await page.locator('#noteInput').inputValue()==='내가 직접 고른 이유를 남깁니다.');
 await page.locator('#noteToggle').uncheck();await page.locator('#metadataToggle').uncheck();await close();check('note and metadata hidden only in presentation',await page.locator('#personalNote').isHidden()&&await page.locator('#featuredAlbum .object-creator').isHidden());
 await page.locator('#undo').click();check('undo restores metadata',await page.locator('#featuredAlbum .object-creator').isVisible());
 await open();await page.locator('#swapSections').click();await close();check('section order changes',await page.locator('#sections>section').first().getAttribute('id')==='collectionSection');
 await open();await page.locator('#featuredToggle').uncheck();await page.locator('#collectionToggle').uncheck();await close();check('empty presentation has recovery hint',await page.locator('#hiddenHint').isVisible());await shot('empty-390');
 await open();await page.locator('#resetPage').click();await page.locator('#editorPreview').focus();await page.keyboard.press('Tab');check('modal tab stays inside',await page.evaluate(()=>!!document.activeElement.closest('#editor')));await page.keyboard.press('Escape');check('escape focus returns',await page.locator('#customize').evaluate(n=>n===document.activeElement));
 check('reset restores original',await page.locator('#pageTitle').textContent()==='느리게 듣고,\n오래 만드는 것.');await page.locator('#undo').click();check('reset is reversible',await page.locator('#hiddenHint').isVisible());
 await open();await page.locator('#resetPage').click();await close();const item=page.locator('#featuredAlbum .object');await item.focus();await page.keyboard.press('Enter');check('item opens and labels fictional source',await page.locator('#itemContent').textContent().then(t=>t.includes('가상 작품')));await page.keyboard.press('Escape');check('item close returns focus',await item.evaluate(n=>n===document.activeElement));
 for(const width of[1440,820]){await page.setViewportSize({width,height:1000});await open();await inspect();await shot('editor-'+width);await close();}
 await page.setViewportSize({width:390,height:844});await open();await page.locator('#titleInput').fill('아주긴제목'.repeat(18));await page.locator('#noteInput').fill('한글메모'.repeat(95));await close();await inspect();checks.push('long unbroken Korean title and note do not overflow');
 await page.reload();check('reload honestly resets memory-only edits',await page.locator('#pageTitle').textContent()==='느리게 듣고,\n오래 만드는 것.');
 const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const tp=await touch.newPage();await tp.goto(base+'/docs/prototypes/taste-page/');await tp.locator('#customize').tap();await tp.locator('[data-layout-choice="archive"]').tap();await tp.locator('#closeEditor').tap();check('touch customization works in simulation',await tp.locator('#page').getAttribute('data-layout')==='archive');await touch.close();
 const stores=await page.evaluate(async()=>({local:localStorage.length,session:sessionStorage.length,databases:(await indexedDB.databases()).length,workers:(await navigator.serviceWorker.getRegistrations()).length,iframes:document.querySelectorAll('iframe').length}));assert.deepEqual(stores,{local:0,session:0,databases:0,workers:0,iframes:0});checks.push('no persistent stores or production connections');assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify({browser:browser.version(),checks,minimumTextContrast:Math.min(...ratios),errors,external,stores,scope:'Standalone memory-only prototype; viewport/touch simulation, no Apple hardware, native IME, auth, save, sync or publishing verification'},null,2)+'\n');console.log('PASS '+checks.length+' checks');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

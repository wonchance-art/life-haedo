'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const{chromium}=require(process.env.PW_MODULE_PATH||'./browser-ci/node_modules/playwright');
const base=process.env.BASE_URL||'http://127.0.0.1:4189',out=path.resolve(process.env.TASTE_PAGE_OUTPUT||'docs/design-review/evidence/taste-page');
(async()=>{
 await fs.mkdir(out,{recursive:true});const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext(),page=await context.newPage(),errors=[],external=[],checks=[],ratios=[];
 context.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});});
 page.on('dialog',d=>d.accept());
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await context.route('**/*',r=>{if(new URL(r.request().url()).origin!==new URL(base).origin){external.push(r.request().url());return r.abort();}return r.continue();});
 const check=(label,v)=>{assert.ok(v,label);checks.push(label);};
 const shot=async name=>{await page.mouse.move(0,0);await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});};
 async function inspect(){
  const editor=await page.locator('#editor').evaluate(n=>{const r=n.getBoundingClientRect();return !n.open||(r.top>=0&&r.bottom<=innerHeight+1);});assert.ok(editor,'editor fits viewport and scrolls internally');
  const spills=await page.locator('.media-frame').evaluateAll(ns=>ns.filter(n=>{const a=n.getBoundingClientRect(),b=n.firstElementChild.getBoundingClientRect();return a.width&&(b.left<a.left-1||b.right>a.right+1||b.top<a.top-1||b.bottom>a.bottom+1);}).length);
  assert.equal(spills,0,'media frame contains artwork with editor open or closed');
  const bookRatios=await page.locator('.art.book').evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect()).filter(r=>r.width).map(r=>r.width/r.height));
  assert.ok(bookRatios.every(r=>Math.abs(r-2/3)<.015),'portrait book ratio remains 2:3: '+JSON.stringify({width:page.viewportSize().width,layout:await page.locator('#page').getAttribute('data-layout'),bookRatios}));
  const clippedAuthors=await page.locator('.book-author').evaluateAll(ns=>ns.filter(n=>{const a=n.closest('.book').getBoundingClientRect(),b=n.getBoundingClientRect();return a.width&&b.width&&(b.bottom>a.bottom+1||b.top<a.top-1);}).length);
  assert.equal(clippedAuthors,0,'book author stays inside compact cover');
  const result=await page.evaluate(()=>{
   const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number),lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
   const visible=n=>n.getBoundingClientRect().width>0&&getComputedStyle(n).visibility!=='hidden';
   const textRatios=[...document.querySelectorAll('body *')].filter(n=>visible(n)&&!n.closest('button:disabled')&&[...n.childNodes].some(c=>c.nodeType===3&&c.textContent.trim())).map(n=>{const f=rgb(getComputedStyle(n).color);let bg=[255,255,255];for(let p=n;p;p=p.parentElement){const c=rgb(getComputedStyle(p).backgroundColor);if(c.length===3||c[3]===1){bg=c;break;}}const a=lum(f),b=lum(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});
   return{overflow:document.documentElement.scrollWidth>innerWidth,small:[...document.querySelectorAll('button,select,textarea,a,.toggle')].filter(n=>visible(n)&&!n.classList.contains('skip')&&n.getBoundingClientRect().height<43.5).map(n=>n.id||n.textContent),tinyInputs:[...document.querySelectorAll('input:not([type=checkbox]):not([type=file]),textarea,select')].filter(n=>visible(n)&&parseFloat(getComputedStyle(n).fontSize)<16).length,textRatios};
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
 await page.locator('#accentInput').selectOption('violet');await page.locator('#paperInput').selectOption('warm');await page.locator('#fontInput').selectOption('serif');await page.locator('#densityInput').selectOption('close');await page.locator('#itemToAdd').selectOption('m2');await page.locator('#addItem').click();for(let i=0;i<4;i++)await page.locator('#pick-m2-up').click();await inspect();await shot('editor-390');
 await page.locator('#editorPreview').click();check('preview preserves edited title',await page.locator('#pageTitle').textContent()==='음악과 책, 오래 쓰는 도구에 관하여');check('chosen album shown',await page.locator('#featuredAlbum [data-item="m2"]').count()===1);check('preview is explicitly private',await page.locator('#previewBar').textContent().then(t=>t.includes('게시하지 않음')));await inspect();await shot('custom-preview-390');
 await page.locator('#returnEdit').click();check('preview returns focus',await page.locator('#customize').evaluate(n=>n===document.activeElement));await open();check('fields survive preview',await page.locator('#noteInput').inputValue()==='내가 직접 고른 이유를 남깁니다.');
 await page.locator('#noteToggle').uncheck();await page.locator('#metadataToggle').uncheck();await close();check('note and metadata hidden only in presentation',await page.locator('#personalNote').isHidden()&&await page.locator('#featuredAlbum .object-creator').isHidden());
 await page.locator('#undo').click();check('undo restores metadata',await page.locator('#featuredAlbum .object-creator').isVisible());
 await open();await page.locator('#swapSections').click();await close();check('section order changes',await page.locator('#sections>section').first().getAttribute('id')==='collectionSection');
 await open();await page.locator('#featuredToggle').uncheck();await page.locator('#collectionToggle').uncheck();await close();check('empty presentation has recovery hint',await page.locator('#hiddenHint').isVisible());await shot('empty-390');
 await open();await page.locator('#resetPage').click();await page.locator('#editorPreview').focus();await page.keyboard.press('Tab');check('nonmodal editor allows background interaction',await page.locator('#editor').evaluate(n=>!n.matches(':modal')));await page.keyboard.press('Escape');check('escape focus returns',await page.locator('#customize').evaluate(n=>n===document.activeElement));
 check('reset restores original',await page.locator('#pageTitle').textContent()==='느리게 듣고,\n오래 만드는 것.');await page.locator('#undo').click();check('reset is reversible',await page.locator('#hiddenHint').isVisible());
 await open();await page.locator('#resetPage').click();await close();const item=page.locator('#featuredAlbum .object');await item.focus();await page.keyboard.press('Enter');check('item opens and labels fictional source',await page.locator('#itemContent').textContent().then(t=>t.includes('가상 자료')));await page.keyboard.press('Escape');check('item close returns focus',await item.evaluate(n=>n===document.activeElement));
 for(const width of[1440,820]){await page.setViewportSize({width,height:1000});await open();await inspect();await shot('editor-'+width);await close();}
 await page.setViewportSize({width:390,height:844});await open();await page.locator('#titleInput').fill('아주긴제목'.repeat(18));await page.locator('#noteInput').fill('한글메모'.repeat(95));await close();await inspect();checks.push('long unbroken Korean title and note do not overflow');
 await page.reload();check('confirmed reload resets edits without implicit storage',await page.locator('#pageTitle').textContent()==='느리게 듣고,\n오래 만드는 것.');

 // Text editing is one undo transaction; previous layout decisions remain recoverable.
 await open();await page.locator('[data-layout-choice="editorial"]').click();await page.locator('#titleInput').fill('');await page.locator('#titleInput').pressSequentially('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890');await page.locator('#editorUndo').click();
 check('one undo restores complete title after 62 typed characters',await page.locator('#titleInput').inputValue()==='느리게 듣고,\n오래 만드는 것.');await page.locator('#editorUndo').click();check('previous layout undo survives long typing',await page.locator('#page').getAttribute('data-layout')==='gallery');
 // Selected content, section names and order roundtrip through an explicit file.
 await page.locator('#sectionName').fill('내가 다시 찾는 것');await page.locator('#pick-m1-remove').click();await page.locator('#itemToAdd').selectOption('o1');await page.locator('#addItem').click();await page.locator('#pick-o1-up').click();
 const expected=await page.locator('#selectedItems').innerText();const downloadPromise=page.waitForEvent('download');await page.locator('#downloadPage').click();const download=await downloadPromise;const file=await download.path();const exported=JSON.parse(await fs.readFile(file,'utf8'));
 check('design file contains only presentation and sample IDs',exported.format==='haedo-taste-prototype'&&!JSON.stringify(exported).includes('퇴근길')&&exported.page.featuredItems.includes('o1'));
 await page.locator('#resetPage').click();await page.locator('#loadPage').setInputFiles(file);await page.waitForFunction(()=>document.getElementById('fileStatus').textContent.includes('열었습니다'));
 check('file restores selected items and section title',await page.locator('#selectedItems').innerText()===expected&&await page.locator('#featuredHeading').textContent()==='내가 다시 찾는 것');
 await page.locator('#editorUndo').click();check('opening a file is reversible',await page.locator('#featuredHeading').textContent()==='요즘 곁에 둔 것');
 await page.locator('#loadPage').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{invalid')});await page.locator('#fileError').waitFor({state:'visible'});check('malformed file preserves page',await page.locator('#featuredHeading').textContent()==='요즘 곁에 둔 것');
 await page.locator('#loadPage').setInputFiles({name:'huge.json',mimeType:'application/json',buffer:Buffer.alloc(33000,32)});await page.waitForFunction(()=>document.getElementById('fileError').textContent.includes('32KB'));check('oversized file rejected without losing edits',await page.locator('#featuredHeading').textContent()==='요즘 곁에 둔 것');
 await page.evaluate(()=>{const original=File.prototype.text;File.prototype.text=function(){File.prototype.text=original;return new Promise(resolve=>{window.finishRead=()=>resolve(original.call(this));});};});
 await page.locator('#loadPage').setInputFiles(file);await page.waitForFunction(()=>!!window.finishRead);await page.locator('#sectionName').fill('읽는 중 고친 이름');await page.evaluate(()=>window.finishRead());await page.waitForFunction(()=>document.getElementById('fileError').textContent.includes('편집이 바뀌었'));check('late file read never overwrites newer editing',await page.locator('#featuredHeading').textContent()==='읽는 중 고친 이름');await page.locator('#editorUndo').click();
 const bad=structuredClone(exported);bad.page.featuredItems=['unknown'];await page.locator('#loadPage').setInputFiles({name:'unknown.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bad))});await page.waitForFunction(()=>document.getElementById('fileError').textContent.includes('알 수 없'));check('unknown sample references rejected without replacing page',await page.locator('#featuredHeading').textContent()==='요즘 곁에 둔 것');
 await page.locator('#editorPreview').click();await page.locator('#featuredAlbum .object').click();check('preview detail excludes private item notes',await page.locator('#itemContent .item-note-label').count()===0);await page.locator('#closeItem').click();await page.locator('#returnEdit').click();
 // Heterogeneous content: every available type, missing artwork and long titles.
 await open();await page.locator('#sectionTarget').selectOption('collection');
 while(await page.locator('#itemToAdd option').count())await page.locator('#addItem').click();
 check('all twelve sample items can be curated',await page.locator('#selectedItems li').count()===12&&await page.locator('#addItem').isDisabled());await close();
 for(const width of [1440,820,390]){await page.setViewportSize({width,height:width===390?844:1000});await inspect();await shot('mixed-'+width);}
 await open();const editorBox=await page.locator('#editor').boundingBox();check('mobile editor leaves more than half the viewport visible',editorBox.height<=844*.46);await shot('editing-visible-390');await close();
 await open();await page.locator('#sectionTarget').selectOption('featured');while(await page.locator('#itemToAdd option').count())await page.locator('#addItem').click();await close();await inspect();await shot('mixed-featured-390');
 checks.push('file restore, rejection, mixed curation and grouped undo independently exercised');
 const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const tp=await touch.newPage();await tp.goto(base+'/docs/prototypes/taste-page/');await tp.locator('#customize').tap();await tp.locator('[data-layout-choice="archive"]').tap();await tp.locator('#closeEditor').tap();check('touch customization works in simulation',await tp.locator('#page').getAttribute('data-layout')==='archive');await tp.locator('#customize').tap();await tp.locator('#loadPage').setInputFiles(file);await tp.waitForFunction(()=>document.getElementById('fileStatus').textContent.includes('열었습니다'));check('download reopens in a fresh browser context',await tp.locator('#featuredHeading').textContent()==='내가 다시 찾는 것');await touch.close();
 const stores=await page.evaluate(async()=>({local:localStorage.length,session:sessionStorage.length,databases:(await indexedDB.databases()).length,workers:(await navigator.serviceWorker.getRegistrations()).length,iframes:document.querySelectorAll('iframe').length}));assert.deepEqual(stores,{local:0,session:0,databases:0,workers:0,iframes:0});checks.push('no persistent stores or production connections');assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify({browser:browser.version(),checks,minimumTextContrast:Math.min(...ratios),errors,external,stores,scope:'Standalone prototype with explicit design-file roundtrip; viewport/touch simulation, no Apple hardware, native IME, auth, production save, sync or publishing verification'},null,2)+'\n');console.log('PASS '+checks.length+' checks');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

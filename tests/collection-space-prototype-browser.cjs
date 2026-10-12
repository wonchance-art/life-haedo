'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require(process.env.PW_MODULE_PATH||'./browser-ci/node_modules/playwright');
const base=process.env.BASE_URL||'http://127.0.0.1:4189';
const out=path.resolve(process.env.COLLECTION_PROTOTYPE_OUTPUT||'docs/design-review/evidence/collection-space');
(async()=>{
 await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext(); const page=await context.newPage();
 const errors=[],external=[],checks=[],contrast=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==new URL(base).origin){external.push(route.request().url());return route.abort();}return route.continue();});
 const check=(name,truth)=>{assert.ok(truth,name);checks.push(name);};
 const shot=async name=>{await page.mouse.move(0,0);await page.waitForTimeout(180);await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});};
 const inspect=async()=>{
  const r=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,small:[...document.querySelectorAll('button,input,select,summary')].filter(n=>n.getBoundingClientRect().width&&n.getBoundingClientRect().height<43.5).map(n=>n.textContent||n.getAttribute('aria-label')),inputs:[...document.querySelectorAll('input,textarea,select')].filter(n=>n.getBoundingClientRect().width&&parseFloat(getComputedStyle(n).fontSize)<16).length}));
  assert.deepEqual(r,{overflow:false,small:[],inputs:0});
  const spill=await page.locator('.art-slot').evaluateAll(nodes=>nodes.filter(n=>{
    const a=n.getBoundingClientRect(), b=n.firstElementChild.getBoundingClientRect();
    return a.width&&(b.left<a.left-1||b.right>a.right+1||b.top<a.top-1||b.bottom>a.bottom+1);
  }).length); assert.equal(spill,0,'covers remain inside aligned art area');
  const ratios=await page.evaluate(()=>{
    const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number);
    const lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    return [...document.querySelectorAll('body *')].filter(n=>n.getBoundingClientRect().width&&[...n.childNodes].some(c=>c.nodeType===3&&c.textContent.trim())).map(n=>{
      const fg=rgb(getComputedStyle(n).color);let bg=[255,255,255];
      for(let p=n;p;p=p.parentElement){const c=rgb(getComputedStyle(p).backgroundColor);if(c.length===3||c[3]===1){bg=c;break;}}
      const a=lum(fg),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    });
  }); contrast.push(...ratios);assert.ok(ratios.every(r=>r>=4.5),'text contrast >=4.5');
 };
 try {
  await page.goto(base+'/docs/prototypes/collection-space/');
  await page.locator('#grid .object-card').first().waitFor();
  check('14 mixed items',await page.locator('#grid .object-card').count()===14);
  for(const width of [1440,820,390]){
   await page.setViewportSize({width,height:width===390?844:1000});
   await page.getByRole('button',{name:'A · 표지 중심',exact:true}).click();await inspect();await shot('gallery-'+width);
   const dims=await page.locator('#grid .cover').evaluateAll(nodes=>nodes.map(n=>({type:n.dataset.type,w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));
   assert.ok(dims.filter(x=>x.type==='music').every(x=>Math.abs(x.w-x.h)<1));assert.ok(dims.filter(x=>x.type==='book').every(x=>Math.abs(x.w/x.h-2/3)<.01));
   await page.getByRole('button',{name:'B · 메모 중심',exact:true}).click();await inspect();await shot('compact-'+width);
   checks.push('grid/list, Korean titles, cover ratios, controls '+width);
  }
  await page.getByRole('button',{name:'A · 표지 중심',exact:true}).click();
  await page.locator('#types').getByRole('button',{name:'예술 작품',exact:true}).click();check('artwork filter',await page.locator('#grid .object-card').count()===2);await shot('artworks-390');
  await page.locator('#grid [data-id="art1"]').click();check('artwork source metadata separate from personal note',(await page.locator('#detail .artwork-meta').textContent()).includes('캔버스에 유채')&&(await page.locator('#detail .artwork-meta').textContent()).includes('이미지 이용 조건'));await page.keyboard.press('Escape');
  await page.locator('#types').getByRole('button',{name:'음악',exact:true}).click();check('music filter',await page.locator('#grid .object-card').count()===3);await shot('albums-390');
  await page.locator('#types').getByRole('button',{name:'책',exact:true}).click();check('book filter',await page.locator('#grid .object-card').count()===3);await shot('books-390');
  await page.locator('#query').fill('없는 항목');check('empty state',await page.locator('#empty').isVisible());await shot('empty-390');
  await page.locator('#reset').click();await page.waitForFunction(()=>document.activeElement===document.getElementById('query'));check('reset keeps search focus',await page.locator('#query').evaluate(n=>n===document.activeElement));
  await page.locator('#collection').selectOption('make');check('collection mixes types',await page.locator('#grid .object-card').count()===5);await page.locator('#collection').selectOption('all');
  // Native dialog, Escape and opener restoration; keyboard activation rather than click only.
  const opener=page.locator('#grid [data-id="m1"]');await opener.focus();await page.keyboard.press('Enter');
  await page.locator('#detail textarea').fill('개인 메모는 글 카드에 포함하지 않는다');await page.keyboard.press('Escape');
  check('detail escape focus',await opener.evaluate(n=>n===document.activeElement));
  await opener.press('Enter');check('note remains within session',await page.locator('#detail textarea').inputValue()==='개인 메모는 글 카드에 포함하지 않는다');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'글쓰기 시안',exact:true}).click();await page.locator('#draftBody').fill('퇴근 후에는 조금 느린 것을 고른다. 자주 듣는 음악과 읽다 접어 둔 책, 언젠가 만들어 보고 싶은 작은 도구들.\n\n서로 다른 곳에 있던 것들을 같이 놓으니, 요즘 내가 무엇에 마음을 쓰는지 조금 보인다.');
  await page.locator('#pick').click();await page.locator('#pickerGrid [data-id="m1"]').click();await page.locator('#pickerQuery').fill('일상의');await page.locator('#pickerGrid [data-id="b1"]').click();await page.locator('#pickerQuery').fill('틈');await page.locator('#pickerGrid [data-id="t1"]').click();
  check('selection survives search changes',await page.locator('#selectedCount').textContent()==='3개 선택');
  await page.locator('#pickerQuery').fill('');
  await page.locator('#applySelection').focus();await page.keyboard.press('Tab');
  check('keyboard remains in modal',await page.evaluate(()=>!!document.activeElement.closest('#picker')));
  await page.locator('#pickerQuery').focus();await inspect();await shot('picker-390');await page.locator('#applySelection').click();
  check('three inline cards',await page.locator('#inserted .inserted-card').count()===3);
  check('private note excluded',!(await page.locator('#inserted').textContent()).includes('개인 메모'));
  check('writer text intact',(await page.locator('#draftBody').inputValue()).includes('요즘 내가 무엇에 마음을 쓰는지'));
  await shot('writing-390');await page.locator('#pick').click();await page.locator('#pickerGrid [data-id="m1"]').click();await page.keyboard.press('Escape');
  check('cancel does not apply pending selection',await page.locator('#inserted .inserted-card').count()===3);
  check('picker closes to opener',await page.locator('#pick').evaluate(n=>n===document.activeElement));
  for(const width of [820,1440]){await page.setViewportSize({width,height:1000});await inspect();await shot('writing-'+width);await page.locator('#pick').click();await inspect();await shot('picker-'+width);await page.keyboard.press('Escape');}
  await page.getByRole('button',{name:'느린 저녁 연결 해제',exact:true}).click();check('unlink removes only reference',await page.locator('#inserted .inserted-card').count()===2);
  await page.locator('#backLibrary').click();check('library object survives unlink',await page.locator('#grid [data-id="m1"]').count()===1);
  await page.getByRole('button',{name:'항목 추가',exact:true}).click();await page.locator('#newTitle').fill('느린 저녁');await page.getByRole('button',{name:'시안에 추가',exact:true}).click();check('duplicate is not silently merged',await page.locator('#addError').textContent()!=='');
  await page.locator('#newTitle').fill('표지 없는 새로운 책');await page.locator('#newType').selectOption('book');await page.locator('#newUrl').fill('javascript:alert(1)');await page.getByRole('button',{name:'시안에 추가',exact:true}).click();check('unsafe URL rejected',await page.locator('#addError').textContent()==='http 또는 https 주소를 입력해 주세요.');
  await page.locator('#newUrl').fill('https://example.com/book');await page.getByRole('button',{name:'시안에 추가',exact:true}).click();check('manual fallback adds without cover',await page.locator('#grid .object-card').count()===15);
  await page.locator('.review-controls summary').click();await page.locator('#scenario').selectOption('loading');check('loading announced',await page.locator('#grid').getAttribute('aria-busy')==='true');await shot('loading-1440');await page.getByRole('button',{name:'불러오기 완료 보기'}).click();
  await page.locator('#scenario').selectOption('error');await shot('error-1440');await page.getByRole('button',{name:'다시 시도',exact:true}).click();check('error recovery preserves entries',await page.locator('#grid .object-card').count()===15);
  await page.reload();await page.locator('#grid .object-card').first().waitFor();check('reload honestly resets prototype',await page.locator('#grid .object-card').count()===14);
  await page.getByRole('button',{name:'항목 추가',exact:true}).click();await page.locator('#newType').selectOption('artwork');await page.locator('#newTitle').fill('시험용 조각');await page.locator('#newCreator').fill('가상 조각가');await page.locator('#newYear').fill('1990년경');await page.locator('#newMedium').fill('청동');await page.locator('#newHolding').fill('소장처 미상');await page.locator('#newUrl').fill('https://example.com/art');await page.getByRole('button',{name:'시안에 추가',exact:true}).click();await page.locator('#grid .object-card').first().click();check('manual artwork preserves uncertain date and source',(await page.locator('#detail .artwork-meta').textContent()).includes('1990년경')&&(await page.locator('#detail .artwork-meta').textContent()).includes('https://example.com/art'));await page.keyboard.press('Escape');await page.reload();
  await page.locator('.review-controls summary').click();await page.locator('#scenario').selectOption('many');check('many items',await page.locator('#grid .object-card').count()===98);
  for(const width of [1440,820,390]){await page.setViewportSize({width,height:1000});await inspect();}
  const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const touchPage=await touch.newPage();await touchPage.goto(base+'/docs/prototypes/collection-space/');
  await touchPage.locator('#grid [data-id="b1"]').tap();
  check('touch opens detail in simulated viewport',await touchPage.locator('#detail').isVisible());
  await touchPage.getByRole('button',{name:'항목 닫기',exact:true}).tap();await touch.close();
  const persistent=await page.evaluate(async()=>({local:localStorage.length,session:sessionStorage.length,databases:(await indexedDB.databases()).length,serviceWorkers:(await navigator.serviceWorker.getRegistrations()).length,frames:document.querySelectorAll('iframe').length}));
  assert.deepEqual(persistent,{local:0,session:0,databases:0,serviceWorkers:0,frames:0});checks.push('no persistent storage, service worker or embeds');
  check('no unexpected external request',external.length===0);check('no browser errors',errors.length===0);
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify({browser:browser.version(),checks,minimumTextContrast:Math.min(...contrast),persistent,errors,external,deviceValidation:'Linux Chromium viewport simulation only; no Apple hardware or native IME',scope:'Independent prototype, no production save/sync/metadata'},null,2)+'\n');
  console.log('PASS '+checks.length+' checks; screenshots in '+out);
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

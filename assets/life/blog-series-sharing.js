/* Explicit public table of contents. The linked posts have their own publication consent. */
(function(root){
  'use strict';
  const life=root.HaedoLife ||= {};
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  async function open({storage,workspaceId,seriesId,isCurrent=()=>true}){
    const source=await storage.readBlogSeries(workspaceId), series=source.series.find(s=>s.id===seriesId);
    if(!isCurrent()||!series)throw new Error('모음이 바뀌었습니다. 다시 열어 주세요.');
    const remote=life.BlogSeriesRemote.create({auth:root.HaedoAuth,isCurrent}), previous=document.activeElement;
    const dialog=el('dialog',null,'bs-share-dialog');dialog.id='bsShare';dialog.setAttribute('aria-labelledby','bsShareTitle');
    const heading=el('h2','공개 목차');heading.id='bsShareTitle';
    const close=el('button','닫기','life-button');close.type='button';
    const status=el('p','공개한 글을 확인하는 중입니다.','life-meta');status.setAttribute('role','status');status.id='bsShareStatus';
    const error=el('p','','life-error');error.setAttribute('role','alert');error.hidden=true;
    const title=el('input'), intro=el('textarea');title.value=series.title;title.maxLength=500;intro.value=series.intro;intro.maxLength=10000;
    const field=(label,input)=>{const n=el('label',null,'life-field');n.append(el('span',label),input);return n;};
    title.setAttribute('aria-label','공개 모음 제목');intro.setAttribute('aria-label','공개 모음 소개');
    const choices=el('section');choices.id='bsShareChoices';
    const preview=el('section');preview.id='bsSharePreview';
    const consent=el('input');consent.type='checkbox';consent.setAttribute('aria-label','이 목차를 공개합니다');
    const consentLabel=el('label',null,'blog-manager-check');consentLabel.append(consent,document.createTextNode('검토한 제목·소개와 선택한 공개 글의 목차를 공개합니다.'));
    let active=true,busy=false,metadata=null,review=null,rows=[];
    const valid=()=>active&&isCurrent()&&dialog.isConnected;
    function dispose(){if(!active)return;active=false;remote.dispose?.();if(dialog.open)dialog.close();dialog.remove();if(previous?.isConnected)previous.focus({preventScroll:true});}
    async function run(task){if(!valid()||busy)return;busy=true;error.hidden=true;const controls=[...dialog.querySelectorAll('button,input,textarea,select')].map(n=>[n,n.disabled]);controls.forEach(([n])=>n.disabled=true);dialog.setAttribute('aria-busy','true');try{await task();}catch(e){if(valid()){error.textContent=e.message||'처리 결과를 확인하지 못했습니다. 다시 확인해 주세요.';error.hidden=false;}}finally{busy=false;if(valid()){dialog.setAttribute('aria-busy','false');controls.forEach(([n,disabled])=>{if(n.isConnected)n.disabled=disabled;});}}}
    function button(text,task){const n=el('button',text,'life-button');n.type='button';n.addEventListener('click',()=>{void run(task);});return n;}
    function invalidate(){review=null;consent.checked=false;preview.replaceChildren();}
    title.addEventListener('input',invalidate);intro.addEventListener('input',invalidate);
    function showState(value){metadata=value;const link=el('p');if(value.status==='published'&&value.publicId){const a=el('a','공개 모음 열기');const url=new URL('series.html',root.location.href);url.searchParams.set('series',value.publicId);a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';link.append(a);status.textContent='공개 목차를 확인했습니다. 목차와 개별 글의 공개 상태는 따로 관리합니다.';}else status.textContent=value.pending?'결과를 확인하지 못한 요청이 있습니다. 같은 요청을 다시 확인해 주세요.':'이 모음의 공개 목차가 없습니다.';preview.querySelector('.bs-published-link')?.remove();link.className='bs-published-link';preview.append(link);}
    async function load(){
      const [posts,state]=await Promise.all([remote.ownerListPublished(),remote.getState(seriesId)]);if(!valid())return;
      invalidate();showState(state);choices.replaceChildren(el('h3','목차에 담을 공개 글'));rows=[];
      if(!posts.length){choices.append(el('p','글 관리에서 글을 먼저 공개한 뒤 다시 확인해 주세요. 모음의 비공개 글을 자동으로 게시하지 않습니다.','life-help'));return;}
      for(const [index,item] of series.items.entries()){
        const row=el('div',null,'bs-share-choice'),check=el('input');check.type='checkbox';check.setAttribute('aria-label',`${index+1}편 목차에 포함`);
        const select=el('select');select.setAttribute('aria-label',`${index+1}편 공개 글 선택`);const empty=el('option','공개 글 선택');empty.value='';select.append(empty);
        for(const post of posts){const option=el('option',post.title||'제목 없는 공개 글');option.value=post.publication.token;select.append(option);}
        const label=el('label',null,'blog-manager-check');label.append(check,document.createTextNode(`${index+1}. ${item.title||'제목 없는 글'}`));row.append(label,select);choices.append(row);rows.push({entryId:item.id,check,select});check.addEventListener('change',invalidate);select.addEventListener('change',invalidate);
      }
    }
    const prepare=button('공개 목차 미리보기',async()=>{
      invalidate();
      const current=await storage.readBlogSeries(workspaceId);if(!valid())return;if(current.revision!==source.revision)throw new Error('모음이 바뀌었습니다. 닫은 뒤 최신 목차를 다시 검토해 주세요.');
      review=await remote.prepare({...series,title:title.value,intro:intro.value,revision:source.revision},rows.filter(r=>r.check.checked).map(r=>({entryId:r.entryId,token:r.select.value})));
      if(!valid())return;consent.checked=false;preview.replaceChildren(el('h3',review.title||title.value),el('p',intro.value));const list=el('ol');for(const row of rows.filter(r=>r.check.checked))list.append(el('li',row.select.selectedOptions[0]?.textContent||''));preview.append(list);status.textContent='이 목차만 공개합니다.';
    });
    const publish=button('목차 게시·갱신',async()=>{
      if(!review||!consent.checked)throw new Error('공개 목차 미리보기를 확인하고 공개 동의를 선택해 주세요.');
      const selectedReview=review;invalidate();
      const current=await storage.readBlogSeries(workspaceId);if(!valid())return;if(current.revision!==source.revision)throw new Error('모음이 바뀌었습니다. 최신 목차를 다시 검토해 주세요.');
      const result=await remote.publish(selectedReview,{expectedRevision:metadata?.revision||0});if(valid()){showState(await remote.getState(seriesId));if(result.status!=='stored')throw new Error('서버의 목차가 바뀌었습니다. 공개 상태를 다시 확인한 뒤 검토해 주세요.');}
    });
    const revokeConsent=el('input');revokeConsent.type='checkbox';revokeConsent.setAttribute('aria-label','이 공개 목차를 철회합니다');const revokeLabel=el('label',null,'blog-manager-check');revokeLabel.append(revokeConsent,document.createTextNode('이 공개 목차를 철회합니다. 개별 글의 공개는 유지됩니다.'));
    const revoke=button('목차 공개 철회',async()=>{if(!revokeConsent.checked)throw new Error('철회할 공개 목차를 확인해 주세요.');const result=await remote.revoke(seriesId,{expectedRevision:metadata?.revision||0});if(valid()){invalidate();showState(await remote.getState(seriesId));revokeConsent.checked=false;if(result.status!=='stored')throw new Error('서버의 목차가 바뀌었습니다. 현재 공개 상태를 다시 확인해 주세요.');}});
    const retry=button('미확인 게시 요청 다시 확인',async()=>{invalidate();const result=await remote.retry(seriesId);if(valid()){showState(await remote.getState(seriesId));if(result.status!=='stored')throw new Error('이전 요청과 현재 서버 상태가 다릅니다. 최신 공개 목차를 다시 확인해 주세요.');}});
    const refresh=button('공개 상태 다시 확인',load);
    dialog.append(heading,close,el('p','이 모음의 제목·소개와 직접 고른 공개 글 주소를 별도 목차로 게시합니다. 글 본문·사진·비공개 사본은 자동 전송하지 않습니다.','life-help'),field('공개 모음 제목',title),field('공개 모음 소개',intro),status,error,refresh,choices,prepare,preview,consentLabel,publish,retry,revokeLabel,revoke);
    close.addEventListener('click',()=>{if(!busy)dispose();});dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();else dispose();});dialog.addEventListener('close',dispose);
    document.body.append(dialog);dialog.showModal();heading.tabIndex=-1;heading.focus({preventScroll:true});void run(load);return dispose;
  }
  life.BlogSeriesSharing={open};
})(globalThis);

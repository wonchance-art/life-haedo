/* Isolated, in-memory demonstration. No account, persistence or AI client. */
(() => {
  'use strict';
  const F=LensFixtures,M=LensModel,$=id=>document.getElementById(id);
  const state={lens:F.lenses[0].id,period:'all',drafts:new Map(),excluded:new Set(),candidates:new Map(),fault:new URLSearchParams(location.search).get('case')==='error'};
  const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const icon=(name)=>HaedoLife.Icons.create(name);
  const button=(text,fn,cls)=>{const b=node('button',text,cls);b.type='button';b.addEventListener('click',fn);return b;};
  document.querySelectorAll('[data-icon]').forEach(e=>e.replaceWith(icon(e.dataset.icon)));
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
  const scope=()=>M.selectScope(F.sources,state.period);
  const finding=(f)=>{const copy=structuredClone(f);if(state.fault)copy.refs[0].text+=' 잘못된 인용';return copy;};
  function updateCount(){$('count').textContent=state.candidates.size;}
  function openSource(ref){
    const s=F.sources.find(s=>s.id===ref.versionId);
    $('source-title').textContent=s.title;
    $('source-meta').textContent=(s.date||'날짜 미확인')+' · 내 글 · '+s.id+' · '+s.origin;
    $('source-warning').textContent=s.coverage==='partial'?'일부만 옮긴 글입니다. 사진·전체 맥락은 이 예시에 없습니다.':'';
    $('source-body').replaceChildren(document.createTextNode(s.text.slice(0,ref.start)),node('mark',s.text.slice(ref.start,ref.end)),document.createTextNode(s.text.slice(ref.end)));
    $('source-dialog').showModal();
  }
  function tabs(){
    $('tabs').replaceChildren(...F.lenses.map(l=>{const b=button(l.label,()=>{state.lens=l.id;tabs();render();$('tab-'+l.id).focus();});b.id='tab-'+l.id;b.setAttribute('role','tab');b.setAttribute('aria-selected',String(l.id===state.lens));b.setAttribute('aria-controls','results');b.tabIndex=l.id===state.lens?0:-1;
      b.addEventListener('keydown',e=>{let i=F.lenses.findIndex(l=>l.id===state.lens);if(e.key==='ArrowRight')i=(i+1)%3;else if(e.key==='ArrowLeft')i=(i+2)%3;else if(e.key==='Home')i=0;else if(e.key==='End')i=2;else return;e.preventDefault();state.lens=F.lenses[i].id;tabs();render();$('tab-'+state.lens).focus();});return b;}));
  }
  function render(){
    const panel=$('results'),current=scope(),lens=F.lenses.find(l=>l.id===state.lens);
    panel.setAttribute('aria-labelledby','tab-'+lens.id);panel.replaceChildren();
    $('scope-info').textContent='선택한 내 글 '+current.count+'개 · 날짜 미확인 '+current.unknownDates+'개. 이전 버전 1개와 타인의 글 2개(링크만 있는 자료 포함)는 분석 범위에서 제외했습니다.';
    const heading=node('div',undefined,'lens-heading');heading.append(node('h2',lens.title),node('p',lens.question));panel.append(heading);
    const all=F.findings.filter(f=>f.lens===state.lens);
    const available=all.filter(f=>M.validateFinding(f,F.sources,current.versionIds).valid);
    if(!available.length){const empty=node('div',undefined,'empty');empty.append(node('h3','이 범위에는 함께 읽을 근거가 부족해요'),node('p','시기를 좁혀도 예시 결론을 그대로 적용하지 않습니다. 서로 다른 시기의 글을 함께 살펴보세요.'),button('전체 시기로 돌아가기',()=>{state.period='all';$('period').value='all';render();panel.focus();}));panel.append(empty);}
    for(const original of available){
      const f=finding(original),article=node('article',undefined,'finding');article.dataset.finding=f.id;
      article.append(node('h3',f.title));
      if(state.excluded.has(f.id)){article.append(node('p','보류한 해석 · 입력은 유지됩니다.','meta'),button('다시 살펴보기',()=>{state.excluded.delete(f.id);render();document.querySelector('[data-finding="'+f.id+'"] h3').scrollIntoView({block:'center'});}));panel.append(article);continue;}
      article.append(node('p','예시 해석 · 실제 AI 분석 아님','meta'),node('p',f.summary,'interpretation'));
      const valid=M.validateFinding(f,F.sources,current.versionIds).valid;
      if(valid)for(const ref of f.refs){const s=F.sources.find(s=>s.id===ref.versionId),e=node('div',undefined,'evidence');if(ref.role==='counter')e.append(node('p','함께 봐야 할 다른 방향의 근거','counter'));e.append(node('blockquote',ref.text));const b=button((s.date||'날짜 미확인')+' · '+s.title,()=>openSource(ref),'source-link');b.prepend(icon('quote'));b.setAttribute('aria-label',s.title+' 원문 확인');e.append(b);article.append(e);}
      else {article.append(node('p','인용이 원문과 일치하지 않아 후보 담기를 막았습니다.','error'),button('예시 다시 불러오기',()=>{state.fault=false;render();$('results').focus();}));}
      const alternative=node('p',undefined,'alternative');alternative.append(node('strong','다른 설명  '),document.createTextNode(f.alternative));article.append(alternative,node('p',f.question,'question'));
      const editor=node('details',undefined,'editor'),summary=node('summary','내 해석 쓰기');editor.open=state.drafts.has(f.id);const label=node('label','장에 남길 내 생각');label.htmlFor='note-'+f.id;const input=node('textarea');input.id=label.htmlFor;input.value=state.drafts.get(f.id)||'';input.placeholder='이 해석에 동의하나요? 다른 설명도 적어 보세요.';
      const status=node('p',undefined,'local-status');status.setAttribute('role','status');input.addEventListener('input',()=>{state.drafts.set(f.id,input.value);if(state.candidates.has(f.id))status.textContent='수정한 내용을 반영하려면 후보를 갱신하세요.';});
      const add=button(state.candidates.has(f.id)?'장 후보 갱신':'장 후보 담기',()=>{try{const c=M.createCandidate(f,F.sources,scope(),input.value);state.candidates.set(f.id,c);updateCount();status.textContent='이 탭의 장 후보에 담았습니다. 파일로 받을 수 있습니다.';add.textContent='장 후보 갱신';}catch(e){status.textContent=e.message;input.focus();}},'primary');add.disabled=!valid;
      editor.append(summary,label,input,add,status);article.append(editor,button('보류',()=>{state.excluded.add(f.id);state.candidates.delete(f.id);updateCount();render();$('status').textContent='해석을 보류했습니다. 담았던 후보에서도 뺐으며 입력은 유지했습니다.';$('results').focus();},'quiet'));panel.append(article);
    }
    if(available.length&&available.length<all.length)panel.append(node('p','선택 범위 밖의 글이 필요한 해석은 표시하지 않았습니다.','meta'));
  }
  function candidateList(){
    const list=$('candidate-list');list.replaceChildren();
    if(!state.candidates.size)list.append(node('p','아직 담은 후보가 없습니다. 해석을 적은 뒤 장 후보에 담아 보세요.'));
    for(const c of state.candidates.values()){const a=node('article');a.append(node('h3',c.title),node('p','내 해석','meta'),node('p',c.userInterpretation));const d=node('details');d.append(node('summary','예시 제안과 근거 '+c.evidence.length+'개'),node('p',c.proposal.text),node('p','다른 설명: '+c.proposal.alternative));for(const e of c.evidence)d.append(node('blockquote',e.text),node('p',e.title+' · '+e.versionId+(e.role==='counter'?' · 다른 방향의 근거':''),'meta'));a.append(d,button('후보에서 빼기',()=>{state.candidates.delete(c.id);updateCount();candidateList();render();$('candidate-title').tabIndex=-1;$('candidate-title').focus();},'quiet'));list.append(a);}
    $('download-json').disabled=$('download-md').disabled=!state.candidates.size;
  }
  function download(kind){
    try{const candidates=[...state.candidates.values()],content=kind==='json'?JSON.stringify(M.exportCandidates(candidates),null,2):M.markdown(candidates);const url=URL.createObjectURL(new Blob([content],{type:kind==='json'?'application/json;charset=utf-8':'text/markdown;charset=utf-8'}));const a=node('a');a.href=url;a.download='haedo-example-candidates.'+(kind==='json'?'json':'md');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);$('download-status').textContent='파일을 만들었습니다. 다운로드 완료 여부는 브라우저에서 확인해 주세요.';}catch(e){$('download-status').textContent=e.message;}
  }
  $('period').addEventListener('change',()=>{state.period=$('period').value;render();});
  $('candidates').addEventListener('click',()=>{candidateList();$('download-status').textContent='';$('candidate-dialog').showModal();});
  $('download-json').addEventListener('click',()=>download('json'));$('download-md').addEventListener('click',()=>download('md'));
  window.addEventListener('beforeunload',e=>{if([...state.drafts.values()].some(s=>s.trim())||state.candidates.size){e.preventDefault();e.returnValue='';}});
  tabs();
  if(new URLSearchParams(location.search).get('case')==='loading'){$('results').append(node('p','예시 자료를 여는 중입니다.','empty'));$('results').setAttribute('aria-busy','true');setTimeout(()=>{$('results').removeAttribute('aria-busy');render();},1000);}else render();
})();

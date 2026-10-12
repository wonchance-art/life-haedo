/* Standalone interaction study. No production storage, auth, network or iframe. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const types = { all:'전체',music:'음악',book:'책',film:'영화',video:'영상',article:'글',tool:'도구',place:'장소',artwork:'예술 작품',person:'인물',other:'기타' };
  const items = structuredClone(window.CollectionSample);
  const state = { type:'all', mode:'gallery', query:'', group:'all', scenario:'ready', selected:new Set(), pending:new Set() };
  const subtitle = item => item.type==='person'?(item.field||'활동 분야 미확인'):item.creator;
  const icon = name => HaedoLife.Icons.create(name);
  function el(tag, cls, text) { const node=document.createElement(tag); if(cls)node.className=cls; if(text!==undefined)node.textContent=text; return node; }
  function button(label, action, glyph) { const b=el('button',glyph?'life-icon-button':'life-button',glyph?undefined:label); b.type='button'; if(glyph){b.setAttribute('aria-label',label);b.title=label;b.append(icon(glyph));} b.addEventListener('click',action); return b; }
  const notify = text => { $('notice').textContent=text; };
  document.querySelectorAll('[data-icon]').forEach(n=>n.replaceWith(icon(n.dataset.icon)));
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
  // Keep keyboard traversal within the modal; native dialog handles Escape/return.
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const controls=[...dialog.querySelectorAll('button,input,textarea,select,a[href]')].filter(n=>!n.disabled&&n.getClientRects().length);
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }));
  function art(item) {
    const cover=el('span','cover '+item.tone); cover.dataset.type=item.type; cover.setAttribute('aria-hidden','true');
    if(item.type==='person'){cover.append(icon('user'));return cover;}
    if(item.type==='film'){cover.append(el('span','','포스터 미연결'));return cover;}
    if(item.type==='artwork'){cover.classList.add(item.orientation==='landscape'?'landscape':'portrait');cover.append(el('span','','이미지 미연결'));return cover;}
    if(item.cover) {cover.append(el('span','',item.cover));if(item.type!=='tool')cover.append(el('small','',item.creator));}
    else cover.append(icon(item.type==='tool'?'workspace':'bookmark'));
    return cover;
  }
  function card(item, action, picker=false) {
    const b=button(item.title,action); b.className='object-card'; b.dataset.id=item.id;
    b.setAttribute('aria-label',`${item.title} · ${subtitle(item)} · ${types[item.type]}`);
    const slot=el('span','art-slot');slot.append(art(item));
    const info=el('span','card-info');info.append(el('span','card-title',item.title),el('span','card-creator',subtitle(item)),el('span','card-note',item.note||'메모 없음'));
    b.replaceChildren(slot,info);
    if(picker){const chosen=state.pending.has(item.id); b.setAttribute('aria-pressed',String(chosen)); info.append(el('span','selection-indicator',chosen?'선택됨':'선택'));}
    return b;
  }
  let expandedItems;
  function activeItems() {
    if(state.scenario!=='many')return items;
    return expandedItems ||= Array.from({length:7},(_,batch)=>items.map(item=>({...item,id:batch?`${item.id}-${batch}`:item.id,title:batch?`${item.title} · 샘플 ${batch+1}`:item.title}))).flat();
  }
  const find = id => activeItems().find(item=>item.id===id)||items.find(item=>item.id===id)||expandedItems?.find(item=>item.id===id);
  function renderGrid() {
    const grid=$('grid');grid.replaceChildren();grid.classList.toggle('compact',state.mode==='compact');$('empty').hidden=true;
    $('count').textContent='';grid.removeAttribute('aria-busy');
    if(state.scenario==='loading'){grid.setAttribute('aria-busy','true');$('count').textContent='자료를 불러오는 중… (모사)';grid.append(button('불러오기 완료 보기',()=>setScenario('ready')));return;}
    if(state.scenario==='error'){const box=el('div','');box.append(el('p','form-error','자료를 불러오지 못했어요. (모사)'),button('다시 시도',()=>setScenario('ready')));grid.append(box);return;}
    const q=state.query.trim().toLocaleLowerCase('ko');
    const shown=activeItems().filter(item=>(state.type==='all'||item.type===state.type)&&(state.group==='all'||item.groups.includes(state.group))&&[item.title,subtitle(item),item.note].join(' ').toLocaleLowerCase('ko').includes(q));
    $('count').textContent=`${shown.length}개`;
    for(const item of shown)grid.append(card(item,()=>openDetail(item)));
    $('empty').hidden=shown.length>0;
  }
  function setScenario(value){state.scenario=value;$('scenario').value=value;renderGrid();}
  const modes=[['gallery','A · 표지 중심','표지로 둘러보고, 눌러서 자세히'],['compact','B · 메모 중심','제목과 내 메모를 함께 비교']];
  for(const [id,label,hint] of modes){const b=button(label,()=>{state.mode=id;renderModes();renderGrid();});b.dataset.mode=id;$('viewModes').append(b);}
  function renderModes(){document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===state.mode)));$('modeHint').textContent=modes.find(m=>m[0]===state.mode)[2];}
  function renderTypes(){ $('types').replaceChildren();for(const [id,label]of Object.entries(types)){const b=button(label,()=>{state.type=id;renderTypes();renderGrid();$('types').querySelector(`[data-type="${id}"]`).focus();});b.dataset.type=id;b.setAttribute('aria-pressed',String(state.type===id));$('types').append(b);} }
  $('query').addEventListener('input',e=>{state.query=e.target.value;renderGrid();});
  $('collection').addEventListener('change',e=>{state.group=e.target.value;renderGrid();});
  $('scenario').addEventListener('change',e=>setScenario(e.target.value));
  $('reset').addEventListener('click',()=>{state.type='all';state.group='all';state.query='';$('query').value='';$('collection').value='all';renderTypes();renderGrid();$('query').focus();});
  function showWriting(){ $('library').hidden=true;$('writing').hidden=false;document.querySelector('.mode-bar').hidden=true;$('draftTitle').focus(); }
  $('mainActions').append(button('글쓰기 시안',showWriting,'edit'),button('항목 추가',()=>{$('add').showModal();$('newTitle').focus();},'plus'));
  $('backLibrary').addEventListener('click',()=>{$('library').hidden=false;$('writing').hidden=true;document.querySelector('.mode-bar').hidden=false;document.querySelector('[aria-label="글쓰기 시안"]').focus();});
  function openDetail(item) {
    $('detailTitle').textContent=item.title;
    const content=$('detailContent');content.replaceChildren();
    const hero=el('div','detail-hero'),info=el('div');info.append(el('p','',subtitle(item)),el('p','',item.detail||types[item.type]));hero.append(art(item),info);content.append(hero);
    if(item.type==='artwork'){const meta=el('dl','artwork-meta');for(const [key,label]of [['year','제작 연도'],['medium','재료·기법'],['holding','소장처'],['source','출처'],['rights','이미지 이용 조건']])meta.append(el('dt','',label),el('dd','',item[key]||'미확인'));content.append(meta);}
    if(item.type==='film'){const meta=el('dl','artwork-meta film-meta');for(const [key,label]of [['creator','감독'],['year','개봉 연도'],['country','국가'],['duration','상영시간'],['source','출처'],['rights','포스터 이용 조건']])meta.append(el('dt','',label),el('dd','',item[key]||'미확인'));content.append(meta);}
    if(item.type==='person'){const meta=el('dl','artwork-meta person-meta');for(const [key,label]of [['field','활동 분야'],['source','출처']])meta.append(el('dt','',label),el('dd','',item[key]||'미확인'));content.append(meta);}
    const label=el('label','life-field');label.append(el('span','',item.type==='person'?'좋아하는 이유 · 비공개 메모':'내 메모 · 시안 안에서만 유지'));
    const note=el('textarea','detail-note');note.value=item.note;note.rows=4;note.maxLength=4000;label.append(note);content.append(label);
    const status=el('p','muted');status.setAttribute('role','status');
    // Keep the dialog opener in the DOM while editing, so native close restores focus.
    note.addEventListener('input',()=>{item.note=note.value;status.textContent='이 화면에 임시 반영됨 · 새로고침하면 초기화';});content.append(status);
    const actions=el('div','detail-actions');actions.append(button('글에 연결',()=>{state.selected.add(item.id);renderInserted();$('detail').close();showWriting();}));content.append(actions);
    content.append(el('p','muted','가상 샘플 · 실제 작품 정보가 아닙니다.'));
    $('detail').showModal();
  }
  $('detail').addEventListener('close',()=>{
    // Update visible notes in place: closing must not remove the focused opener.
    for(const card of $('grid').querySelectorAll('.object-card')){const item=find(card.dataset.id);if(item)card.querySelector('.card-note').textContent=item.note||'메모 없음';}
  });
  function renderInserted(){
    $('inserted').replaceChildren();
    for(const id of state.selected){const item=find(id);if(!item)continue;const row=el('div','inserted-card');row.dataset.id=id;const info=el('div','info');info.append(el('span','card-title',item.title),el('span','card-creator',subtitle(item)));row.append(art(item),info,button(`${item.title} 연결 해제`,()=>{state.selected.delete(id);renderInserted();$('pick').focus();},'close'));$('inserted').append(row);}
  }
  function renderPicker(){
    const q=$('pickerQuery').value.trim().toLocaleLowerCase('ko');const shown=items.filter(i=>`${i.title} ${subtitle(i)}`.toLocaleLowerCase('ko').includes(q));$('pickerGrid').replaceChildren();
    for(const item of shown)$('pickerGrid').append(card(item,()=>{if(state.pending.has(item.id))state.pending.delete(item.id);else state.pending.add(item.id);renderPicker();$('pickerGrid').querySelector(`[data-id="${item.id}"]`).focus();},true));
    if(!shown.length)$('pickerGrid').append(el('p','muted','검색 결과가 없어요. 검색어를 지우고 다시 찾아보세요.'));
    $('selectedCount').textContent=`${state.pending.size}개 선택`;
  }
  $('pick').addEventListener('click',()=>{state.pending=new Set(state.selected);$('pickerQuery').value='';renderPicker();$('picker').showModal();$('pickerQuery').focus();});
  $('pickerQuery').addEventListener('input',renderPicker);
  $('applySelection').addEventListener('click',()=>{state.selected=new Set(state.pending);renderInserted();$('picker').close();notify(`${state.selected.size}개 항목을 시안 글에 연결했습니다.`);});
  for(const [id,label]of Object.entries(types)){if(id==='all')continue;const opt=el('option','',label);opt.value=id;$('newType').append(opt);}
  const updateArtFields=()=>{const person=$('newType').value==='person';$('personFields').hidden=!person;$('newTitle').previousElementSibling.textContent=person?'이름':'제목';$('newCreator').parentElement.hidden=person;$('artworkFields').hidden=$('newType').value!=='artwork';$('filmFields').hidden=$('newType').value!=='film';$('newCreator').previousElementSibling.textContent=$('newType').value==='film'?'감독 · 선택':'만든 사람 · 선택';};
  $('newType').addEventListener('change',updateArtFields);
  $('addForm').addEventListener('reset',()=>queueMicrotask(updateArtFields));
  $('addForm').addEventListener('submit',e=>{
    e.preventDefault();$('addError').textContent='';const title=$('newTitle').value.trim(),url=$('newUrl').value.trim();
    if(!title){$('addError').textContent='제목을 입력해 주세요.';$('newTitle').focus();return;}
    if(url&&!/^https?:\/\//i.test(url)){ $('addError').textContent='http 또는 https 주소를 입력해 주세요.';$('newUrl').focus();return; }
    const duplicate=items.find(i=>{
      if(url&&i.url===url)return true;
      if(i.title!==title||i.type!==$('newType').value)return false;
      if(i.type==='person')return url&&i.url?url===i.url:i.field===$('newPersonField').value.trim();
      if(i.type==='film')return i.year===$('newFilmYear').value.trim()&&i.creator===($('newCreator').value.trim()||'만든 사람 미확인');
      return true;
    });
    if(duplicate){$('addError').textContent='같은 정보 또는 주소의 항목이 있어요. 기존 항목을 확인하거나 제목을 구분해 주세요.';return;}
    const artwork=$('newType').value==='artwork'?{year:$('newYear').value.trim(),medium:$('newMedium').value.trim(),holding:$('newHolding').value.trim(),source:url||'출처 미확인',rights:'이미지 이용 조건 미확인',orientation:$('newOrientation').value}:{};
    const film=$('newType').value==='film'?{year:$('newFilmYear').value.trim(),country:$('newCountry').value.trim(),duration:$('newDuration').value.trim(),source:url||'출처 미확인',rights:'포스터 이용 조건 미확인'}:{};
    const person=$('newType').value==='person'?{field:$('newPersonField').value.trim(),source:url||'출처 미확인'}:{};
    items.unshift({...artwork,...film,...person,id:crypto.randomUUID(),type:$('newType').value,title,creator:$('newType').value==='person'?'':($('newCreator').value.trim()||'만든 사람 미확인'),url,tone:'neutral',groups:[],note:$('newType').value==='person'?$('newPersonNote').value:'',detail:'직접 입력 · 표지 없음 · 시안 임시 항목'});
    state.type='all';state.group='all';state.query='';$('query').value='';$('collection').value='all';setScenario('ready');renderTypes();$('add').close();$('addForm').reset();notify('시안에 추가했습니다. 실제 저장은 아니며 새로고침하면 초기화됩니다.');
  });
  renderModes();renderTypes();renderGrid();
})();

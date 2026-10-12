/* Independent design study: explicit files only, no account or public writes. */
(() => {
 'use strict';
 const $ = id => document.getElementById(id), icons = HaedoLife.Icons;
 const items = new Map(CollectionSample.map(item => [item.id, structuredClone(item)]));
 const initial = {
  title:'느리게 듣고,\n오래 만드는 것.', description:'자주 듣는 음악과 읽다 접어 둔 책.\n언젠가 만들어 보고 싶은 작은 도구들.',
  note:'새로운 것을 더하기보다,\n오래 좋아할 것을\n천천히 고르고 싶다.',
  layout:'gallery', accent:'ink', paper:'white', font:'sans', density:'airy',
  noteVisible:true, metadata:true, featured:true, collection:true, swapped:false,
  featuredName:'요즘 곁에 둔 것', collectionName:'조용한 저녁',
  featuredItems:['m1','b1','t1','t2'], collectionItems:['m2','b2','m3','a1']
 };
 let state = structuredClone(initial), history = [], editing = null, renderedItems = '', revision = 0, loading = false;
 const el = (tag, cls, text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };
 const announce = text => { $('status').textContent=text; };
 document.querySelectorAll('[data-icon]').forEach(n => n.append(icons.create(n.dataset.icon)));
 function art(item){
   if(item.type==='tool'){const n=el('span','tool-icon'+(item.id==='t2'?' map':''));n.setAttribute('aria-hidden','true');n.append(icons.create(item.id==='t2'?'map':'workspace'));return n;}
   const n=el('span','art');n.setAttribute('aria-hidden','true');
   if(item.type==='artwork'){n.classList.add('artwork',item.orientation==='landscape'?'landscape':'portrait');n.append(el('span','','이미지 미연결'));return n;}
   if(item.type==='music'){const image=el('span','photo '+({m1:'water',m2:'curtain',m3:'metal'}[item.id]||'water'));n.append(image,el('span','album-lettering',item.cover));}
   else if(item.type==='book'){n.classList.add('book');if(item.id==='b2')n.classList.add('cream');n.append(el('span','book-label',item.cover),el('span','photo '+(item.id==='b2'?'metal':'flower')),el('span','book-author',item.creator));}
   else {n.classList.add('article', 'kind-'+item.type);n.append(el('span','',item.cover||item.title));}
   return n;
 }
 function card(id,framed=false){const item=items.get(id),b=el('button','object'+(item.type==='tool'&&!framed?' tool-object':''));b.type='button';b.dataset.item=id;b.setAttribute('aria-label',item.title+' 자세히 보기');
   const media=art(item);if(framed){const frame=el('span','media-frame');frame.append(media);b.append(frame);}else b.append(media);
   const info=el('span','object-info');info.append(el('span','object-title',item.title),el('span','object-creator',item.creator));b.append(info);b.addEventListener('click',()=>openItem(item));return b;
 }
 function openItem(item){$('itemTitle').textContent=item.title;const content=$('itemContent');content.replaceChildren(art(item),el('p','',item.creator),el('p','item-source',item.detail));if(item.type==='artwork'){const meta=el('dl','artwork-meta');for(const [key,label]of [['year','제작 연도'],['medium','재료·기법'],['holding','소장처'],['source','출처'],['rights','이미지 이용 조건']])meta.append(el('dt','',label),el('dd','',item[key]||'미확인'));content.append(meta);}if(!document.body.classList.contains('previewing'))content.append(el('p','item-note-label','샘플에 남긴 비공개 메모'),el('p','',item.note));content.append(el('p','item-source','가상 자료입니다. 실제 원문·재생은 연결하지 않았습니다.'));$('itemDialog').showModal();}

 const fields = {titleInput:'title',descriptionInput:'description',noteInput:'note',accentInput:'accent',paperInput:'paper',fontInput:'font',densityInput:'density',noteToggle:'noteVisible',metadataToggle:'metadata',featuredToggle:'featured',collectionToggle:'collection'};
 const choices = [['gallery','전시','workspace'],['editorial','글 중심','quote'],['archive','간결하게','book']];
 for(const [key,label,icon] of choices){
  const b=el('button','layout-choice'); b.type='button'; b.dataset.layoutChoice=key;
  b.append(icons.create(icon),el('span','',label)); b.addEventListener('click',()=>change({layout:key})); $('layoutChoices').append(b);
 }
 function remember(){ history.push(structuredClone(state)); if(history.length>80)history.shift(); }
 function change(patch, field=null){
  if(Object.entries(patch).every(([k,v])=>JSON.stringify(state[k])===JSON.stringify(v)))return;
  if(!field || editing!==field)remember();
  editing=field; Object.assign(state,patch); revision++; render();
  $('fileStatus').textContent='변경됨 · 보관하려면 파일을 내려받으세요.';
 }
 function render(syncFields=false){
  $('pageTitle').textContent=state.title.trim()||'나의 취향'; $('pageDescription').textContent=state.description; $('noteText').textContent=state.note;
  Object.assign($('page').dataset,{layout:state.layout,font:state.font,density:state.density,metadata:state.metadata?'show':'hide'});
  document.documentElement.dataset.accent=state.accent; document.documentElement.dataset.paper=state.paper;
  $('personalNote').hidden=!state.noteVisible||!state.note.trim(); $('featuredSection').hidden=!state.featured; $('collectionSection').hidden=!state.collection;
  $('hiddenHint').hidden=state.featured||state.collection; document.querySelector('.profile .quiet-link').hidden=!state.collection;
  $('featuredHeading').textContent=state.featuredName.trim()||'첫 번째 모음'; $('collectionHeading').textContent=state.collectionName.trim()||'두 번째 모음';
  for(const key of ['featured','collection']){
   const name=$(key+'Heading').textContent;$(key+'Toggle').nextElementSibling.textContent=name;
   $('sectionTarget').querySelector('[value='+key+']').textContent=name;
  }
  // Cards are recreated only when their membership/order changes, never while typing.
  const signature=JSON.stringify([state.featuredItems,state.collectionItems]);
  if(signature!==renderedItems){
   for(const [container,ids] of [['featuredAlbum',state.featuredItems.slice(0,1)],['featuredBook',state.featuredItems.slice(1,2)],['featuredTools',state.featuredItems.slice(2)],['collectionGrid',state.collectionItems]]){
    $(container).replaceChildren(...ids.map(id=>card(id,container==='collectionGrid')));
    $(container).hidden=!ids.length;
   }
   $('featuredEmpty').hidden=state.featuredItems.length>0; $('collectionEmpty').hidden=state.collectionItems.length>0;
   document.querySelector('.feature-grid').classList.toggle('many-items',state.featuredItems.length>4);
   renderedItems=signature;
  }
  const order=state.swapped?['collectionSection','featuredSection']:['featuredSection','collectionSection'];
  if($('sections').firstElementChild.id!==order[0])for(const id of order)$('sections').append($(id));
  $('sectionOrder').textContent=order.map(id=>id==='featuredSection'?$('featuredHeading').textContent:$('collectionHeading').textContent).join(' → ');
  document.querySelectorAll('[data-layout-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layoutChoice===state.layout)));
  $('undo').disabled=$('editorUndo').disabled=history.length===0;
  if(syncFields){
   for(const [id,key]of Object.entries(fields))if($(id).type==='checkbox')$(id).checked=state[key];else $(id).value=state[key];
   renderPicker();
  }
 }
 for(const id of ['featured','collection']){
  const hint=el('p','empty-section','아직 고른 자료가 없습니다. 꾸미기에서 자료를 넣어 보세요.'); hint.id=id+'Empty'; $(id+'Section').append(hint);
 }
 function renderPicker(focusId){
  const section=$('sectionTarget').value, ids=state[section+'Items'];
  $('sectionName').value=state[section+'Name']; $('selectedItems').replaceChildren();
  ids.forEach((id,index)=>{
   const row=el('li','selected-row'), title=el('span','',items.get(id).title); row.append(title);
   for(const [action,label,icon,disabled] of [['up','앞으로','arrow',index===0],['down','뒤로','arrow',index===ids.length-1],['remove','제외','close',false]]){
    const b=el('button','icon-button move-'+action);b.type='button';b.id='pick-'+id+'-'+action;
    b.setAttribute('aria-label',items.get(id).title+' '+label);b.title=label;b.disabled=disabled;b.append(icons.create(icon));
    b.addEventListener('click',()=>{
     const next=[...state[section+'Items']], at=next.indexOf(id);
     if(action==='remove')next.splice(at,1);else{const dest=at+(action==='up'?-1:1);[next[at],next[dest]]=[next[dest],next[at]];}
     change({[section+'Items']:next}); renderPicker(action==='remove'?null:b.id);
     if(action==='remove')$('addItem').focus(); announce(items.get(id).title+' '+label+' 완료');
    });row.append(b);
   }$('selectedItems').append(row);
  });
  $('itemToAdd').replaceChildren(...[...items.values()].filter(item=>!ids.includes(item.id)).map(item=>{const option=el('option','',item.title+' · '+item.creator);option.value=item.id;return option;}));
  $('itemToAdd').disabled=$('addItem').disabled=ids.length===items.size;
  if(focusId){const target=$(focusId);if(target&&!target.disabled)target.focus();else $('sectionTarget').focus();}
 }
 $('sectionTarget').addEventListener('change',()=>{editing=null;renderPicker();});
 $('sectionName').addEventListener('input',()=>change({[$('sectionTarget').value+'Name']:$('sectionName').value},'sectionName'));
 $('sectionName').addEventListener('blur',()=>{editing=null;});
 $('addItem').addEventListener('click',()=>{const key=$('sectionTarget').value+'Items',id=$('itemToAdd').value;if(!id||state[key].includes(id))return;change({[key]:[...state[key],id]});renderPicker();announce('자료를 넣었습니다.');});
 for(const [id,key]of Object.entries(fields)){
  const n=$(id), text=n.tagName==='TEXTAREA';
  n.addEventListener(text?'input':'change',()=>change({[key]:n.type==='checkbox'?n.checked:n.value},text?id:null));
  if(text)n.addEventListener('blur',()=>{editing=null;});
 }
 $('settingsForm').addEventListener('submit',e=>e.preventDefault());
 $('swapSections').addEventListener('click',()=>change({swapped:!state.swapped}));
 function undo(){if(!history.length)return;editing=null;state=history.pop();revision++;render(true);announce('마지막 편집을 되돌렸습니다.');}
 $('undo').addEventListener('click',undo);$('editorUndo').addEventListener('click',undo);
 $('resetPage').addEventListener('click',()=>{remember();editing=null;state=structuredClone(initial);revision++;render(true);announce('처음 배치로 돌아왔습니다. 되돌리기로 복구할 수 있습니다.');});
 function closeEditor(){ $('editor').close(); $('customize').focus(); }
 $('customize').addEventListener('click',()=>{if(!$('editor').open)$('editor').show();$('closeEditor').focus();});
 $('closeEditor').addEventListener('click',closeEditor);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('editor').open&&!$('itemDialog').open){e.preventDefault();closeEditor();}});
 $('closeItem').addEventListener('click',()=>$('itemDialog').close());
 function preview(){if($('editor').open)$('editor').close();document.body.classList.add('previewing');$('previewBar').hidden=false;$('returnEdit').focus();announce('비공개 미리보기입니다. 자료의 비공개 메모는 표시하지 않습니다. 게시하지 않았습니다.');}
 $('preview').addEventListener('click',preview);$('editorPreview').addEventListener('click',preview);
 $('returnEdit').addEventListener('click',()=>{document.body.classList.remove('previewing');$('previewBar').hidden=true;$('customize').focus();});
 // Explicit, bounded design file. No records, source text, provider responses or private item notes.
 function validate(value){
  if(!value||value.format!=='haedo-taste-prototype'||value.version!==1||!value.page||Array.isArray(value.page))throw Error('해도 취향 시안 v1 파일을 선택해 주세요.');
  const p=value.page, keys=Object.keys(initial);if(Object.keys(p).length!==keys.length||keys.some(k=>!Object.hasOwn(p,k)))throw Error('시안 항목이 맞지 않습니다. 현재 편집은 유지됩니다.');
  for(const [key,max]of [['title',100],['description',300],['note',500],['featuredName',80],['collectionName',80]])if(typeof p[key]!=='string'||p[key].length>max)throw Error('텍스트 형식 또는 길이가 맞지 않습니다.');
  for(const [key,options]of [['layout',['gallery','editorial','archive']],['accent',['ink','moss','violet']],['paper',['white','warm']],['font',['sans','serif']],['density',['airy','close']]])if(!options.includes(p[key]))throw Error('지원하지 않는 꾸미기 설정입니다.');
  for(const key of ['noteVisible','metadata','featured','collection','swapped'])if(typeof p[key]!=='boolean')throw Error('표시 설정이 맞지 않습니다.');
  for(const key of ['featuredItems','collectionItems'])if(!Array.isArray(p[key])||p[key].length>items.size||new Set(p[key]).size!==p[key].length||p[key].some(id=>!items.has(id)))throw Error('알 수 없거나 중복된 자료가 있습니다.');
  return structuredClone(p);
 }
 $('downloadPage').addEventListener('click',()=>{
  $('fileError').hidden=true;
  try{
   const blob=new Blob([JSON.stringify({format:'haedo-taste-prototype',version:1,page:state},null,2)],{type:'application/json'});
   const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='haedo-taste-page.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   $('fileStatus').textContent='다운로드를 요청했습니다. 파일이 보관됐는지 확인해 주세요.';
  }catch{ $('fileError').hidden=false;$('fileError').textContent='파일을 만들지 못했습니다. 편집은 유지됩니다. 다시 내려받아 주세요.'; }
 });
 $('loadPage').addEventListener('change',async()=>{
  const file=$('loadPage').files[0];$('loadPage').value='';if(!file||loading)return;
  const started=revision;loading=true;$('loadPage').disabled=true;$('fileError').hidden=true;$('fileStatus').textContent='시안 파일을 확인하는 중…';
  try{
   if(file.size>32000)throw Error('32KB 이하의 시안 파일을 선택해 주세요.');
   const next=validate(JSON.parse(await file.text()));
   if(revision!==started)throw Error('파일을 읽는 동안 편집이 바뀌었습니다. 현재 내용을 유지합니다. 다시 열어 주세요.');
   remember();editing=null;state=next;revision++;render(true);$('fileStatus').textContent='시안 파일을 열었습니다. 되돌리기로 이전 편집을 복구할 수 있습니다.';
  }catch(error){$('fileError').hidden=false;$('fileError').textContent=error instanceof SyntaxError?'JSON 파일을 읽지 못했습니다. 현재 편집은 유지됩니다.':error.message;$('fileStatus').textContent='파일 열기 실패 · 현재 편집 유지';}
  finally{loading=false;$('loadPage').disabled=false;}
 });
 window.addEventListener('beforeunload',event=>{if(JSON.stringify(state)!==JSON.stringify(initial)){event.preventDefault();event.returnValue='';}});
 render(true);
})();

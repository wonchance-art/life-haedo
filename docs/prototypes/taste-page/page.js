/* Standalone page-design study. All edits are memory-only; no account or public writes. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id), icons=HaedoLife.Icons;
 const items=new Map(CollectionSample.map(x=>[x.id,structuredClone(x)]));
 const initial={title:'느리게 듣고,\n오래 만드는 것.',description:'자주 듣는 음악과 읽다 접어 둔 책.\n언젠가 만들어 보고 싶은 작은 도구들.',note:'새로운 것을 더하기보다,\n오래 좋아할 것을\n천천히 고르고 싶다.',layout:'gallery',accent:'ink',paper:'white',font:'sans',density:'airy',album:'m1',noteVisible:true,metadata:true,featured:true,collection:true,swapped:false};
 let state=structuredClone(initial), history=[],renderedAlbum=null;
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const announce=text=>{$('status').textContent=text;};
 document.querySelectorAll('[data-icon]').forEach(n=>n.append(icons.create(n.dataset.icon)));
 function art(item){
   if(item.type==='tool'){const n=el('span','tool-icon'+(item.id==='t2'?' map':''));n.setAttribute('aria-hidden','true');n.append(icons.create(item.id==='t2'?'map':'workspace'));return n;}
   const n=el('span','art');n.setAttribute('aria-hidden','true');
   if(item.type==='music'){const image=el('span','photo '+({m1:'water',m2:'curtain',m3:'metal'}[item.id]||'water'));n.append(image,el('span','album-lettering',item.cover));}
   else if(item.type==='book'){n.classList.add('book');if(item.id==='b2')n.classList.add('cream');n.append(el('span','book-label',item.cover),el('span','photo '+(item.id==='b2'?'metal':'flower')),el('span','book-author',item.creator));}
   else {n.classList.add('article');n.append(el('span','',item.cover||item.title));}
   return n;
 }
 function card(id,framed=false){const item=items.get(id),b=el('button','object'+(item.type==='tool'?' tool-object':''));b.type='button';b.dataset.item=id;b.setAttribute('aria-label',item.title+' 자세히 보기');
   const media=art(item);if(framed){const frame=el('span','media-frame');frame.append(media);b.append(frame);}else b.append(media);
   const info=el('span','object-info');info.append(el('span','object-title',item.title),el('span','object-creator',item.creator));b.append(info);b.addEventListener('click',()=>openItem(item));return b;
 }
 function openItem(item){$('itemTitle').textContent=item.title;const content=$('itemContent');content.replaceChildren(art(item),el('p','',item.creator),el('p','item-source',item.detail));content.append(el('p','item-note-label','샘플에 남긴 메모'),el('p','',item.note),el('p','item-source','가상 작품·AI 생성 표지입니다. 실제 원문·재생은 연결하지 않았습니다.'));$('itemDialog').showModal();}
 $('featuredBook').append(card('b1'));$('featuredTools').append(card('t1'),card('t2'));$('collectionGrid').append(...['m2','b2','m3','a1'].map(id=>card(id,true)));
 const fields={titleInput:'title',descriptionInput:'description',noteInput:'note',accentInput:'accent',paperInput:'paper',fontInput:'font',densityInput:'density',albumInput:'album',noteToggle:'noteVisible',metadataToggle:'metadata',featuredToggle:'featured',collectionToggle:'collection'};
 const choices=[['gallery','전시','workspace'],['editorial','글 중심','quote'],['archive','보관함','book']];
 for(const [key,label,icon]of choices){const b=el('button','layout-choice');b.type='button';b.dataset.layoutChoice=key;b.append(icons.create(icon),el('span','',label));b.addEventListener('click',()=>change({layout:key}));$('layoutChoices').append(b);}
 function remember(){history.push(structuredClone(state));if(history.length>40)history.shift();}
 function change(patch){if(Object.entries(patch).every(([k,v])=>state[k]===v))return;remember();Object.assign(state,patch);render();}
 function render(syncFields=false){
   $('pageTitle').textContent=state.title.trim()||'나의 취향';$('pageDescription').textContent=state.description;$('noteText').textContent=state.note;
   $('page').dataset.layout=state.layout;$('page').dataset.font=state.font;$('page').dataset.density=state.density;$('page').dataset.metadata=state.metadata?'show':'hide';
   document.documentElement.dataset.accent=state.accent;document.documentElement.dataset.paper=state.paper;
   $('personalNote').hidden=!state.noteVisible;$('featuredSection').hidden=!state.featured;$('collectionSection').hidden=!state.collection;
   $('hiddenHint').hidden=state.featured||state.collection;
   document.querySelector('.profile .quiet-link').hidden=!state.collection;
   if(renderedAlbum!==state.album){$('featuredAlbum').replaceChildren(card(state.album));renderedAlbum=state.album;}
   const expected=state.swapped?['collectionSection','featuredSection']:['featuredSection','collectionSection'];
   if($('sections').firstElementChild.id!==expected[0])for(const id of expected)$('sections').append($(id));
   $('sectionOrder').textContent=state.swapped?'조용한 저녁 → 요즘 곁에 둔 것':'요즘 곁에 둔 것 → 조용한 저녁';
   document.querySelectorAll('[data-layout-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layoutChoice===state.layout)));
   $('undo').disabled=history.length===0;
   if(syncFields)for(const[id,key]of Object.entries(fields)){if($(id).type==='checkbox')$(id).checked=state[key];else $(id).value=state[key];}
 }
 for(const[id,key]of Object.entries(fields))$(id).addEventListener(['TEXTAREA','INPUT'].includes($(id).tagName)&&$(id).type!=='checkbox'?'input':'change',()=>change({[key]:$(id).type==='checkbox'?$(id).checked:$(id).value}));
 $('settingsForm').addEventListener('submit',e=>e.preventDefault());
 $('swapSections').addEventListener('click',()=>change({swapped:!state.swapped}));
 $('undo').addEventListener('click',()=>{if(!history.length)return;state=history.pop();render(true);announce('마지막 꾸미기 변경을 되돌렸습니다.');});
 $('resetPage').addEventListener('click',()=>{remember();state=structuredClone(initial);render(true);announce('처음 배치로 돌아왔습니다. 닫은 뒤 되돌리기로 복구할 수 있습니다.');});
 $('customize').addEventListener('click',()=>{$('editor').showModal();$('closeEditor').focus();});
 $('closeEditor').addEventListener('click',()=>$('editor').close());$('closeItem').addEventListener('click',()=>$('itemDialog').close());
 function preview(){if($('editor').open)$('editor').close();document.body.classList.add('previewing');$('previewBar').hidden=false;$('returnEdit').focus();announce('비공개 미리보기입니다. 게시하지 않았습니다.');}
 $('preview').addEventListener('click',preview);$('editorPreview').addEventListener('click',preview);
 $('returnEdit').addEventListener('click',()=>{document.body.classList.remove('previewing');$('previewBar').hidden=true;$('customize').focus();});
 document.querySelectorAll('dialog').forEach(d=>d.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const a=[...d.querySelectorAll('button,input,textarea,select,a[href]')].filter(n=>!n.disabled&&n.getClientRects().length);const first=a[0],last=a.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}));
 render();
})();

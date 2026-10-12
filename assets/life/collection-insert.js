/* Shared choose/review flow. The caller owns persistence and destination lifetime. */
(function(root){
  'use strict';
  const life=root.HaedoLife,node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
  function open({items,isCurrent,onInsert,label}) {
    let alive=true,closeCurrent=null;
    function dispose(){alive=false;closeCurrent?.();closeCurrent=null;}
    function review(choice){
      if(!alive||!isCurrent())return;
      const value=choice.item||choice.seed,origin=document.activeElement,dialog=node('dialog',null,'life-collection cl-picker cl-reference-dialog');
      const previousOverflow=document.body.style.overflow;
      function close(){if(!dialog.isConnected)return;dialog.close();dialog.remove();document.body.style.overflow=previousOverflow;if(origin?.isConnected)origin.focus({preventScroll:true});}
      closeCurrent=close;
      const head=node('header',null,'cl-picker-head'),title=node('h2','넣을 정보 확인');title.id='clReferenceTitle';dialog.setAttribute('aria-labelledby',title.id);
      const exit=node('button',null,'life-icon-button');exit.type='button';exit.setAttribute('aria-label','정보 넣기 취소');exit.append(life.Icons.create('close'));exit.onclick=dispose;head.append(title,exit);
      const form=node('form'),content=node('div',null,'cl-picker-body');
      const preview=node('p','', 'cl-reference-preview');preview.id='clReferencePreview';
      const info=node('details');info.open=!value.title;info.append(node('summary','정보 수정'));
      const controls={};
      for(const [key,label] of [['title','제목'],['creator','만든 사람'],['url','출처 주소']]){
        if(value.type==='person'&&key==='creator')continue;
        const wrap=node('label',null,'life-field'),input=node(key==='url'?'input':'textarea');input.value=value[key]||'';input.id='clReference-'+key;input.maxLength=key==='url'?2048:500;input.required=key==='title';if(key==='url')input.type='url';else input.rows=2;wrap.append(node('span',label),input);info.append(wrap);controls[key]=input;
      }
      const data=()=>({type:value.type,title:controls.title.value,creator:controls.creator?.value||'',url:controls.url.value});
      const refresh=()=>{try{preview.textContent=life.CollectionReference.from(data()).text;}catch(_){preview.textContent='제목과 출처를 확인해 주세요.';}};
      info.addEventListener('input',refresh);refresh();
      const help=node('p','제목·만든 사람·출처를 텍스트로 넣습니다. 비공개 메모는 제외하며, 컬렉션을 바꿔도 넣은 내용은 그대로 유지됩니다.','life-help');
      const error=node('p','', 'life-error');error.setAttribute('role','alert');error.hidden=true;
      const footer=node('div',null,'cl-picker-foot');const submit=node('button',label,'life-button life-primary');submit.type='submit';const back=node('button','다시 고르기','life-button');back.type='button';back.onclick=()=>{close();choose();};footer.append(back,submit);
      content.append(preview,info,help,error);form.append(content,footer);dialog.append(head,form);
      let composing=false;form.addEventListener('compositionstart',()=>{composing=true;});form.addEventListener('compositionend',()=>{composing=false;});
      form.addEventListener('invalid',()=>{info.open=true;},true);
      form.addEventListener('submit',event=>{event.preventDefault();if(composing||!alive||!isCurrent())return;try{const reference=life.CollectionReference.from(data());onInsert(reference);dispose();}catch(cause){error.textContent=cause.message;error.hidden=false;}});
      dialog.addEventListener('cancel',event=>{event.preventDefault();dispose();});
      dialog.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const controls=[...dialog.querySelectorAll('button,input,textarea,summary')].filter(e=>!e.disabled&&e.getClientRects().length);const target=event.shiftKey&&document.activeElement===controls[0]?controls.at(-1):!event.shiftKey&&document.activeElement===controls.at(-1)?controls[0]:null;if(target){event.preventDefault();target.focus();}});
      document.body.append(dialog);document.body.style.overflow='hidden';dialog.showModal();(value.title?submit:controls.title).focus();
    }
    function choose(){if(!alive||!isCurrent())return;closeCurrent=life.CollectionPicker.open({items,isCurrent:()=>alive&&isCurrent(),onSelect:review,purpose:'insert'});}
    choose();return dispose;
  }
  life.CollectionInsert={open};
})(window);

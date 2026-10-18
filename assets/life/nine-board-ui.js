/* Private local board editor; shares the collection picker and safe snapshot renderer. */
(function(root){
  'use strict';
  const life=root.HaedoLife ||= {},M=life.NineBoard;
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  function create({storage,workspaceId,isCurrent,onDirty=()=>{},getBundle=()=>storage.read(workspaceId),onComposeArea=null,onComposed=()=>{},onOpenReference=()=>{throw new Error('원문 열기를 연결하지 못했습니다. 구절과 출처는 그대로 보관됩니다.');}}){
    let state=null,base=[],host=null,status=null,error=null,selected=null,areaId=null,editing=null,preview=false,overview=false;
    let tick=0,stored=0,timer=null,saving=null,failure=null,epoch=0,manual=null,picker=null,candidate=null,busy=false,importUpdate=null;
    let evidencePicker=null,evidencePending=false,incoming=null;
    let composeReview=null,composeReceipt=null,composeSequence=0;
    const composing=new Set(),pendingFields=new Set(),urls=new Set(),fresh=()=>life.Core.id(),valid=()=>isCurrent(),board=()=>state?.boards.find(b=>b.id===selected),area=()=>board()?.areas.find(a=>a.id===areaId);
    const fault=(code,message)=>Object.assign(new Error(message),{code});
    function dirty(){return evidencePending||!!manual||pendingFields.size>0||composing.size>0||!!saving||busy||tick!==stored;}
    function message(){
      if(!host?.isConnected||!status||!valid())return;
      status.textContent=failure?'저장하지 못함 · 입력 유지':pendingFields.size?'문자·용량 확인 필요 · 입력 유지':manual?'대상 입력 중 · 아직 담지 않음':saving?'이 브라우저에 저장 중…':tick!==stored?'저장 전 변경 있음':'이 브라우저에 저장됨';
      status.dataset.state=failure?'error':dirty()?'dirty':'saved';importUpdate?.();onDirty();
    }
    function report(cause){failure=cause;if(error?.isConnected&&valid()){error.textContent=cause.message||'저장하지 못했습니다. 입력은 유지됩니다. 파일을 보관하거나 다시 시도해 주세요.';error.hidden=false;const recovery=host.querySelector('.nb-recovery');if(recovery){recovery.hidden=false;recovery.children[1].hidden=cause.code!=='nine_board_conflict';}}message();}
    function clear(){failure=null;if(error){error.textContent='';error.hidden=true;}const recovery=host?.querySelector('.nb-recovery');if(recovery)recovery.hidden=true;message();}
    function guard(){if(!valid())throw new Error('작업공간이 바뀌었습니다.');if(evidencePending)throw fault('nine_input_pending','원문 선택을 마치거나 취소해 주세요.');if(composing.size)throw fault('nine_input_in_progress','입력을 마친 뒤 다시 시도해 주세요.');if(pendingFields.size)throw fault('nine_input_pending','입력은 남아 있습니다. 문자와 전체 용량을 확인해 내용을 줄인 뒤 다시 시도해 주세요.');if(manual)throw fault('nine_input_pending','대상을 담거나 입력 취소를 누른 뒤 다시 시도해 주세요.');if(busy)throw fault('nine_busy','저장을 마친 뒤 다시 시도해 주세요.');}
    function mark(){clearCompose();tick++;clearTimeout(timer);message();if(failure?.code!=='nine_board_conflict')timer=setTimeout(()=>{if(!composing.size&&!manual&&!pendingFields.size&&!busy)flush().catch(report);},450);}
    async function flush(){
      guard();clearTimeout(timer);timer=null;
      if(!state){if(!dirty())return;throw new Error('9칸 구성을 먼저 불러와 주세요.');}
      if(saving){await saving;return flush();}
      if(tick===stored)return;
      if(failure?.code==='nine_board_conflict')throw failure;
      const version=tick,payload=structuredClone(state);
      const task=(async()=>{
        try{const saved=await storage.saveNineBoard(workspaceId,payload,payload.revision);
          if(!valid())return;state.revision=saved.revision;base=structuredClone(saved.boards);stored=version;clear();
        }catch(cause){report(cause);throw cause;}finally{saving=null;message();}
      })();saving=task;message();await task;if(tick!==stored)return flush();
    }
    function button(label,task,cls='life-button'){
      const b=el('button',label,cls);b.type='button';b.addEventListener('click',async()=>{
        if(!valid()||!b.isConnected||busy||b.dataset.pending==='true')return;b.disabled=true;b.dataset.pending='true';
        try{await task();}catch(cause){report(cause);}finally{delete b.dataset.pending;if(b.isConnected){b.disabled=false;importUpdate?.();}}
      });return b;
    }
    function field(label,value,change,{multiline=false,max=500,id}={}){
      const wrapper=el('label',null,'life-field'),input=el(multiline?'textarea':'input');wrapper.append(el('span',label),input);
      input.value=value;input.maxLength=max;if(id)input.id=id;if(multiline)input.rows=2;else input.type='text';
      let accepted=value;
      function apply(){
        if(!valid())return;
        if(!['nbTitle','nbIntro','nbAreaTitle','nbAreaNote'].includes(id)){change(input.value);return;}
        change(input.value);
        try{M.validate(state);accepted=input.value;pendingFields.delete(input);}
        catch(cause){change(accepted);pendingFields.add(input);report(cause);}
        message();
      }
      input.addEventListener('compositionstart',()=>{clearCompose();composing.add(input);});
      input.addEventListener('compositionend',()=>{composing.delete(input);apply();message();});
      input.addEventListener('input',apply);return {wrapper,input};
    }
    function details(title){const n=el('details',null,'wb-details nb-details');n.append(el('summary',title));return n;}
    function lock(){const controls=[...host.querySelectorAll('button,input,textarea,select')].map(n=>[n,n.disabled]);controls.forEach(([n])=>n.disabled=true);return ()=>controls.forEach(([n,disabled])=>{if(n.isConnected)n.disabled=disabled;});}
    function download(value,name,type){
      const url=URL.createObjectURL(new Blob([value],{type}));urls.add(url);const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
      setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},1000);
    }
    function backup(current=false){if(!state)return;if(composing.size)throw new Error('입력을 마친 뒤 파일을 받아 주세요.');if(pendingFields.size)throw new Error('문자와 용량을 확인한 뒤 파일을 받아 주세요.');if(manual)throw new Error('대상을 담거나 입력 취소를 누른 뒤 파일을 받아 주세요.');const values=current?[board()]:state.boards;download(JSON.stringify(M.backup(values),null,2),current?'haedo-nine-board.json':'haedo-nine-boards-backup.json','application/json');}
    async function image(areaId){
      await flush();guard();const token=epoch,source=structuredClone(board());
      clear();busy=true;const unlock=lock();message();
      try{const blob=await M.png(source,areaId);if(!valid()||token!==epoch||!host?.isConnected)return;download(blob,'haedo-nine-board.png','image/png');}
      catch(cause){if(valid()&&token===epoch&&error?.isConnected){error.textContent=cause.message||'PNG를 만들지 못했습니다. JSON이나 HTML로 보관해 주세요.';error.hidden=false;}}
      finally{busy=false;unlock();message();}
    }
    function clearCompose(){
      composeSequence++;
      if(composeReview?.url){URL.revokeObjectURL(composeReview.url);urls.delete(composeReview.url);}
      composeReview=null;host?.querySelector('#nbComposeReview')?.remove();
    }
    function composeError(cause,reload=false){
      if(valid()&&error?.isConnected){
        error.textContent=cause.message||'새 초안을 만들지 못했습니다. 원래 구성은 그대로입니다. 다시 시도해 주세요.';error.hidden=false;
        if(reload||['nine_board_compose_stale','nine_board_conflict'].includes(cause.code)){
          const retry=button('9칸 다시 불러오기',reloadCompose);retry.id='nbComposeReload';error.append(' ',retry);
        }
      }
    }
    async function reloadCompose(){
      guard();await flush();guard();clearCompose();
      const target=host,token=epoch;busy=true;const unlock=lock();message();
      try{
        const latest=await storage.readNineBoard(workspaceId);
        if(!valid()||token!==epoch||host!==target||!target?.isConnected)return;
        M.validate(latest);
        // Replace only after a successful read: a failed retry keeps the same inputs.
        state=structuredClone(latest);base=structuredClone(latest.boards);stored=tick;
        if(!board())selected=state.boards[0]?.id;
        if(!board()?.areas.some(value=>value.id===areaId))areaId=board()?.areas[0]?.id;
        editing=null;clear();render();host.querySelector('#nbComposeReviewOpen')?.focus({preventScroll:true});
      }catch(cause){if(valid()&&token===epoch&&host===target)composeError(cause,true);}
      finally{busy=false;unlock();message();}
    }
    function currentCompose(request){
      return valid()&&request===composeReview&&request.epoch===epoch&&request.sequence===composeSequence&&request.host===host&&!!host?.isConnected&&
        request.boardId===selected&&request.tick===tick&&!overview&&request.areaId===areaId;
    }
    async function verifyCompose(request){
      const changed=()=>fault('nine_board_compose_stale','9칸 구성이나 선택 영역이 바뀌었습니다. 내용을 다시 검토한 뒤 새 초안을 만들어 주세요.');
      if(!currentCompose(request))throw changed();
      const latest=await storage.readNineBoard(workspaceId);
      if(!currentCompose(request)||latest.revision!==request.revision)throw changed();
      const source=latest.boards.find(value=>value.id===request.boardId);
      if(!source||JSON.stringify(M.composeContent(source,request.areaId))!==JSON.stringify(request.content))throw changed();
    }
    function renderComposeReceipt(){
      host?.querySelector('.nb-compose-result')?.remove();
      const target=host?.querySelector('.nb-compose-action');if(!target||!composeReceipt)return;
      const result=el('section',null,'nb-compose-result');result.setAttribute('role','status');
      result.append(el('p','새 비공개 초안에 보관했습니다. 서버로 전송하거나 공개하지 않았습니다.','life-help'));
      const open=button('보관된 초안 열기',openComposed);open.id='nbComposeOpen';result.append(open);target.after(result);
    }
    async function openComposed(){
      guard();await flush();guard();const result=composeReceipt,token=epoch;
      if(!result||!valid()||!host?.isConnected)return;
      try{await onComposed({...result});}
      catch(cause){if(valid()&&token===epoch)composeError(new Error('초안은 보관했지만 열지 못했습니다. 보관된 초안 열기로 다시 시도해 주세요. '+(cause.message||'')));}
    }
    function renderComposeReview(request){
      if(!currentCompose(request))return;
      host.querySelector('#nbComposeReview')?.remove();
      const review=el('section',null,'nb-compose-review');review.id='nbComposeReview';review.dataset.state='ready';review.tabIndex=-1;review.setAttribute('aria-label','새 글에 담을 내용');
      const img=el('img',null,'nb-compose-preview');img.src=request.url;img.width=1800;img.height=2100;img.alt=request.content.title+' · '+request.content.areaTitle+' · 선택한 아홉 칸';
      review.append(el('h3','새 글에 담을 내용'),el('p',request.content.title+' · '+request.content.areaTitle,'life-meta'),img,
        el('p','고른 영역의 PNG와 아래 전체 제목·만든 사람·종류·출처만 새 비공개 초안에 담습니다. 구성 소개·영역 설명·선택 이유·인용 구절·다른 영역은 포함하지 않습니다. 원래 9칸은 바뀌지 않습니다.','life-help'),
        el('h4','본문에 담을 전체 내용'),el('div',request.content.text,'nb-text nb-compose-text'));
      const create=button('새 비공개 글 초안 만들기',createComposed);create.id='nbComposeCreate';
      const cancel=button('검토 취소',()=>{guard();clearCompose();host.querySelector('#nbComposeReviewOpen')?.focus();});cancel.id='nbComposeCancel';
      review.append(create,cancel);host.querySelector('.nb-compose-action').after(review);review.focus({preventScroll:true});review.scrollIntoView({block:'start'});
    }
    async function prepareCompose(id){
      await flush();guard();clearCompose();clear();
      const source=structuredClone(board()),request={workspaceId,boardId:source.id,areaId:id,revision:state.revision,content:M.composeContent(source,id),host,epoch,sequence:composeSequence,tick,blob:null,url:null};
      composeReview=request;busy=true;const unlock=lock();message();
      try{
        request.blob=await M.png(source,id);
        await verifyCompose(request);
        request.url=URL.createObjectURL(request.blob);urls.add(request.url);renderComposeReview(request);
      }catch(cause){if(currentCompose(request)){clearCompose();composeError(cause);}}
      finally{busy=false;unlock();message();}
    }
    async function createComposed(){
      guard();await flush();guard();const request=composeReview;if(!request)return;
      busy=true;const unlock=lock();message();host.querySelector('#nbComposeReview')?.setAttribute('data-state','saving');let result=null;
      try{
        await verifyCompose(request);
        result=await onComposeArea({workspaceId,boardId:request.boardId,areaId:request.areaId,revision:request.revision,content:structuredClone(request.content),blob:request.blob,isCurrent:()=>currentCompose(request)});
        if(!currentCompose(request))return;
        // A completed save is consumed before opening; opening retries never save twice.
        clearCompose();
        if(!result||typeof result.postId!=='string'||!result.postId||!Number.isSafeInteger(result.revision)||result.revision<1){result=null;throw new Error('초안 처리 결과를 확인하지 못했습니다. 글 관리에서 보관된 초안을 확인해 주세요.');}
        composeReceipt={postId:result.postId,revision:result.revision};renderComposeReceipt();
      }catch(cause){
        result=null;
        if(valid()&&request.epoch===epoch){if(cause.code==='nine_board_compose_stale'||cause.code==='nine_board_conflict')clearCompose();composeError(cause);}
      }finally{busy=false;unlock();host?.querySelector('#nbComposeReview')?.setAttribute('data-state','ready');message();}
      if(result&&valid()&&request.epoch===epoch)await openComposed();
    }
    async function recover(){
      guard();clearTimeout(timer);if(saving)await saving.catch(()=>{});const token=epoch,changes=M.changed(base,state.boards),active=selected,activeArea=board()?.areas.findIndex(a=>a.id===areaId);
      const input=document.activeElement,position=input?.id&&host.contains(input)?{id:input.id,start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection}:null;
      busy=true;const unlock=lock();message();
      try{
        const latest=await storage.readNineBoard(workspaceId);if(!valid()||token!==epoch)return;
        const added=M.copies(changes,fresh),next={...latest,format:M.hasReferences(latest.boards.concat(added))?'life-nine-board-v2':latest.format,boards:latest.boards.concat(added)};M.validate(next);
        const saved=added.length?await storage.saveNineBoard(workspaceId,next,latest.revision):latest;
        if(!valid()||token!==epoch)return;
        const index=changes.findIndex(b=>b.id===active);state=saved;base=structuredClone(saved.boards);stored=tick;selected=added[index]?.id||saved.boards.find(b=>b.id===active)?.id||saved.boards[0]?.id;
        areaId=board()?.areas[activeArea]?.id||board()?.areas[0]?.id;editing=null;clear();render();
        const target=position&&host.querySelector('#'+position.id)||host.querySelector('#nbTitle');
        if(target){const detail=target.closest('details');if(detail)detail.open=true;target.focus({preventScroll:true});if(position?.start!=null&&target.setSelectionRange)target.setSelectionRange(position.start,position.end,position.direction);target.scrollIntoView({block:'nearest'});}
      }catch(cause){report(cause);}finally{busy=false;unlock();message();}
    }
    function chooseArea(id){guard();areaId=id;editing=null;overview=false;render();host.querySelector('.nb-area-heading')?.focus();}
    function renderTiles(target,a,{edit=false}={}){
      const grid=el('ol',null,'nb-grid');grid.setAttribute('aria-label',(a.title||'영역')+' · 최대 9개');
      for(let i=0;i<9;i++){
        const item=a.items[i],cell=el('li',null,'nb-cell');cell.dataset.itemIndex=String(i);cell.tabIndex=-1;
        if(item){
          const card=life.PagePostsView.attachments([item.attachment],{compact:true});cell.append(card);
          if(item.reference){
            const ref=item.reference,linked=ref.value.workspaceId===workspaceId;
            const evidence=details('보관한 근거');evidence.append(el('blockquote',ref.value.quote,'life-quote'));
            evidence.append(el('p',linked?'당시 선택한 정확한 버전':'다른 작업공간의 근거 · 구절만 보존됨','life-meta'));
            if(linked){const open=button('정확한 근거 열기',async()=>{
              guard();await flush();const token=epoch;
              const target=ref.kind==='source'?await life.SourceReference.resolve(await getBundle(),ref.value):await life.SourceReference.resolvePost({workspaceId,post:await storage.readPhotoPost(workspaceId,ref.value.postId)},ref.value);
              if(valid()&&token===epoch)await onOpenReference({kind:ref.kind,target,reference:ref.value,focusKey:open.dataset.focusKey});
            });open.dataset.focusKey='nine:reference:'+selected+':'+a.id+':'+i;open.setAttribute('aria-label','정확한 근거 열기: '+ref.value.title+' · '+ref.value.quote.replace(/\s+/g,' ').slice(0,60));evidence.append(open);}cell.append(evidence);
          }
          if(item.reason){const reason=details('선택 이유');reason.classList.add('nb-reason');reason.append(el('p',item.reason,'nb-text'));cell.append(reason);}
          if(edit){const editButton=button('수정',()=>{guard();editing=i;renderEditor();host.querySelector('#nbItemTitle')?.focus();});editButton.setAttribute('aria-label',item.attachment.title+' · 수정');cell.append(editButton);}
        }else if(edit){const add=button('담기',()=>pick(a),'life-button nb-empty');add.setAttribute('aria-label',(i+1)+'번째 칸에 담기');cell.append(add);}else{cell.classList.add('nb-empty-read');cell.append(el('span','빈 칸','life-meta'));}
        grid.append(cell);
      }
      target.append(grid);
    }
    async function pick(a){
      guard();if(a.items.length>=9)throw new Error('영역마다 항목을 9개까지 담을 수 있습니다.');
      const token=epoch,values=await storage.readCollection(workspaceId);if(!valid()||token!==epoch||!host?.isConnected)return;
      picker=life.CollectionPicker.open({items:values.items,purpose:'board',isCurrent:()=>valid()&&token===epoch&&!!host?.isConnected,
        onSelect:value=>{picker=null;if(!valid()||token!==epoch)return;manual={areaId:a.id,seed:value.item||value.seed||{},review:value.review||''};renderEditor();host.querySelector('#nbItemTitle')?.focus();message();}});
    }
    let editorHost=null;
    function validateItems(a,items){const values=state.boards.map(b=>b.id===selected?{...b,areas:b.areas.map(value=>value===a?{...value,items}:value)}:b),format=M.hasReferences(values)?'life-nine-board-v2':state.format;M.validate({...state,format,boards:values});return format;}
    async function pickEvidence(a){
      guard();if(a.items.length>=9)throw new Error('영역마다 항목을 9개까지 담을 수 있습니다.');await flush();
      const token=epoch,panel=el('section',null,'nb-evidence-picker');editorHost.replaceChildren(panel);evidencePending=true;message();
      const cancel=()=>{evidencePicker?.dispose();evidencePicker=null;evidencePending=false;panel.remove();message();};
      const accept=value=>{if(!valid()||token!==epoch||!panel.isConnected)return;M.reference(value);const seed=M.evidenceSnapshot(value);cancel();manual={areaId:a.id,seed:seed.attachment,reference:value};renderEditor();};
      const sourceHost=el('div');panel.append(el('h3','원문·저장 글 고르기'));
      panel.append(button('원문 구절 고르기',async()=>{
        sourceHost.replaceChildren();evidencePicker?.dispose();
        evidencePicker=life.BlogEvidence.create({host:sourceHost,getBundle,isCurrent:()=>valid()&&token===epoch,
          heading:'원문 구절 고르기',applyLabel:'이 구절 선택',includeThought:false,onApply:({reference})=>accept({kind:'source',value:reference}),onCancel:cancel});
        await evidencePicker.open();
      }),button('저장한 글 고르기',async()=>{
        evidencePicker?.dispose();evidencePicker=null;const rows=await storage.listPhotoPosts(workspaceId);if(!valid()||token!==epoch||!panel.isConnected)return;
        sourceHost.replaceChildren();const saved=rows.filter(row=>row.status==='saved'&&!row.archived);let count=0;
        const append=()=>{for(const row of saved.slice(count,count+40))sourceHost.append(button(row.title||'제목 없는 저장 글',async()=>{
          const post=await storage.readPhotoPost(workspaceId,row.id),ref=await life.SourceReference.buildPost({workspaceId,post});accept({kind:'post',value:ref});
        }));count+=40;more.hidden=count>=saved.length;};
        const more=button('저장 글 더 보기',append);if(!saved.length)sourceHost.append(el('p','저장한 글이 없습니다.','life-help'));append();sourceHost.append(more);
      }),button('선택 취소',cancel),sourceHost);
    }
    function renderEditor(){
      clearCompose();
      if(!editorHost)return;editorHost.replaceChildren();const a=area();if(!a)return;
      if(!manual&&editing==null)return;
      const current=manual?null:a.items[editing],seed=manual?.seed||current?.attachment;if(!seed)return;
      const form=el('form',null,'nb-item-editor'),values={type:seed.type||'other',title:seed.title||'',creator:seed.creator||'',url:seed.url||'',reason:current?.reason||''};
      if(!manual)manual={areaId:a.id,seed:structuredClone(seed),editing};
      // The unapplied form is guarded and stays intact on invalid data or storage failure.
      form.append(el('h3',current?'항목 수정':'새 항목'));
      const kind=el('label',null,'life-field'),select=el('select');kind.append(el('span','종류'),select);
      for(const [key,title] of Object.entries(life.Collection.TYPES)){const option=el('option',title);option.value=key;select.append(option);}select.value=values.type;select.addEventListener('change',()=>values.type=select.value);form.append(kind);
      for(const [key,label,max] of [['title','제목 또는 이름',500],['creator','창작자',500],['url','출처 주소',2048],['reason','선택 이유',20000]]){
        const f=field(label,values[key],v=>values[key]=v,{multiline:key==='reason',max,id:key==='title'?'nbItemTitle':undefined});form.append(f.wrapper);
      }
      if(manual.review)form.append(el('p',manual.review,'life-help'));
      const retainedReference=current?.reference||manual.reference;
      if(retainedReference)form.append(el('blockquote',retainedReference.value.quote,'life-quote'),el('p','선택 이유는 직접 입력합니다. 원문과 저장 글은 수정하지 않습니다.','life-help'));
      const actions=el('div',null,'life-actions'),apply=el('button',current?'반영':'담기','life-button');apply.type='submit';
      actions.append(apply,button('입력 취소',()=>{if(composing.size)throw new Error('입력을 마친 뒤 취소해 주세요.');manual=null;editing=null;clear();if(tick!==stored)mark();render();host.querySelector('.nb-area-heading')?.focus();}));form.append(actions);
      form.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.isComposing||composing.size||e.keyCode===229))e.preventDefault();});
      form.addEventListener('submit',e=>{e.preventDefault();if(composing.size||!valid())return;try{
        const item={attachment:life.PagePosts.attachment(values),reason:values.reason,...(retainedReference?{reference:structuredClone(retainedReference)}:{})};const format=validateItems(a,current?a.items.map((old,i)=>i===editing?item:old):a.items.concat(item));state.format=format;
        if(current)a.items[editing]=item;else a.items.push(item);manual=null;editing=null;clear();mark();render();host.querySelector('.nb-area-heading')?.focus();
      }catch(cause){report(cause);}});
      if(current){
        actions.append(button('앞으로 이동',()=>{if(composing.size)throw new Error('입력을 마친 뒤 이동해 주세요.');if(editing<=0)return;const item={attachment:life.PagePosts.attachment(values),reason:values.reason,...(retainedReference?{reference:structuredClone(retainedReference)}:{})};const next=structuredClone(a.items);next[editing]=item;validateItems(a,next);a.items[editing]=item;const from=editing;[a.items[from-1],a.items[from]]=[a.items[from],a.items[from-1]];manual=null;editing=null;clear();mark();render();}),button('영역에서 빼기',()=>{if(composing.size)throw new Error('입력을 마친 뒤 빼 주세요.');a.items.splice(editing,1);manual=null;editing=null;clear();mark();render();}));
        actions.children[2].disabled=editing===0;
      }
      editorHost.append(form);form.scrollIntoView({block:'nearest'});message();
    }
    function renderImport(target){
      if(!candidate)return;
      const incoming=candidate,review=el('section',null,'nb-import'),flags=M.reviewBoards(state.boards,incoming.boards);review.tabIndex=-1;review.setAttribute('aria-label','9칸 구성 파일 확인');
      review.append(el('h3','파일 사본 확인'),el('p',incoming.boards.length+'개 구성 · 필요한 것만 선택하세요. 기존 구성은 유지하고 새 사본으로 추가합니다.','life-help'));
      const count=el('p','','life-help nb-import-count');count.setAttribute('role','status');review.append(count);
      const controls=el('div',null,'life-actions'),checks=[];
      function update(){
        if(candidate!==incoming||!valid()||!review.isConnected)return;
        checks.forEach(([b,input])=>input.checked=incoming.chosen.has(b.id));
        const available=M.LIMITS.boards-state.boards.length,size=incoming.chosen.size;
        count.textContent=`선택 ${size}개 · 추가할 수 있는 구성 ${available}개`+(size>available?' · 선택을 줄여 주세요.':'');
        apply.disabled=!size||size>available||busy||apply.dataset.pending==='true';
      }
      const all=button('모두 선택',()=>{guard();incoming.boards.forEach(b=>incoming.chosen.add(b.id));update();});
      const none=button('선택 해제',()=>{guard();incoming.chosen.clear();update();});all.disabled=none.disabled=!incoming.boards.length;controls.append(all,none);review.append(controls);
      incoming.boards.forEach((b,index)=>{
        const row=el('section',null,'nb-import-row'),label=el('label',null,'nb-import-select'),input=el('input'),copy=el('span');
        input.type='checkbox';input.setAttribute('aria-label',(b.title||'제목 없는 구성')+' · 복구 선택');checks.push([b,input]);
        const total=b.areas.reduce((sum,a)=>sum+a.items.length,0),duplicate=[flags[index].existing?'같은 내용이 이미 보관되어 있습니다.':'',flags[index].file?'파일 안에 같은 내용이 있습니다.':''].filter(Boolean).join(' ');
        copy.append(el('strong',b.title||'제목 없는 구성'),el('span',`${b.areas.length}개 영역 · ${total}개 항목`,'life-meta'));
        if(duplicate)copy.append(el('span',duplicate+' 별도 사본이 필요하면 선택하세요.','life-meta nb-import-duplicate'));
        input.addEventListener('change',()=>{if(input.checked)incoming.chosen.add(b.id);else incoming.chosen.delete(b.id);update();});label.append(input,copy);row.append(label);
        const d=details('내용 확인');d.append(el('p',b.intro,'nb-text'));for(const a of b.areas){d.append(el('h4',a.title||'이름 없는 영역'),el('p',a.note,'nb-text'));renderTiles(d,a);}row.append(d);review.append(row);
      });
      if(!incoming.boards.length)review.append(el('p','파일에 담긴 구성이 없습니다. 다른 JSON 파일을 골라 주세요.','life-help'));
      const apply=button('선택한 구성 새 사본으로 추가',async()=>{
        guard();await flush();if(candidate!==incoming)return;
        const chosen=incoming.boards.filter(b=>incoming.chosen.has(b.id));if(!chosen.length)throw new Error('복구할 구성을 선택해 주세요.');
        const token=epoch,added=M.copies(chosen,fresh),next={...state,format:M.hasReferences(state.boards.concat(added))?'life-nine-board-v2':state.format,boards:state.boards.concat(added)};M.validate(next);busy=true;const unlock=lock();message();
        try{const saved=await storage.saveNineBoard(workspaceId,next,next.revision);if(!valid()||token!==epoch)return;state=saved;base=structuredClone(saved.boards);stored=tick;selected=added[0]?.id||selected;areaId=board()?.areas[0]?.id;candidate=null;clear();render();}
        finally{busy=false;unlock();message();}
      });
      review.append(apply,button('파일 취소',()=>{guard();candidate=null;render();const file=host.querySelector('input[type=file]');file.closest('details').open=true;file.focus();}));target.append(review);importUpdate=update;update();
    }
    function render(){
      if(!host?.isConnected||!valid()||!state)return;
      clearCompose();
      importUpdate=null;host.replaceChildren();host.className='nb-workspace';
      const toolbar=el('div',null,'life-actions nb-toolbar'),selector=el('select');selector.id='nbSelect';selector.setAttribute('aria-label','9칸 구성 선택');
      for(const b of state.boards){const o=el('option',b.title||'제목 없는 구성');o.value=b.id;selector.append(o);}selector.value=selected||'';selector.hidden=!state.boards.length;
      selector.addEventListener('change',async()=>{const next=selector.value;try{await flush();selected=next;areaId=board()?.areas[0]?.id;editing=null;overview=false;render();}catch(cause){selector.value=selected;report(cause);}});
      toolbar.append(selector,button('새 9칸 구성',async()=>{await flush();if(state.boards.length>=20)throw new Error('9칸 구성은 20개까지 보관할 수 있습니다.');const b=M.create(fresh);state.boards.push(b);selected=b.id;areaId=b.areas[0].id;preview=false;overview=false;mark();render();host.querySelector('#nbTitle').focus();}));
      status=el('p','','life-meta nb-status');status.setAttribute('role','status');error=el('p','','life-error nb-error');error.setAttribute('role','alert');error.hidden=true;
      host.append(toolbar,status,error);
      const recovery=el('div',null,'life-actions nb-recovery');
      recovery.append(button('다시 저장',async()=>{await flush();clear();}),button('내 변경을 새 사본으로 보관',recover),button('전체 구성 JSON 백업 받기',()=>backup()));
      recovery.children[1].hidden=failure?.code!=='nine_board_conflict';recovery.hidden=!failure;host.append(recovery);
      if(incoming){
        const review=el('section',null,'nb-incoming');review.setAttribute('aria-label','담을 원문 근거');
        review.append(el('h3',incoming.value.title||'선택한 근거'),el('blockquote',incoming.value.quote,'life-quote'));
        const apply=button('선택한 영역에 담기',()=>{guard();const a=area();if(!a)throw new Error('구성과 영역을 먼저 골라 주세요.');if(a.items.length>=9)throw new Error('영역마다 항목을 9개까지 담을 수 있습니다.');const snapshot=M.evidenceSnapshot(incoming);manual={areaId:a.id,seed:snapshot.attachment,reference:incoming};incoming=null;preview=false;overview=false;render();});
        apply.disabled=!area()||area().items.length>=9;review.append(el('p',area()?'대상 영역: '+(area().title||'이름 없는 영역'):'새 구성과 영역을 만들거나 기존 구성을 고르세요.','life-help'),apply,button('담기 취소',()=>{incoming=null;render();}));host.append(review);
      }
      const b=board();if(!b){host.append(el('p','한 영역부터 시작하세요. 영역은 최대 9개, 영역마다 항목은 최대 9개입니다.','life-help'));}
      else{
        const mode=el('div',null,'life-actions');mode.append(button(preview?'편집하기':'9칸 미리보기',async()=>{await flush();preview=!preview;overview=b.areas.length>1;render();host.querySelector('.nb-display')?.focus();}));host.append(mode);
        if(preview){host.append(el('h2',b.title||'9칸 구성','nb-title'));if(b.intro)host.append(el('p',b.intro,'nb-text'));}
        else{
          const title=field('구성 제목',b.title,v=>{b.title=v;const o=selector.selectedOptions[0];if(o)o.textContent=v||'제목 없는 구성';mark();},{id:'nbTitle'});host.append(title.wrapper);
          const settings=details('구성 소개');settings.append(field('소개',b.intro,v=>{b.intro=v;mark();},{multiline:true,max:20000,id:'nbIntro'}).wrapper);host.append(settings);
        }
        const nav=el('div',null,'life-actions nb-area-nav');nav.setAttribute('aria-label','영역 선택');
        if(preview&&b.areas.length>1&&!overview){const all=button('영역 전체',()=>{guard();overview=true;render();});nav.append(all);}
        if(!preview)for(const [index,a] of b.areas.entries()){const item=button(a.title||'영역 '+(index+1),()=>chooseArea(a.id));item.setAttribute('aria-pressed',String(!overview&&a.id===areaId));item.dataset.areaId=a.id;nav.append(item);}
        if(!preview){const add=button('영역 추가',()=>{guard();if(b.areas.length>=9)throw new Error('영역은 9개까지 만들 수 있습니다.');const a={id:fresh(),title:'',note:'',items:[]};b.areas.push(a);areaId=a.id;editing=null;mark();render();host.querySelector('#nbAreaTitle')?.focus();});add.disabled=b.areas.length>=9;nav.append(add);}host.append(nav);
        const display=el('section',null,'nb-display');display.tabIndex=-1;host.append(display);
        if(preview&&overview){
          const grid=el('div',null,'nb-areas');
          for(const [index,a] of b.areas.entries()){const cell=el('section',null,'nb-area-summary'),open=button(a.title||'영역 '+(index+1),()=>chooseArea(a.id),'life-button nb-area-open');cell.append(open,el('p',a.items.length+' / 9개','life-meta'));const list=el('ul');a.items.forEach(i=>list.append(el('li',i.attachment.title)));cell.append(list);grid.append(cell);}display.append(grid);
        }else{
          const a=area()||b.areas[0];if(a){areaId=a.id;
            const heading=el('h3',a.title||'영역 '+(b.areas.indexOf(a)+1),'nb-area-heading');heading.tabIndex=-1;display.append(heading,el('p',a.items.length+' / 9개','life-meta'));
            if(preview){if(a.note)display.append(el('p',a.note,'nb-text'));}
            else{
              display.append(field('영역 이름',a.title,v=>{a.title=v;heading.textContent=v||'이름 없는 영역';const n=nav.querySelector('[data-area-id="'+a.id+'"]');if(n)n.textContent=v||'이름 없는 영역';mark();},{id:'nbAreaTitle'}).wrapper);
              const settings=details('영역 설명·관리');settings.append(field('영역 설명',a.note,v=>{a.note=v;mark();},{multiline:true,max:20000,id:'nbAreaNote'}).wrapper);
              const remove=button('빈 영역 삭제',()=>{guard();if(a.items.length||a.note||a.title)throw new Error('영역 이름·설명·항목을 비운 뒤 삭제할 수 있습니다.');b.areas=b.areas.filter(x=>x!==a);areaId=b.areas[0]?.id;mark();render();});remove.disabled=b.areas.length<=1||!!a.items.length||!!a.note||!!a.title;settings.append(remove);display.append(settings);
            }
            renderTiles(display,a,{edit:!preview});editorHost=el('div');display.append(editorHost);if(!preview){const evidence=button('원문·저장 글 담기',()=>pickEvidence(a));evidence.disabled=a.items.length>=9;display.append(evidence);renderEditor();}
          }
        }
        if(typeof onComposeArea==='function'&&b.areas.length){
          const composeAction=el('div',null,'nb-compose-action'),compose=button('선택 영역으로 글쓰기 검토',()=>prepareCompose(areaId));compose.id='nbComposeReviewOpen';compose.disabled=overview;
          if(overview)composeAction.append(el('p','새 글에 담을 영역을 먼저 선택해 주세요.','life-help'));
          composeAction.append(compose);display.after(composeAction);renderComposeReceipt();
        }
      }
      const files=details('파일 보관·가져오기');files.classList.add('nb-files');files.append(el('p','이 브라우저에만 보관되며 공개 사본·구성 동기화·자료 백업에 포함되지 않습니다. 현재 구성 JSON에는 지금 고른 구성 하나만, 전체 백업에는 모든 구성이 담깁니다. HTML은 현재 구성의 제목·선택 이유·출처가 담긴 보기 파일이며, 공개 링크가 아닙니다.','life-help'));
      if(M.hasReferences(state.boards))files.append(el('p','직접 담은 근거 구절도 JSON과 HTML에 포함됩니다. JSON은 원문 버전의 식별자를 보존하며, 다른 작업공간으로 옮기면 자동 연결하지 않습니다. 선택하지 않은 원문 본문이나 사진 파일은 복사하지 않습니다.','life-help'));
      const file=el('input');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','9칸 구성 JSON 파일');let sequence=0;
      file.addEventListener('change',async()=>{const input=file.files[0],request=++sequence,token=epoch;file.value='';if(!input)return;try{guard();candidate=null;host.querySelector('.nb-import')?.remove();await flush();if(input.size>M.LIMITS.bytes)throw new Error('파일은 2 MiB까지 불러올 수 있습니다.');const value=M.readBackup(JSON.parse(await input.text()));if(!valid()||token!==epoch||request!==sequence||!file.isConnected)return;guard();candidate={boards:value,chosen:new Set()};clear();render();const review=host.querySelector('.nb-import');review.focus({preventScroll:true});review.scrollIntoView({block:'start'});}catch(cause){if(valid()&&token===epoch&&request===sequence&&file.isConnected)report(cause);}});
      if(b)files.append(button('현재 구성 JSON 받기',()=>backup(true)));
      files.append(button('전체 구성 JSON 백업 받기',()=>backup()));
      if(b)files.append(button('HTML 보기 파일 받기',async()=>{await flush();download(M.html(board()),'haedo-nine-board.html','text/html;charset=utf-8');}));files.append(file);host.append(files);renderImport(host);
      if(b?.areas.length){
        const imageExport=el('div',null,'nb-image-export'),label=el('label','이미지로 받을 영역'),areas=el('select');areas.id='nbImageArea';label.htmlFor=areas.id;
        for(const [index,a] of b.areas.entries()){const option=el('option',a.title||'영역 '+(index+1));option.value=a.id;areas.append(option);}areas.value=area()?.id||b.areas[0].id;
        const help=el('p','PNG는 고른 영역의 3×3 제목·만든 사람·종류·출처만 담습니다. 사진·선택 이유·인용 근거는 자동 포함하지 않습니다. 긴 글은 …로 줄이며 이미지로 사본을 복원할 수 없습니다. 전체 내용은 JSON/HTML을 함께 보관하세요.','life-help');
        imageExport.append(label,areas,button('선택 영역 PNG 받기',()=>image(areas.value)),help);
        files.append(imageExport);
      }
      if(failure)report(failure);else message();
    }
    async function mount(target,searchTarget=null,incomingReference=null){
      host=target;const token=++epoch;host.className='nb-workspace';host.replaceChildren(el('p','9칸 구성 불러오는 중…','life-help'));
      try{if(!state||!dirty()){const next=await storage.readNineBoard(workspaceId);if(!valid()||token!==epoch||host!==target)return;state=next;base=structuredClone(next.boards);stored=tick;clear();}
        if(incomingReference){M.reference(incomingReference);incoming=structuredClone(incomingReference);preview=false;overview=false;}
        if(searchTarget){const found=life.UnifiedSearch.resolveNineTarget(state,searchTarget);selected=found.board.id;areaId=found.area?.id||found.board.areas[0]?.id;preview=true;overview=!found.area;editing=null;}
        if(!board()){selected=state.boards[0]?.id;areaId=board()?.areas[0]?.id;}render();
        if(searchTarget){const focus=searchTarget.itemIndex!=null?host.querySelector('.nb-grid [data-item-index="'+searchTarget.itemIndex+'"]'):host.querySelector(searchTarget.areaId?'.nb-area-heading':'.nb-display');
          if(searchTarget.itemIndex!=null&&focus?.querySelector('.nb-reason'))focus.querySelector('.nb-reason').open=true;
          focus?.focus({preventScroll:true});focus?.scrollIntoView({block:'nearest'});}
      }catch(cause){if(!valid()||token!==epoch)return;const alert=el('p',cause.message||'불러오지 못했습니다.','life-error');alert.setAttribute('role','alert');host.replaceChildren(alert,button('다시 불러오기',()=>mount(target,searchTarget)));}
    }
    // Completed receipts belong to this storage/workspace instance, not a mounted view.
    // Keep one across editor/open failures; pending previews are always discarded.
    function detach(){epoch++;clearCompose();clearTimeout(timer);picker?.();picker=null;evidencePicker?.dispose();evidencePicker=null;evidencePending=false;incoming=null;importUpdate=null;host=null;status=null;error=null;editorHost=null;for(const u of urls)URL.revokeObjectURL(u);urls.clear();}
    return {mount,flush,dirty,detach,hasBlockedInput:()=>evidencePending||!!manual||pendingFields.size>0||composing.size>0||busy};
  }
  life.NineBoardUI={create};
})(globalThis);

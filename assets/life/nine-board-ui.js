/* Private local board editor; shares the collection picker and safe snapshot renderer. */
(function(root){
  'use strict';
  const life=root.HaedoLife ||= {},M=life.NineBoard;
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  function create({storage,workspaceId,isCurrent,onDirty=()=>{}}){
    let state=null,base=[],host=null,status=null,error=null,selected=null,areaId=null,editing=null,preview=false,overview=false;
    let tick=0,stored=0,timer=null,saving=null,failure=null,epoch=0,manual=null,picker=null,candidate=null,busy=false;
    const composing=new Set(),pendingFields=new Set(),urls=new Set(),fresh=()=>life.Core.id(),valid=()=>isCurrent(),board=()=>state?.boards.find(b=>b.id===selected),area=()=>board()?.areas.find(a=>a.id===areaId);
    const fault=(code,message)=>Object.assign(new Error(message),{code});
    function dirty(){return !!manual||pendingFields.size>0||composing.size>0||!!saving||busy||tick!==stored;}
    function message(){
      if(!host?.isConnected||!status||!valid())return;
      status.textContent=failure?'저장하지 못함 · 입력 유지':pendingFields.size?'문자·용량 확인 필요 · 입력 유지':manual?'대상 입력 중 · 아직 담지 않음':saving?'이 브라우저에 저장 중…':tick!==stored?'저장 전 변경 있음':'이 브라우저에 저장됨';
      status.dataset.state=failure?'error':dirty()?'dirty':'saved';onDirty();
    }
    function report(cause){failure=cause;if(error?.isConnected&&valid()){error.textContent=cause.message||'저장하지 못했습니다. 입력은 유지됩니다. 파일을 보관하거나 다시 시도해 주세요.';error.hidden=false;const recovery=host.querySelector('.nb-recovery');if(recovery){recovery.hidden=false;recovery.children[1].hidden=cause.code!=='nine_board_conflict';}}message();}
    function clear(){failure=null;if(error){error.textContent='';error.hidden=true;}const recovery=host?.querySelector('.nb-recovery');if(recovery)recovery.hidden=true;message();}
    function guard(){if(!valid())throw new Error('작업공간이 바뀌었습니다.');if(composing.size)throw fault('nine_input_in_progress','입력을 마친 뒤 다시 시도해 주세요.');if(pendingFields.size)throw fault('nine_input_pending','입력은 남아 있습니다. 문자와 전체 용량을 확인해 내용을 줄인 뒤 다시 시도해 주세요.');if(manual)throw fault('nine_input_pending','대상을 담거나 입력 취소를 누른 뒤 다시 시도해 주세요.');if(busy)throw fault('nine_busy','저장을 마친 뒤 다시 시도해 주세요.');}
    function mark(){tick++;clearTimeout(timer);message();if(failure?.code!=='nine_board_conflict')timer=setTimeout(()=>{if(!composing.size&&!manual&&!pendingFields.size&&!busy)flush().catch(report);},450);}
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
        if(!valid()||!b.isConnected||busy)return;b.disabled=true;
        try{await task();}catch(cause){report(cause);}finally{if(b.isConnected)b.disabled=false;}
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
      input.addEventListener('compositionstart',()=>composing.add(input));
      input.addEventListener('compositionend',()=>{composing.delete(input);apply();message();});
      input.addEventListener('input',apply);return {wrapper,input};
    }
    function details(title){const n=el('details',null,'wb-details nb-details');n.append(el('summary',title));return n;}
    function lock(){const controls=[...host.querySelectorAll('button,input,textarea,select')].map(n=>[n,n.disabled]);controls.forEach(([n])=>n.disabled=true);return ()=>controls.forEach(([n,disabled])=>{if(n.isConnected)n.disabled=disabled;});}
    function download(value,name,type){
      const url=URL.createObjectURL(new Blob([value],{type}));urls.add(url);const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
      setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},1000);
    }
    function backup(){if(!state)return;if(pendingFields.size)throw new Error('문자와 용량을 확인한 뒤 파일을 받아 주세요.');if(manual)throw new Error('대상을 담거나 입력 취소를 누른 뒤 파일을 받아 주세요.');download(JSON.stringify(M.backup(state.boards),null,2),'haedo-nine-board.json','application/json');}
    async function recover(){
      guard();clearTimeout(timer);if(saving)await saving.catch(()=>{});const token=epoch,changes=M.changed(base,state.boards),active=selected,activeArea=board()?.areas.findIndex(a=>a.id===areaId);
      const input=document.activeElement,position=input?.id&&host.contains(input)?{id:input.id,start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection}:null;
      busy=true;const unlock=lock();message();
      try{
        const latest=await storage.readNineBoard(workspaceId);if(!valid()||token!==epoch)return;
        const added=M.copies(changes,fresh),next={...latest,boards:latest.boards.concat(added)};M.validate(next);
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
        const item=a.items[i],cell=el('li',null,'nb-cell');
        if(item){
          const card=life.PagePostsView.attachments([item.attachment],{compact:true});cell.append(card);
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
    function validateItems(a,items){M.validate({...state,boards:state.boards.map(b=>b.id===selected?{...b,areas:b.areas.map(value=>value===a?{...value,items}:value)}:b)});}
    function renderEditor(){
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
      const actions=el('div',null,'life-actions'),apply=el('button',current?'반영':'담기','life-button');apply.type='submit';
      actions.append(apply,button('입력 취소',()=>{if(composing.size)throw new Error('입력을 마친 뒤 취소해 주세요.');manual=null;editing=null;clear();if(tick!==stored)mark();render();host.querySelector('.nb-area-heading')?.focus();}));form.append(actions);
      form.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.isComposing||composing.size||e.keyCode===229))e.preventDefault();});
      form.addEventListener('submit',e=>{e.preventDefault();if(composing.size||!valid())return;try{
        const item={attachment:life.PagePosts.attachment(values),reason:values.reason};validateItems(a,current?a.items.map((old,i)=>i===editing?item:old):a.items.concat(item));
        if(current)a.items[editing]=item;else a.items.push(item);manual=null;editing=null;clear();mark();render();host.querySelector('.nb-area-heading')?.focus();
      }catch(cause){report(cause);}});
      if(current){
        actions.append(button('앞으로 이동',()=>{if(composing.size)throw new Error('입력을 마친 뒤 이동해 주세요.');if(editing<=0)return;const item={attachment:life.PagePosts.attachment(values),reason:values.reason};const next=structuredClone(a.items);next[editing]=item;validateItems(a,next);a.items[editing]=item;const from=editing;[a.items[from-1],a.items[from]]=[a.items[from],a.items[from-1]];manual=null;editing=null;clear();mark();render();}),button('영역에서 빼기',()=>{if(composing.size)throw new Error('입력을 마친 뒤 빼 주세요.');a.items.splice(editing,1);manual=null;editing=null;clear();mark();render();}));
        actions.children[2].disabled=editing===0;
      }
      editorHost.append(form);form.scrollIntoView({block:'nearest'});message();
    }
    function renderImport(target){
      if(!candidate)return;const review=el('section',null,'nb-import');review.append(el('h3','파일 사본 확인'),el('p',candidate.length+'개 구성 · 기존 구성을 유지하고 새 사본으로 추가합니다.','life-help'));
      for(const b of candidate){const d=details(b.title||'제목 없는 구성');d.append(el('p',b.intro,'nb-text'));for(const a of b.areas){d.append(el('h4',a.title||'이름 없는 영역'),el('p',a.note,'nb-text'));renderTiles(d,a);}review.append(d);}
      review.append(button('새 사본으로 추가',async()=>{
        guard();await flush();const token=epoch,added=M.copies(candidate,fresh),next={...state,boards:state.boards.concat(added)};M.validate(next);busy=true;const unlock=lock();message();
        try{const saved=await storage.saveNineBoard(workspaceId,next,next.revision);if(!valid()||token!==epoch)return;state=saved;base=structuredClone(saved.boards);stored=tick;selected=added[0]?.id||selected;areaId=board()?.areas[0]?.id;candidate=null;clear();render();}
        finally{busy=false;unlock();message();}
      }),button('파일 취소',()=>{guard();candidate=null;render();}));target.append(review);
    }
    function render(){
      if(!host?.isConnected||!valid()||!state)return;
      host.replaceChildren();host.className='nb-workspace';
      const toolbar=el('div',null,'life-actions nb-toolbar'),selector=el('select');selector.id='nbSelect';selector.setAttribute('aria-label','9칸 구성 선택');
      for(const b of state.boards){const o=el('option',b.title||'제목 없는 구성');o.value=b.id;selector.append(o);}selector.value=selected||'';selector.hidden=!state.boards.length;
      selector.addEventListener('change',async()=>{const next=selector.value;try{await flush();selected=next;areaId=board()?.areas[0]?.id;editing=null;overview=false;render();}catch(cause){selector.value=selected;report(cause);}});
      toolbar.append(selector,button('새 9칸 구성',async()=>{await flush();if(state.boards.length>=20)throw new Error('9칸 구성은 20개까지 보관할 수 있습니다.');const b=M.create(fresh);state.boards.push(b);selected=b.id;areaId=b.areas[0].id;preview=false;overview=false;mark();render();host.querySelector('#nbTitle').focus();}));
      status=el('p','','life-meta nb-status');status.setAttribute('role','status');error=el('p','','life-error nb-error');error.setAttribute('role','alert');error.hidden=true;
      host.append(toolbar,status,error);
      const recovery=el('div',null,'life-actions nb-recovery');
      recovery.append(button('다시 저장',async()=>{await flush();clear();}),button('내 변경을 새 사본으로 보관',recover),button('JSON 백업 받기',()=>{if(composing.size)throw new Error('입력을 마친 뒤 파일을 받아 주세요.');backup();}));
      recovery.children[1].hidden=failure?.code!=='nine_board_conflict';recovery.hidden=!failure;host.append(recovery);
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
            renderTiles(display,a,{edit:!preview});editorHost=el('div');display.append(editorHost);if(!preview)renderEditor();
          }
        }
      }
      const files=details('파일 보관·가져오기');files.append(el('p','이 브라우저에만 보관되며 공개 사본·구성 동기화·자료 백업에 포함되지 않습니다. JSON은 다시 편집할 수 있는 사본입니다. HTML은 제목·선택 이유·출처가 담긴 보기 파일이며, 공개 링크가 아닙니다.','life-help'));
      const file=el('input');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','9칸 구성 JSON 파일');let sequence=0;
      file.addEventListener('change',async()=>{const input=file.files[0],request=++sequence,token=epoch;file.value='';if(!input)return;try{guard();candidate=null;host.querySelector('.nb-import')?.remove();await flush();if(input.size>M.LIMITS.bytes)throw new Error('파일은 2 MiB까지 불러올 수 있습니다.');const value=M.readBackup(JSON.parse(await input.text()));if(!valid()||token!==epoch||request!==sequence||!file.isConnected)return;guard();candidate=value;clear();render();host.querySelector('.nb-import')?.scrollIntoView({block:'start'});}catch(cause){if(valid()&&token===epoch&&request===sequence&&file.isConnected)report(cause);}});
      files.append(button('JSON 백업 받기',()=>{if(composing.size)throw new Error('입력을 마친 뒤 파일을 받아 주세요.');backup();}));
      if(b)files.append(button('HTML 보기 파일 받기',async()=>{await flush();download(M.html(board()),'haedo-nine-board.html','text/html;charset=utf-8');}));files.append(file);host.append(files);renderImport(host);
      if(failure)report(failure);else message();
    }
    async function mount(target){
      host=target;const token=++epoch;host.className='nb-workspace';host.replaceChildren(el('p','9칸 구성 불러오는 중…','life-help'));
      try{if(!state||!dirty()){const next=await storage.readNineBoard(workspaceId);if(!valid()||token!==epoch||host!==target)return;state=next;base=structuredClone(next.boards);stored=tick;clear();}
        if(!board()){selected=state.boards[0]?.id;areaId=board()?.areas[0]?.id;}render();
      }catch(cause){if(!valid()||token!==epoch)return;host.replaceChildren(el('p',cause.message||'불러오지 못했습니다.','life-error'),button('다시 불러오기',()=>mount(target)));}
    }
    function detach(){epoch++;clearTimeout(timer);picker?.();picker=null;host=null;status=null;error=null;editorHost=null;for(const u of urls)URL.revokeObjectURL(u);urls.clear();}
    return {mount,flush,dirty,detach,hasBlockedInput:()=>!!manual||pendingFields.size>0||composing.size>0||busy};
  }
  life.NineBoardUI={create};
})(globalThis);

/* Local representative selections. Snapshots never include collection notes or tags. */
(function(root,factory){
  'use strict'; const api=factory(root); (root.HaedoLife ||= {}).NineBoard=api;
  if(typeof module==='object'&&module.exports) module.exports=api;
})(globalThis,function(root){
  'use strict';
  const LIMITS=Object.freeze({boards:20,areas:9,items:9,bytes:2097152});
  const P=()=>root.HaedoLife?.PagePosts || require('./page-posts.js');
  const R=()=>root.HaedoLife?.SourceReference || require('./source-reference.js');
  const clone=v=>structuredClone(v);
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  function fail(message){throw Object.assign(new Error(message),{code:'invalid_nine_board'});}
  function fields(v,keys){if(!v||typeof v!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(v))||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail('9칸 구성의 형식을 확인해 주세요.');}
  function text(v,max){if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))fail('글자와 길이를 확인해 주세요.');for(let i=0;i<v.length;i++){const c=v.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const n=v.charCodeAt(++i);if(!(n>=0xdc00&&n<=0xdfff))fail('글자를 확인해 주세요.');}else if(c>=0xdc00&&c<=0xdfff)fail('글자를 확인해 주세요.');}}
  function id(v,ids){if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(v)||ids.has(v))fail('구성의 식별자를 확인해 주세요.');ids.add(v);}
  const hasReferences=values=>Array.isArray(values)&&values.some(b=>Array.isArray(b?.areas)&&b.areas.some(a=>Array.isArray(a?.items)&&a.items.some(i=>Object.hasOwn(i||{},'reference'))));
  function reference(value){fields(value,['kind','value']);if(value.kind==='source')R().validate(value.value);else if(value.kind==='post')R().validatePost(value.value);else fail('원문 또는 저장 글의 근거를 확인해 주세요.');return true;}
  function boards(values,allowReferences=false){
    if(!Array.isArray(values)||values.length>LIMITS.boards)fail('9칸 구성은 20개까지 보관할 수 있습니다.');
    const ids=new Set();
    for(const b of values){
      fields(b,['id','title','intro','areas']);id(b.id,ids);text(b.title,500);text(b.intro,20000);
      if(!Array.isArray(b.areas)||b.areas.length>9)fail('영역은 9개까지 만들 수 있습니다.');
      for(const a of b.areas){
        fields(a,['id','title','note','items']);id(a.id,ids);text(a.title,500);text(a.note,20000);
        if(!Array.isArray(a.items)||a.items.length>9)fail('영역마다 항목을 9개까지 담을 수 있습니다.');
        for(const item of a.items){const withRef=Object.hasOwn(item||{},'reference');fields(item,['attachment','reason',...(allowReferences&&withRef?['reference']:[])]);P().validateAttachments([item.attachment]);text(item.reason,20000);if(withRef)reference(item.reference);}
      }
    }
    if(new TextEncoder().encode(JSON.stringify(values)).length>LIMITS.bytes-1024)fail('9칸 구성은 2 MiB까지 보관할 수 있습니다.');
    return true;
  }
  function validate(value){fields(value,['format','workspaceId','revision','boards']);if(!['life-nine-board-v1','life-nine-board-v2'].includes(value.format))fail('9칸 구성 파일을 확인해 주세요.');id(value.workspaceId,new Set());if(!Number.isSafeInteger(value.revision)||value.revision<0)fail('저장 기준을 확인해 주세요.');boards(value.boards,value.format==='life-nine-board-v2');return true;}
  function empty(workspaceId){const v={format:'life-nine-board-v1',workspaceId,revision:0,boards:[]};validate(v);return v;}
  function create(fresh){return {id:fresh(),title:'',intro:'',areas:[{id:fresh(),title:'',note:'',items:[]}]};}
  function snapshot(value){return {attachment:P().attachment(value),reason:''};}
  function evidenceSnapshot(value){reference(value);return {...snapshot({type:'other',title:value.value.title||'제목 없는 기록',creator:'',url:value.kind==='source'?value.value.url:''}),reference:clone(value)};}
  function backup(values){const refs=hasReferences(values);boards(values,refs);return {format:refs?'life-nine-board-backup-v2':'life-nine-board-backup-v1',boards:clone(values)};}
  function readBackup(value){fields(value,['format','boards']);if(!['life-nine-board-backup-v1','life-nine-board-backup-v2'].includes(value.format))fail('9칸 구성 JSON 파일을 골라 주세요.');boards(value.boards,value.format==='life-nine-board-backup-v2');return clone(value.boards);}
  function copies(values,fresh){const refs=hasReferences(values);boards(values,refs);const next=clone(values);for(const b of next){b.id=fresh();for(const a of b.areas)a.id=fresh();}boards(next,refs);return next;}
  function reviewBoards(existing,incoming){
    boards(existing,hasReferences(existing));boards(incoming,hasReferences(incoming));
    // Presentation text, ordered selections and exact sources define a duplicate, not local IDs.
    const key=b=>JSON.stringify([b.title,b.intro,b.areas.map(a=>[a.title,a.note,a.items.map(i=>[i.attachment.type,i.attachment.title,i.attachment.creator,i.attachment.url,i.reason,canonical(i.reference||null)])])]);
    const saved=new Set(existing.map(key)),seen=new Set();
    return incoming.map(b=>{const value=key(b),result={existing:saved.has(value),file:seen.has(value)};seen.add(value);return result;});
  }
  function changed(base,current){boards(base,hasReferences(base));boards(current,hasReferences(current));const key=b=>JSON.stringify([b.title,b.intro,b.areas.map(a=>[a.id,a.title,a.note,a.items.map(i=>[i.attachment.type,i.attachment.title,i.attachment.creator,i.attachment.url,i.reason,canonical(i.reference||null)])])]);const before=new Map(base.map(b=>[b.id,key(b)]));return current.filter(b=>before.get(b.id)!==key(b)).map(clone);}
  const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function html(board){
    boards([board],hasReferences([board]));const types=(root.HaedoLife?.Collection || require('./collection.js')).TYPES;
    const content=board.areas.map((a,index)=>'<section><h2>'+escape(a.title||'영역 '+(index+1))+'</h2><p>'+escape(a.note)+'</p><ol>'+a.items.map(i=>'<li><strong>'+escape(i.attachment.title)+'</strong><p class="meta">'+escape([i.attachment.creator,types[i.attachment.type]].filter(Boolean).join(' · '))+'</p><p>'+escape(i.reason)+'</p>'+(i.reference?'<blockquote>'+escape(i.reference.value.quote)+'</blockquote>':'')+(i.attachment.url?'<a href="'+escape(i.attachment.url)+'" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">출처 열기</a>':'')+'</li>').join('')+'</ol></section>').join('');
    return '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>'+escape(board.title||'9칸 구성')+'</title><style>body{margin:0;background:#fff;color:#292536;font:17px/1.65 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:32px 20px}h1{font-size:32px}h2{font-size:24px;margin:40px 0 8px}p{white-space:pre-wrap;overflow-wrap:anywhere}ol{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;list-style:none;padding:0}li{border:1px solid #d7d2df;border-radius:12px;padding:18px;min-width:0;overflow-wrap:anywhere}strong{font-size:19px}a{color:#4a3865;display:inline-flex;min-height:44px;align-items:center}.meta{font-size:14px;color:#595264}@media(max-width:640px){ol{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:360px){ol{grid-template-columns:1fr}}@media print{li{break-inside:avoid}main{padding:0}a{min-height:0}}</style><main><h1>'+escape(board.title||'9칸 구성')+'</h1><p>'+escape(board.intro)+'</p>'+content+'</main></html>';
  }
  function imageContent(board,areaId){
    boards([board],hasReferences([board]));
    const area=board.areas.find(value=>value.id===areaId);
    if(!area)fail('이미지로 받을 영역을 골라 주세요.');
    // The image is a presentation copy: never promote private notes or evidence.
    return {title:board.title||'9칸 구성',areaTitle:area.title||'이름 없는 영역',
      items:Array.from({length:9},(_,index)=>area.items[index]?clone(area.items[index].attachment):null)};
  }
  function composeContent(board,areaId){
    const content=imageContent(board,areaId),types=(root.HaedoLife?.Collection||require('./collection.js')).TYPES;
    const rows=content.items.map((item,index)=>item?
      [String(index+1)+'. '+item.title,[item.creator,types[item.type]].filter(Boolean).join(' · '),'출처: '+(item.url||'출처 주소 없음')].join('\n'):
      String(index+1)+'. 빈 칸');
    return {...content,text:[content.title,content.areaTitle,...rows].join('\n\n')};
  }
  function imageLines(context,value,width,limit){
    const parts=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('ko',{granularity:'grapheme'}).segment(value)].map(part=>part.segment):Array.from(value);
    const lines=[];let line='';
    for(const part of parts){
      if(part==='\n'||part==='\r'||part==='\r\n'){lines.push(line);line='';continue;}
      const next=line+part;
      if(context.measureText(next).width<=width){line=next;continue;}
      const space=line.lastIndexOf(' ');
      if(space>0){lines.push(line.slice(0,space));line=line.slice(space+1)+part;}
      else{lines.push(line);line=part;}
    }
    if(line||!lines.length)lines.push(line);
    if(lines.length>limit){lines.length=limit;let last=Array.from(lines[limit-1]);while(last.length&&context.measureText(last.join('')+'…').width>width)last.pop();lines[limit-1]=last.join('')+'…';}
    return lines;
  }
  async function png(board,areaId,{document=root.document}={}){
    const content=imageContent(board,areaId),canvas=document?.createElement?.('canvas');
    if(!canvas?.getContext||!canvas.toBlob)fail('이 브라우저에서 PNG를 만들지 못했습니다. JSON이나 HTML로 보관해 주세요.');
    canvas.width=1800;canvas.height=2100;
    const context=canvas.getContext('2d');
    if(!context)fail('이미지 그리기를 시작하지 못했습니다. 원래 구성은 그대로입니다.');
    if(document.fonts?.ready)await document.fonts.ready;
    const font='"Apple SD Gothic Neo", "Noto Sans CJK KR", "Malgun Gothic", sans-serif';
    const draw=(value,x,y,width,{size=30,weight=400,lineHeight=42,limit=3,color='#18181b'}={})=>{
      context.font=weight+' '+size+'px '+font;context.fillStyle=color;
      const lines=imageLines(context,value,width,limit);for(const [index,line] of lines.entries())context.fillText(line,x,y+index*lineHeight);
      return lines.length*lineHeight;
    };
    context.fillStyle='#ffffff';context.fillRect(0,0,1800,2100);context.textBaseline='top';
    draw(content.title,72,58,1656,{size:56,weight:700,lineHeight:70,limit:2});
    draw(content.areaTitle,72,211,1656,{size:32,weight:500,lineHeight:44,limit:1,color:'#66666f'});
    const types=(root.HaedoLife?.Collection||require('./collection.js')).TYPES;
    for(const [index,item] of content.items.entries()){
      const x=72+(index%3)*560,y=284+Math.floor(index/3)*560;
      context.strokeStyle='#d5d5db';context.lineWidth=2;context.strokeRect(x,y,536,536);
      draw(String(index+1),x+28,y+25,480,{size:23,lineHeight:32,limit:1,color:'#66666f'});
      if(!item){draw('빈 칸',x+28,y+87,480,{size:32,lineHeight:44,limit:1,color:'#66666f'});continue;}
      draw(item.title,x+28,y+84,480,{size:34,weight:700,lineHeight:47,limit:5});
      draw([item.creator,types[item.type]].filter(Boolean).join(' · '),x+28,y+337,480,{size:25,lineHeight:35,limit:2,color:'#66666f'});
      draw(item.url||'출처 주소 없음',x+28,y+426,480,{size:23,lineHeight:31,limit:3,color:'#66666f'});
    }
    draw('제목 · 만든 사람 · 종류 · 출처만 포함 · 긴 글은 …로 줄여 표시',72,1988,1656,{size:23,lineHeight:32,limit:1,color:'#66666f'});
    draw('이미지는 보기용입니다. 전체 내용은 JSON/HTML, 사본 복원은 JSON을 이용하세요.',72,2028,1656,{size:23,lineHeight:32,limit:1,color:'#66666f'});
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Object.assign(new Error('PNG를 만들지 못했습니다. 원래 구성은 그대로입니다.'),{code:'nine_board_image_failed'})),'image/png'));
  }
  return Object.freeze({LIMITS,validate,boards,empty,create,snapshot,evidenceSnapshot,reference,hasReferences,backup,readBackup,copies,changed,reviewBoards,html,imageContent,composeContent,png});
});

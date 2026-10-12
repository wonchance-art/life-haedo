/* Explicit text references: no private notes, identity links, new storage or network. */
(function(root,factory){'use strict';const api=factory(root);root.HaedoLife ||= {};root.HaedoLife.CollectionReference=api;if(typeof module==='object'&&module.exports)module.exports=api;})(globalThis,function(root){
  'use strict';
  function from(value) {
    const C=root.HaedoLife?.Collection||(typeof require==='function'&&require('./collection.js'));
    const time='2000-01-01T00:00:00.000Z';
    const item={id:'reference',type:value.type,title:value.title,creator:value.creator||'',url:value.url||'',note:'',tags:[],details:{},archived:false,createdAt:time,updatedAt:time};
    C.validateItem(item);
    const lines=['참고한 항목 · '+C.TYPES[item.type],item.title];
    if(item.creator)lines.push((item.type==='film'?'감독: ':'만든 사람: ')+item.creator);
    if(item.url)lines.push('출처: '+item.url);
    return Object.freeze({type:item.type,title:item.title,creator:item.creator,url:item.url,text:lines.join('\n'),caption:[lines[0],...lines.slice(2)].join('\n')});
  }
  function insert(text,position,reference) {
    if(typeof text!=='string'||!Number.isInteger(position)||position<0||position>text.length)throw new Error('본문의 넣을 위치를 확인해 주세요.');
    if(position>0&&position<text.length&&/[\uD800-\uDBFF]/.test(text[position-1])&&/[\uDC00-\uDFFF]/.test(text[position]))position++;
    const before=text.slice(0,position),after=text.slice(position),block=from(reference).text;
    const left=before&&!before.endsWith('\n\n')?(before.endsWith('\n')?'\n':'\n\n'):'';
    const right=after&&!after.startsWith('\n\n')?(after.startsWith('\n')?'\n':'\n\n'):'';
    return {text:before+left+block+right+after,caret:before.length+left.length+block.length};
  }
  return Object.freeze({from,insert});
});

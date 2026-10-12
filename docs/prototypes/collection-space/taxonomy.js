/* Shared navigation taxonomy. Existing item.type IDs and design-file schema stay unchanged. */
(() => {
  'use strict';
  const types = Object.freeze({all:'전체',music:'음악',book:'책',film:'영화',video:'영상',article:'글',artwork:'예술 작품',tool:'도구',person:'인물',place:'장소',other:'기타'});
  const groups = Object.freeze([
    {id:'content',label:'콘텐츠·작품',types:['music','book','film','video','article','artwork']},
    {id:'tools',label:'도구·서비스',types:['tool']},
    {id:'people',label:'인물',types:['person']},
    {id:'places',label:'장소',types:['place']},
    {id:'other',label:'기타',types:['other']}
  ].map(group=>Object.freeze({...group,types:Object.freeze(group.types)})));
  const groupFor = type => groups.find(group=>group.types.includes(type));
  const matches = (type,category,leaf='all') => (category==='all'||groupFor(type)?.id===category)&&(leaf==='all'||type===leaf);
  function option(value,label){const n=document.createElement('option');n.value=value;n.textContent=label;return n;}
  function categories(select,all=true){select.replaceChildren(...(all?[option('all','모든 분류')]:[]),...groups.map(group=>option(group.id,group.label)));}
  function leaves(select,category,all=true){
    const previous=select.value,ids=category==='all'?Object.keys(types).filter(id=>id!=='all'):(groups.find(group=>group.id===category)?.types||[]);
    select.replaceChildren(...(all?[option('all','모든 종류')]:[]),...ids.map(id=>option(id,types[id])));
    select.value=all?'all':(ids.includes(previous)?previous:ids[0]);
    // A singleton category needs no additional choice, but its selected type stays available to forms.
    select.disabled=ids.length===1;
    if(ids.length===1)select.value=ids[0];
  }
  window.CollectionTaxonomy=Object.freeze({types,groups,groupFor,matches,categories,leaves});
})();

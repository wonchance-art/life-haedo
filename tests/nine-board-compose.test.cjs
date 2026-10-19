'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../assets/life/nine-board.js'),Photo=require('../assets/life/photo-post.js');
const sample=()=>({id:'board',title:'다시 읽는 아홉 칸',intro:'PRIVATE_INTRO',areas:[
  {id:'other',title:'선택하지 않은 영역',note:'OTHER_NOTE',items:[{attachment:{type:'music',title:'OTHER_TITLE',creator:'OTHER_CREATOR',url:'https://example.org/other'},reason:'OTHER_REASON'}]},
  {id:'chosen',title:'이번 여행에서 읽은 책',note:'PRIVATE_NOTE',items:[{attachment:{type:'book',title:'긴 제목의 끝 🌱',creator:'익명 저자',url:'https://example.org/exact?edition=2&original=yes'},reason:'PRIVATE_REASON',reference:{kind:'source',value:{format:'life-source-reference-v1',workspaceId:'workspace',sourceId:'source',sourceVersionId:'exact',locator:{start:0,end:13},quote:'PRIVATE_QUOTE',contentHash:'a'.repeat(64),title:'PRIVATE_REFERENCE_TITLE',sourceKey:'source',url:'https://example.org/private'}}}]},
]});
test('A new post projection contains only the chosen image fields and full plain text, not private context',()=>{
  const b=sample(),before=structuredClone(b),v=M.composeContent(b,'chosen');
  assert.deepEqual({title:v.title,areaTitle:v.areaTitle,items:v.items},M.imageContent(b,'chosen'));
  assert.equal(v.items.length,9);assert.equal(v.items.filter(Boolean).length,1);
  assert.equal(v.text,'다시 읽는 아홉 칸\n\n이번 여행에서 읽은 책\n\n1. 긴 제목의 끝 🌱\n익명 저자 · 책\n출처: https://example.org/exact?edition=2&original=yes\n\n2. 빈 칸\n\n3. 빈 칸\n\n4. 빈 칸\n\n5. 빈 칸\n\n6. 빈 칸\n\n7. 빈 칸\n\n8. 빈 칸\n\n9. 빈 칸');
  assert(!/PRIVATE_|OTHER_|workspace|sourceId|reference/.test(JSON.stringify(v)));
  v.items[0].title='독립 검토 사본';assert.deepEqual(b,before);
  assert.deepEqual(M.readBackup(M.backup([b])),[b]);assert.match(M.html(b),/PRIVATE_REASON/);
});
test('All nine maximum safe attachments remain complete within the existing post body limit',()=>{
  const b=sample();b.title='구'.repeat(500);b.areas[1].title='영'.repeat(500);
  b.areas[1].items=Array.from({length:9},(_,i)=>({attachment:{type:'book',title:'제'.repeat(495)+'끝'+i+'🌱',creator:'작'.repeat(500),url:'https://example.org/'+String(i).repeat(2048-'https://example.org/'.length)},reason:'PRIVATE_REASON'}));
  const before=structuredClone(b),v=M.composeContent(b,'chosen');
  for(const item of b.areas[1].items){assert(v.text.includes(item.attachment.title));assert(v.text.includes(item.attachment.creator));assert(v.text.includes(item.attachment.url));}
  assert(v.text.length<=Photo.LIMITS.text);assert(!v.text.includes('…'));assert.deepEqual(b,before);
});
test('Unknown or malformed selections fail before any image or document is created',()=>{
  const b=sample(),before=structuredClone(b);assert.throws(()=>M.composeContent(b,'missing'),/영역/);
  const invalid=structuredClone(b);invalid.areas[1].items[0].attachment.note='PRIVATE_COLLECTION_NOTE';
  assert.throws(()=>M.composeContent(invalid,'chosen'));assert.deepEqual(b,before);
});

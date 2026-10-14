'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),M=require('../assets/life/nine-board.js');
function sample(){return {id:'board',title:'내가 고른 것',intro:'서로 다른 취향 🌱',areas:[{id:'area',title:'책',note:'지금 다시 읽고 싶은 책',items:[M.snapshot({type:'book',title:'빛의 간격',creator:'익명 저자',url:'https://example.org/book?edition=1',note:'비밀 메모',tags:['비밀'],details:{rights:'비밀'}})]}]};}
test('snapshots and file roundtrip preserve exact selected data, never copy private collection fields',()=>{
 const b=sample();b.areas[0].items[0].reason='선택 이유\n🌱';const saved=structuredClone(b),v={...M.empty('workspace'),boards:[b]};assert(M.validate(v));
 const backup=M.backup(v.boards),read=M.readBackup(JSON.parse(JSON.stringify(backup)));assert.deepEqual(read,[b]);assert(!JSON.stringify(backup).includes('비밀'));read[0].areas[0].items[0].attachment.title='사본만 바꿈';assert.deepEqual(b,saved);
 let n=0;const copies=M.copies([b],()=> 'copy_'+(++n));assert.equal(copies[0].id,'copy_1');assert.equal(copies[0].areas[0].id,'copy_2');assert.deepEqual(copies[0].areas[0].items,b.areas[0].items);
});
test('partial boards are valid; area/item limits, unknown fields, malformed text and unsafe source URLs fail closed',()=>{
 assert(M.boards([{...sample(),areas:[]}]));const b=sample();b.areas=Array.from({length:9},(_,i)=>({...structuredClone(b.areas[0]),id:'a'+i,items:Array.from({length:9},()=>M.snapshot({type:'other',title:'항목'}))}));assert(M.boards([b]));
 for(const mutate of [b=>b.areas.push({...b.areas[0],id:'extra'}),b=>b.areas[0].items.push(b.areas[0].items[0]),b=>b.areas[0].items[0].attachment.url='javascript:alert(1)',b=>b.areas[0].items[0].attachment.note='hidden',b=>b.title='\ud800',b=>b.areas[0].note='\u0000',b=>b.areas[0].id=b.id,b=>b.owner='hidden']){const value=structuredClone(b);mutate(value);assert.throws(()=>M.boards([value]));}
 assert.throws(()=>M.readBackup({...M.backup([sample()]),workspaceId:'hidden'}));assert.throws(()=>M.validate({...M.empty('w'),revision:-1}));
});
test('recovery only copies local changes and keeps the actual saved payload as comparison baseline',()=>{
 const a=sample(),b={...sample(),id:'second',areas:[{...sample().areas[0],id:'second_area'}]},base=[a,b],local=structuredClone(base);local[0].areas[0].items[0].reason='저장 중 이어 쓴 입력';
 assert.deepEqual(M.changed(base,local),[local[0]]);assert.deepEqual(M.changed(base,[structuredClone(a)]),[]);const sorted=structuredClone(base);sorted[0].areas[0].items[0].attachment={url:a.areas[0].items[0].attachment.url,title:'빛의 간격',type:'book',creator:'익명 저자'};assert.deepEqual(M.changed(base,sorted),[]);
});
test('standalone HTML safely renders exact reasons and sources without scripts, trackers or private IDs',()=>{
 const b=sample();b.title='<script>alert(1)</script>';b.areas[0].items[0].reason='</p><img src=x onerror=alert(1)> 🌱';const html=M.html(b);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);assert.match(html,/https:\/\/example.org\/book\?edition=1/);assert.match(html,/Content-Security-Policy/);assert(!/<script|<img|id="board"/.test(html));assert.match(html,/noopener noreferrer/);
});
test('capacity and aggregate UTF-8 budget reject without trimming saved content',()=>{
 let n=0;const values=Array.from({length:20},()=>M.create(()=> 'id_'+(++n)));assert(M.boards(values));const before=structuredClone(values);assert.throws(()=>M.boards(values.concat(M.create(()=> 'id_'+(++n)))));assert.deepEqual(values,before);
 const a=sample();a.areas=Array.from({length:9},(_,i)=>({id:'area_'+i,title:'영역',note:'',items:Array.from({length:9},()=>({...M.snapshot({type:'other',title:'원본'}),reason:'한'.repeat(20000)}))}));assert.throws(()=>M.boards([a]));assert.equal(a.areas[8].items[8].reason.length,20000);
});

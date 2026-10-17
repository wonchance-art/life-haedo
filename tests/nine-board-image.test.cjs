'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),M=require('../assets/life/nine-board.js');
const sample=()=>({id:'board',title:'한글 구성',intro:'개인 소개',areas:[{id:'first',title:'책',note:'개인 메모',items:[{attachment:{type:'book',title:'오래 읽는 책',creator:'익명',url:'https://example.org/book'},reason:'선택 이유'}]},{id:'second',title:'음악',note:'다른 개인 메모',items:[]}]});
test('PNG projection has exactly nine slots from the chosen area, with no notes or reasons',()=>{
 const b=sample();b.areas[0].items[0].reference={kind:'source',value:{format:'life-source-reference-v1',workspaceId:'workspace',sourceId:'source',sourceVersionId:'exact',locator:{start:0,end:4},quote:'개인근거',contentHash:'a'.repeat(64),title:'원문',sourceKey:'source',url:'https://example.org/exact'}};
 const before=structuredClone(b),v=M.imageContent(b,'first');
 assert.deepEqual(v,{title:'한글 구성',areaTitle:'책',items:[b.areas[0].items[0].attachment,...Array(8).fill(null)]});
 assert(!JSON.stringify(v).includes('개인'));assert(!JSON.stringify(v).includes('선택 이유'));
 v.items[0].title='이미지 사본';assert.deepEqual(b,before);assert.deepEqual(M.imageContent(b,'second').items,Array(9).fill(null));
 assert.deepEqual(M.readBackup(M.backup([b])),[b]);assert.match(M.html(b),/선택 이유/);assert.match(M.html(b),/개인 메모/);
});
test('PNG rejects an unknown area and unsupported canvas without changing the source',async()=>{
 const b=sample(),before=structuredClone(b);assert.throws(()=>M.imageContent(b,'missing'),/영역/);
 await assert.rejects(M.png(b,'first',{document:{createElement:()=>({})}}),/JSON이나 HTML/);assert.deepEqual(b,before);
});

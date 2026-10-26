'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../assets/life/obsidian-link-candidates.js');
const note=(path,id,text)=>({path,sourceId:'source-'+id,sourceVersionId:'version-'+id,origin:'obsidian',text});
const notes=[note('folder/같은.md','a','# 절\r\n첫 줄 ^tag\r\n# 절\r\n둘째 ^tag'),note('else/같은.md','b','# 절\n내용'),note('목표.md','c','\uFEFF# 시작\r\n😀 본문')];
const file={path:'folder/사진.png',copyId:'copy-1',snapshotPath:'snapshot/attachments/folder/사진.png',sha256:'a'.repeat(64),mime:'image/png',bytes:12};
const resolve=(target,extra={})=>C.resolve({occurrence:{target,invalid:false},fromPath:'folder/현재.md',notes,attachments:[],...extra});
test('exact UTF-16 token offsets survive BOM, CRLF and emoji while excluding comments, code and escaped references',()=>{
 const text='\uFEFF😀 [[같은#절|표시]]\r\n`[[코드]]` <!-- [[숨김]] --> \\[[탈출]]\r\n```md\r\n[[펜스]]\r\n```\r\n![[사진.png|200]] [문서](../목표.md#시작)';
 const rows=C.scan(text);assert.equal(rows.length,3);for(const row of rows)assert.equal(text.slice(row.start,row.end),row.token);
 assert.equal(rows[0].start,4);assert.equal(rows[0].target,'같은#절');assert.equal(rows[1].embed,true);assert.equal(rows[2].target,'../목표.md#시작');
});
test('duplicate paths and repeated headings/block ids all require explicit choice',()=>{
 let r=resolve('같은#절');assert.equal(r.status,'ambiguous');assert.equal(r.requiresSelection,true);assert.equal(r.candidates.length,2);assert.equal(r.candidates[0].anchorStatus,'anchor_ambiguous');assert.equal(r.candidates[0].locators.length,2);
 r=resolve('folder/같은#^tag');assert.equal(r.candidates[0].anchorStatus,'anchor_ambiguous');assert.equal(r.candidates[0].locators.length,2);
 r=resolve('../목표#시작');assert.equal(r.status,'candidate');assert.equal(r.candidates[0].anchorStatus,'anchor_found');assert.equal(r.requiresSelection,true);
 assert.equal(resolve('없는#제목').status,'missing');assert.equal(resolve('목표#없는').candidates[0].anchorStatus,'anchor_missing');
});
test('attachment inventory scope distinguishes unchecked, missing, duplicate and explicit local candidates',()=>{
 assert.equal(resolve('사진.png',{attachments:null}).status,'not_checked');assert.equal(resolve('사진.png').status,'missing');
 const one=resolve('사진.png',{attachments:[file]});assert.equal(one.status,'candidate');assert.equal(one.requiresSelection,true);assert.equal(one.candidates[0].sha256,file.sha256);
 const two=resolve('사진.png',{attachments:[file,{...file,copyId:'copy-2'}]});assert.equal(two.status,'ambiguous');assert.equal(two.candidates.length,2);assert.equal(resolve('사진.png#part',{attachments:[file]}).status,'unsupported_fragment');
});
test('never resolves other origins, malformed paths or active/external content; scanning does not mutate input',()=>{
 const x=[...notes,note('else/비밀.md','x','private')];x.at(-1).origin='other';const saved=structuredClone(x);
 assert.equal(resolve('비밀',{notes:x}).status,'missing');assert.deepEqual(x,saved);assert.equal(resolve('../../탈출').status,'invalid');
 assert.equal(C.scan('[외부](https://example.com/a) [[https://example.com]]').length,0);
 assert.equal(C.scan('[애매](파일%23이름.md)').at(0).invalid,true);assert.equal(resolve('악성\\\\경로').status,'invalid');
});
test('BOM fences stay hidden and excessive ambiguous candidates do not silently truncate',()=>{
 assert.deepEqual(C.scan('\uFEFF```\r\n[[감춤]]\r\n```\r\n[[보임]]').map(row=>row.target),['보임']);
 const many=Array.from({length:201},(_,n)=>note('p'+n+'/반복.md',String(n),'# 제목\n본문'));
 const r=resolve('반복#제목',{notes:many});assert.equal(r.status,'too_many_candidates');assert.equal(r.candidateCount,201);assert.deepEqual(r.candidates,[]);assert.equal(r.requiresSelection,true);
 assert.throws(()=>resolve('같은',{fromPath:'../unsafe.md'}),/invalid_scope/);
});
test('dotted note names remain notes, while a same-named attachment needs an explicit kind',()=>{
 const extra=note('folder/계획.v2.md','d','# 목표');
 assert.equal(resolve('계획.v2',{notes:[extra]}).kind,'note');
 const attachment={...file,path:'folder/계획.v2'};
 const both=resolve('계획.v2',{notes:[extra],attachments:[attachment]});assert.equal(both.status,'ambiguous_kind');assert.equal(both.requiresSelection,true);
 assert.equal(resolve('계획.v2',{notes:[extra],attachments:[attachment],requestedKind:'note'}).candidates[0].sourceId,'source-d');
 assert.equal(resolve('계획.v2',{notes:[extra],attachments:[attachment],requestedKind:'attachment'}).candidates[0].copyId,attachment.copyId);
});
test('same path with multiple exact versions never silently prefers latest or invents a missing body',()=>{
 const old=note('folder/記録.md','old','# 節\n旧文'); const newer=note('folder/記録.md','new','# 節\n新文');
 const r=resolve('記録#節',{notes:[old,newer]});assert.equal(r.status,'ambiguous');assert.deepEqual(r.candidates.map(v=>v.sourceVersionId),['version-old','version-new']);
 const unavailable=resolve('記録#節',{notes:[{...old,text:null}]});assert.equal(unavailable.candidates[0].anchorStatus,'text_missing');assert.deepEqual(unavailable.candidates[0].locators,[]);
});

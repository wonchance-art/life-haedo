'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../assets/life/page-posts.js'),W=require('../assets/life/workbench.js'),C=require('../assets/life/core.js'),S=require('../assets/life/share.js');
const time='2026-10-12T01:00:00.000Z';
function saved(){const p=M.draft([],'post',time);p.body='산책하며 들은 음악\n🌱 오래 머문 생각';p.attachments=[M.attachment({type:'music',title:'걷는 마음',creator:'익명 음악가',url:'https://example.org/music',note:'절대 공개하지 않을 메모'})];return M.finish([p],p.id,time).posts[0];}
test('attachment snapshot excludes private note, tags, IDs and future metadata',()=>{assert.deepEqual(Object.keys(saved().attachments[0]),['type','title','creator','url']);assert.throws(()=>M.validateAttachments([{...saved().attachments[0],note:'private'}]));});
test('draft and private posts never enter public copy; explicit candidate preserves body and snapshots',()=>{const p=saved(),d=M.draft([p],'draft',time,p.id);d.visibility='page';assert.deepEqual(M.publicEntries([p,d]),[]);p.visibility='page';const entries=M.publicEntries([p,d]);assert.equal(entries.length,1);assert.equal(entries[0].note,p.body);assert.deepEqual(entries[0].attachments,p.attachments);S.validate({format:'life-share-v1',title:'내 페이지',intro:null,entries});});
test('failed revision match retains both saved post and draft, new-copy recovery works',()=>{const p=saved(),d=M.draft([p],'draft',time,p.id);d.body='새로운 생각';p.updatedAt='2026-10-12T02:00:00.000Z';const data=[p,d],before=structuredClone(data);assert.throws(()=>M.finish(data,d.id,time));assert.deepEqual(data,before);const result=M.finish(data,d.id,time,{asNew:true});assert.equal(result.posts.length,2);assert.equal(result.posts[0].body,p.body);});
test('editing commits once with original identity/date and monotonic revision marker',()=>{const p=saved(),d=M.draft([p],'draft',time,p.id);d.body='다시 쓴 글';const r=M.finish([p,d],d.id,time);assert.equal(r.posts.length,1);assert.equal(r.id,p.id);assert.equal(r.posts[0].createdAt,p.createdAt);assert(r.posts[0].updatedAt>p.updatedAt);});
test('source/workbench backup round trip preserves saved post, remaps ID; composition rejects local drafts',async()=>{const bundle=C.createWorkspace(),state=W.empty(bundle.workspaceId),p=saved();state.page.posts=[p];W.validate(state);const before=structuredClone(state);const restored=await W.restoreBackup(W.makeBackup(bundle,state));assert.equal(restored.workbench.page.posts[0].body,p.body);assert.notEqual(restored.workbench.page.posts[0].id,p.id);assert.deepEqual(restored.workbench.page.posts[0].attachments,p.attachments);assert.deepEqual(state,before);state.page.posts.push(M.draft(state.page.posts,'draft',time));assert.throws(()=>W.validate(state));});
test('strict attachment URLs, malformed Unicode, limits and ambiguous public entry rejected',()=>{for(const url of ['javascript:alert(1)','https://user:pass@example.org','https:example.org','https://example.org/ a'])assert.throws(()=>M.attachment({type:'book',title:'책',url}));assert.throws(()=>M.attachment({type:'book',title:'\ud800'}));const p=saved();p.body='가'.repeat(499)+'🌱';p.visibility='page';assert.equal(M.publicEntries([p])[0].title,'가'.repeat(499));const entry=M.publicEntries([p])[0];entry.parts=[{}];assert.throws(()=>S.validate({format:'life-share-v1',title:'페이지',intro:null,entries:[entry]}));});
test('a full saved feed can still edit an existing post',()=>{const posts=Array.from({length:200},(_,i)=>({...saved(),id:'post_'+i}));const d=M.draft(posts,'draft',time,posts[0].id);d.body='수정';assert.equal(M.finish(posts.concat(d),d.id,time).posts.length,200);assert.throws(()=>M.draft(posts,'extra',time));});
test('legacy draft backup validates strictly and never accepts saved posts or hidden fields',()=>{
 const d=M.draft([saved()],'draft',time,'post'),value={format:'life-page-drafts-v1',posts:[d]};
 const parsed=M.readDraftBackup(value);assert.deepEqual(parsed,[d]);parsed[0].body='별도 사본';assert.notEqual(parsed[0].body,d.body);
 for(const v of [{...value,format:'other'},{...value,owner:'secret'},{...value,posts:[saved()]},{...value,posts:[{...d,attachments:[{...d.attachments[0],note:'private'}]}]}])assert.throws(()=>M.readDraftBackup(v));
});
test('duplicate review uses exact body and ordered attachment fields, across IDs and field order',()=>{
 const d=M.draft([saved()],'draft',time,'post'),same={...structuredClone(d),id:'another',visibility:'page',replaces:null,baseUpdatedAt:null};
 same.attachments=same.attachments.map(a=>({url:a.url,creator:a.creator,title:a.title,type:a.type}));
 const space={...structuredClone(same),id:'space',body:same.body+' '},url={...structuredClone(same),id:'url'};url.attachments[0].url+='?different';
 assert.deepEqual(M.reviewDrafts([d],[same,space,url,{...same,id:'repeat'}]),[{existing:true,file:false},{existing:false,file:false},{existing:false,file:false},{existing:true,file:true}]);
 const pair={...structuredClone(d),id:'pair',attachments:d.attachments.concat(M.attachment({type:'artwork',title:'빛',creator:'익명 작가'}))},reverse={...structuredClone(pair),id:'reverse',attachments:pair.attachments.slice().reverse()};
 assert.deepEqual(M.reviewDrafts([pair],[reverse]),[{existing:false,file:false}]);
});
test('restore selected drafts is isolated, private, detached and refuses capacity or ID collisions',()=>{
 const d=M.draft([saved()],'draft',time,'post');d.visibility='page';const original=structuredClone(d),base=[{...structuredClone(d),id:'existing'}];
 const added=M.restoreDrafts(base,[d],()=> 'restored');assert.deepEqual(d,original);assert.equal(base.length,1);assert.equal(added[0].id,'restored');assert.equal(added[0].visibility,'private');assert.equal(added[0].replaces,null);assert.equal(added[0].baseUpdatedAt,null);assert.equal(added[0].createdAt,d.createdAt);assert.deepEqual(added[0].attachments,d.attachments);
 added[0].attachments[0].title='사본 수정';assert.deepEqual(d,original);
 assert.throws(()=>M.restoreDrafts(base,[d],()=> 'existing'));assert.throws(()=>M.restoreDrafts(Array.from({length:200},(_,i)=>({...d,id:'d_'+i})),[d],()=> 'extra'));
});

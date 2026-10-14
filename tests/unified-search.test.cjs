const test = require('node:test'), assert = require('node:assert/strict');
const core = require('../assets/life/core.js'), model = require('../assets/life/unified-search.js');
async function fixture() {
  let bundle = core.createWorkspace();
  const first = await core.prepareImport({origin:'apple_notes', title:'산책을 배우는 기록',text:'첫 줄🌱\r\n오래 좋아할 기준은 무엇일까?',authorRelation:'self'}, bundle);
  bundle = core.applyChanges(bundle,core.buildImportChanges(bundle,first));
  const second = await core.prepareImport({origin:'apple_notes',title:first.source.title,existingSourceId:first.source.id,text:'최신 글에는 다른 문장만 있다.',authorRelation:'self'},bundle);
  bundle = core.applyChanges(bundle,core.buildImportChanges(bundle,second));
  return {bundle,first,second};
}
test('unified search preserves exact UTF-16 old source match and does not mutate input',async()=>{
 const {bundle,first}=await fixture(), before=structuredClone(bundle);
 const rows=model.search({bundle},'오래좋아할',{ignoreKoreanSpacing:true});assert.equal(rows.length,1);assert.equal(rows[0].sourceVersionId,first.version.id);assert.equal(first.version.contentText.slice(rows[0].locator.start,rows[0].locator.end),'오래 좋아할');assert.deepEqual(bundle,before);
 assert.equal(model.search({bundle},'오래좋아할').length,0);
});
test('saved private and candidate posts and hidden composition comments are discoverable; drafts are excluded',()=>{
 const workbench={page:{posts:[{id:'saved',status:'saved',body:'산책 본문',attachments:[],visibility:'private'},{id:'draft',status:'draft',body:'산책 초안',attachments:[],visibility:'page'}],entries:[{id:'entry',title:'산책 구성',note:'숨긴 코멘트',enabled:false}]}};
 const before=structuredClone(workbench),rows=model.search({workbench},'산책');assert.equal(rows.length,2);assert.match(rows[0].meta,/비공개/);assert.match(rows[1].meta,/표시 꺼짐/);assert.deepEqual(workbench,before);
});
test('collection searches private metadata and explicitly includes archived items',()=>{
 const item={id:'c',type:'book',title:'책',creator:'작가',note:'산책하는 마음',tags:['관찰'],details:{year:'2024'},url:'https://example.org',archived:true};
 const collection={items:[item]};assert.equal(model.search({collection},'산책').length,0);
 for(const q of ['산책','작가','관찰','2024','example.org']) assert.equal(model.search({collection},q,{archived:true})[0].itemId,'c');
});
test('identical source and page/collection text keep separate identities and storage roles',async()=>{
 const {bundle}=await fixture();const workbench={page:{posts:[{id:'p',status:'saved',body:'산책',attachments:[],visibility:'page'}],entries:[]}};
 const collection={items:[{id:'c',type:'book',title:'산책',creator:'',note:'',tags:[],details:{},url:'',archived:false}]};
 const rows=model.search({bundle,workbench,collection},'산책');assert.deepEqual(rows.map(r=>r.kind),['source','page','collection']);assert.equal(new Set(rows.map(r=>r.key)).size,3);assert.match(rows[1].meta,/공개 후보/);
});
test('partial failures allow independent stores and blank queries expose no inventory',()=>{
 assert.deepEqual(model.search({},'본문'),[]);assert.deepEqual(model.search({},'  '),[]);assert.throws(()=>model.search({},'x'.repeat(501)),{code:'invalid_query'});
});
test('saved nine boards project distinct board, area and item matches without changing data', () => {
 const item = {attachment:{type:'book',title:'한 권',creator:'익명 창작자',url:'https://example.org/source'},reason:'🌱오래 좋아할 기준\r\n다음 줄'};
 const nineBoard = {boards:[{id:'b',title:'작은 발견',intro:'산책 소개',areas:[{id:'a',title:'읽을 문장',note:'느린 관찰',items:[item,structuredClone(item)]}]}]};
 const before=structuredClone(nineBoard);
 for(const [q,field] of [['작은 발견','구성 제목'],['산책','구성 소개'],['느린 관찰','영역 설명'],['창작자','만든 사람'],['example.org','출처']]) {
  const rows=model.search({nineBoard},q);assert.equal(rows[0].kind,'nine');assert.equal(rows[0].field,field);
  model.resolveNineTarget(nineBoard,rows[0].nineTarget);
 }
 const rows=model.search({nineBoard},'오래좋아할',{ignoreKoreanSpacing:true});assert.equal(rows.length,2);assert.notEqual(rows[0].key,rows[1].key);assert.match(rows[0].snippet,/🌱오래 좋아할 기준/);
 assert.equal(model.search({nineBoard},'오래좋아할').length,0);assert.deepEqual(model.search({nineBoard},' '),[]);assert.deepEqual(nineBoard,before);
});
test('a changed or reordered nine target is never replaced by another item or first board', () => {
 const item=title=>({attachment:{type:'book',title,creator:'',url:''},reason:'선택 이유'});
 const nineBoard={boards:[{id:'b',title:'구성',intro:'',areas:[{id:'a',title:'영역',note:'',items:[item('찾을 대상'),item('다른 대상')]}]}]};
 const target=model.search({nineBoard},'찾을 대상')[0].nineTarget;
 const edit=structuredClone(nineBoard);edit.boards[0].areas[0].items[0].reason+=' 변경';assert.throws(()=>model.resolveNineTarget(edit,target),/다시 불러와/);
 edit.boards[0].areas[0].items.reverse();assert.throws(()=>model.resolveNineTarget(edit,target),/다시 불러와/);
 assert.throws(()=>model.resolveNineTarget({boards:[]},target),/다시 불러와/);
 const stable=structuredClone(nineBoard);stable.boards[0].title='새 구성 이름';assert.equal(model.resolveNineTarget(stable,target).item.attachment.title,'찾을 대상');
});
test('literal matching never treats HTML, regex, Latin spacing or newlines as fuzzy matches',()=>{
 assert.equal(core.findSearchText('a.b [x]','a.b').text,'a.b');assert.equal(core.findSearchText('aXb','a.b'),null);
 assert.equal(core.findSearchText('한\n글','한글',{ignoreKoreanSpacing:true}),null);assert.equal(core.findSearchText('open source','opensource',{ignoreKoreanSpacing:true}),null);
 const text='🌱<script>값</script>';const hit=core.findSearchText(text,'<script>');assert.equal(hit.start,2);assert.equal(text.slice(hit.start,hit.end),hit.text);
});
test('record-only metadata resolves each exact version position without borrowing latest body', async () => {
 const {bundle,first,second}=await fixture();
 bundle.records.push({id:core.id(),kind:'excerpt',text:'첫 줄',topic:'분류표식',note:'나의 메모',sourceRefs:[{sourceId:first.source.id,sourceVersionId:first.version.id,locator:{start:0,end:3}}],provenance:{kind:'user'},revision:1,createdAt:bundle.createdAt,updatedAt:bundle.updatedAt});
 const before=structuredClone(bundle),rows=model.search({bundle},'분류표식');
 assert.equal(rows.length,1);assert.equal(rows[0].sourceVersionId,first.version.id);assert.equal(rows[0].versionIndex,1);assert.equal(rows[0].versionCount,2);assert.equal(rows[0].field,'주제');assert.notEqual(rows[0].sourceVersionId,second.version.id);assert.deepEqual(bundle,before);
});

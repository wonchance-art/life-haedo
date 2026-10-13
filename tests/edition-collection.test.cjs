'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../assets/life/collection.js');
const fresh=()=>{delete require.cache[require.resolve('../assets/life/collection-metadata.js')];return require('../assets/life/collection-metadata.js');};
const work='https://openlibrary.org/works/OL123W',r=data=>new Response(JSON.stringify(data));
test('Editions require explicit work relation and preserve edition identity without guessing author',async()=>{
 let request;const result=await fresh().editions(work,0,{fetcher:async(...args)=>{request=args;return r({size:9,entries:[
 {key:'/books/OL12M',title:'한글 판본',works:[{key:'/works/OL123W'}],languages:[{key:'/languages/kor'}],publishers:['익명 출판사'],publish_date:'2021'},
 {key:'/books/OL13M',title:'다른 작품',works:[{key:'/works/OL999W'}]}, {key:'https://evil.test',title:'bad',works:[{key:'/works/OL123W'}]}
 ]});}});
 assert.equal(request[0],work+'/editions.json?limit=6&offset=0');assert.equal(request[1].credentials,'omit');assert.equal(result.results.length,1);assert(result.hasMore);assert.equal(result.results[0].url,'https://openlibrary.org/books/OL12M');assert.equal(result.results[0].creator,'');assert.match(result.results[0].detail,/한국어 · 익명 출판사 · 2021/);
});
test('Edition pagination, malformed payloads, response limit and pre-abort never permit arbitrary fetches',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return r({size:0,entries:[]});};
 for(const [url,offset] of [['https://evil.test/works/OL1W',0],[work,-1],[work,1],[work,606]])await assert.rejects(fresh().editions(url,offset,{fetcher}));assert.equal(calls,0);
 const controller=new AbortController();controller.abort();await assert.rejects(fresh().editions(work,0,{fetcher,signal:controller.signal}),{name:'AbortError'});assert.equal(calls,0);
 await assert.rejects(fresh().editions(work,0,{fetcher:async()=>r({entries:{}})}),/형식/);
 await assert.rejects(fresh().editions(work,0,{fetcher:async()=>new Response('x'.repeat(65537))}),/너무 큽니다/);
 const result=await fresh().editions(work,6,{fetcher});assert.equal(result.hasMore,false);assert.equal(result.offset,6);
});
test('Cancelling the brief provider interval prevents the edition HTTP request',async()=>{
 const m=fresh();let calls=0;await m.search('books','title',{fetcher:async()=>r({docs:[]})});
 const controller=new AbortController(),pending=m.editions(work,0,{signal:controller.signal,fetcher:async()=>{calls++;return r({entries:[]});}});controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,0);
});
const stamp='2026-10-14T00:00:00.000Z',attachment={type:'book',title:'읽던 책',creator:'익명 저자',url:'https://openlibrary.org/books/OL12M'};
test('Collection copy selects metadata only, remains independent and compatible with existing backup',()=>{
 const a={...attachment,body:'copy forbidden',note:'copy forbidden',tags:['private']};const item=C.fromAttachment(a,'book',stamp);assert.equal(item.note,'');assert.deepEqual(item.tags,[]);assert.deepEqual(item.details,{});assert(!JSON.stringify(item).includes('forbidden'));a.title='changed';assert.equal(item.title,'읽던 책');
 const state=C.empty('workspace');state.items.push(item);assert.deepEqual(C.readBackup(JSON.stringify(C.makeBackup(state))).items,[item]);
});
test('Existing and archived exact sources are preserved; different editions and unlinked names are not merged',()=>{
 const old=C.fromAttachment(attachment,'old',stamp);old.archived=true;old.note='오래된 개인 메모';
 assert.equal(C.attachmentMatch([old],{...attachment,title:'수정한 제목'}),old);
 assert.equal(C.attachmentMatch([old],{...attachment,url:'https://openlibrary.org/books/OL13M'}),null);
 const unlinked={...old,url:''};assert.equal(C.attachmentMatch([unlinked],{...attachment,url:''}),unlinked);assert.equal(C.attachmentMatch([unlinked],attachment),null);assert.equal(C.attachmentMatch([old],{...attachment,type:'film'}),null);
});

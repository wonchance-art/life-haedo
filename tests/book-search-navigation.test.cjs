'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fresh = () => { delete require.cache[require.resolve('../assets/life/collection-metadata.js')]; return require('../assets/life/collection-metadata.js'); };
const response = data => new Response(JSON.stringify(data));
const work = 'https://openlibrary.org/works/OL123W';
const edition = { key:'/books/OL456M', title:'다시 읽는 한국어판', language:['kor'], publisher:['익명 출판사'], publish_date:['2021'] };
const payload = row => ({docs:[{key:'/works/OL123W',editions:{docs:[row]}}]});
test('Korean edition is scoped to the exact work and never inherits the work author', async () => {
  let request;
  const result = await fresh().koreanEdition(work,{fetcher:async (...args)=>{request=args;return response(payload(edition));}});
  const url = new URL(request[0]);
  assert.equal(url.origin,'https://openlibrary.org'); assert.equal(url.searchParams.get('q'),'key:/works/OL123W language:kor'); assert.equal(url.searchParams.get('limit'),'1');
  assert.equal(request[1].credentials,'omit'); assert.equal(request[1].redirect,'error');
  assert.equal(result.results[0].url,'https://openlibrary.org/books/OL456M'); assert.equal(result.results[0].creator,''); assert.equal(result.results[0].detail,'한국어 · 익명 출판사 · 2021'); assert.equal(result.hasMore,false);
});
test('Mismatched work, language and malformed metadata cannot become Korean edition candidates', async () => {
  for(const data of [{docs:[{key:'/works/OL999W',editions:{docs:[edition]}}]}, {docs:[{key:'/works/OL123W'}]}, payload({...edition,language:['eng']}),payload({...edition,key:'https://evil.test'}),payload({...edition,publisher:'not a list'})]) {
    await assert.rejects(fresh().koreanEdition(work,{fetcher:async()=>response(data)}));
  }
  assert.deepEqual((await fresh().koreanEdition(work,{fetcher:async()=>response({docs:[]})})).results,[]);
});
test('Book pagination stays bounded and never changes the query or enables project pagination', async () => {
  let request;
  const result = await fresh().search('books','한글 제목',{page:2,fetcher:async u=>{request=new URL(u);return response({numFound:15,docs:[{key:'/works/OL3W',title:'세 번째 책'}]});}});
  assert.equal(request.searchParams.get('q'),'한글 제목'); assert.equal(request.searchParams.get('page'),'2');assert.equal(result.page,2);assert.equal(result.hasMore,true);
  for(const page of [0,101,1.5,'2']) await assert.rejects(fresh().search('books','제목',{page,fetcher:()=>assert.fail('must not fetch')}));
  await assert.rejects(fresh().search('projects','idb',{page:2,fetcher:()=>assert.fail('must not fetch')}));
  const end = await fresh().search('books','제목',{page:100,fetcher:async()=>response({numFound:999,docs:[{key:'/works/OL1W',title:'끝'}]})});assert.equal(end.hasMore,false);
});
test('Korean lookup cancellation, timeout and response bound preserve explicit-request limits', async () => {
  const m=fresh(), controller=new AbortController();let called=0;
  await m.search('books','제목',{fetcher:async()=>response({docs:[]})});
  const pending=m.koreanEdition(work,{signal:controller.signal,fetcher:async()=>{called++;return response(payload(edition));}});controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(called,0);
  await assert.rejects(fresh().koreanEdition('https://evil.test/works/OL123W',{fetcher:()=>assert.fail('must not fetch')}));
  await assert.rejects(fresh().koreanEdition(work,{fetcher:async()=>new Response('x'.repeat(65537))}),/너무 큽니다/);
  await assert.rejects(fresh().koreanEdition(work,{timeout:5,fetcher:(_u,{signal})=>new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))}),/초과/);
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
function fresh() { delete require.cache[require.resolve('../assets/life/collection-metadata.js')]; return require('../assets/life/collection-metadata.js'); }
const response = data => new Response(JSON.stringify(data));
test('Book search sends only explicit query, returns work identity/author and ignores remote markup/images', async () => {
  let request;
  const m = fresh(), result = await m.search('books', '느린 관찰', { fetcher: async (...args) => {
    request = args; return response({ docs: [{ key: '/works/OL123W', title: '<b>느린 관찰</b>', author_name: ['익명 저자'], first_publish_year: 2021, cover_i: 123, html: '<script>' }, {key: 'https://evil.test', title:'bad'}] });
  }});
  const u = new URL(request[0]); assert.equal(u.origin,'https://openlibrary.org'); assert.equal(u.searchParams.get('q'),'느린 관찰'); assert.equal(u.searchParams.get('limit'),'6');
  assert.equal(request[1].credentials,'omit'); assert.equal(request[1].referrerPolicy,'no-referrer'); assert.equal(request[1].redirect,'error');
  assert.equal(result.results.length,1); const book = result.results[0]; assert.equal(book.url,'https://openlibrary.org/works/OL123W'); assert.equal(book.creator,'익명 저자'); assert.match(book.detail,/판본 미지정/); assert(!('cover_i' in book)); assert.equal(book.title,'<b>느린 관찰</b>');
});
test('Repository search excludes private/bad URLs and never assigns owner as author', async () => {
  const result = await fresh().search('projects', 'idb', { fetcher: async () => response({incomplete_results:true,items:[
    { private:false, name:'idb', full_name:'jakearchibald/idb', owner:{login:'jakearchibald'}, description:'IndexedDB helper' },
    { private:true, name:'secret',full_name:'a/secret' }, { private:false,name:'bad',full_name:'a/repo/issues' }
  ]}) });
  assert.equal(result.results.length,1); assert(result.incomplete); assert.equal(result.results[0].creator,''); assert.equal(result.results[0].attributionLabel,'저장소 소유자');
});
test('Search enforces field/response bounds, errors, initial cancellation and provider interval without retry loops', async () => {
  let calls = 0; const fetcher = async () => { calls++; return response({docs:[]}); }, m=fresh();
  for(const [p,q] of [['other','hello'],['books','x'],['books','a'.repeat(161)],['books','a\nb']]) await assert.rejects(m.search(p,q,{fetcher}));
  const controller=new AbortController(); controller.abort(); await assert.rejects(m.search('books','query',{fetcher,signal:controller.signal}),{name:'AbortError'}); assert.equal(calls,0);
  await m.search('books','query',{fetcher}); await assert.rejects(m.search('books','another',{fetcher}),/간격/); assert.equal(calls,1);
  for(const status of [403,429,500]) await assert.rejects(fresh().search('projects','tool',{fetcher:async()=>new Response('',{status})}));
  await assert.rejects(fresh().search('books','title',{fetcher:async()=>new Response('x'.repeat(65537))}),/너무 큽니다/);
  await assert.rejects(fresh().search('books','title',{fetcher:async()=>response({docs:{}})}),/형식/);
  const result=await fresh().search('books','title',{fetcher:async()=>response({docs:[{key:'/works/OL1W',title:'good',author_name:['a\u0000']},{key:'/works/OL2W',title:'valid'}]})}); assert.equal(result.results.length,1);
});
test('Timeout and cancellation during search reject without candidates', async () => {
  const hanging=async(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
  await assert.rejects(fresh().search('books','title',{fetcher:hanging,timeout:5}),/초과/);
  const controller=new AbortController(),pending=fresh().search('projects','tool',{fetcher:hanging,signal:controller.signal});controller.abort();await assert.rejects(pending,{name:'AbortError'});
});

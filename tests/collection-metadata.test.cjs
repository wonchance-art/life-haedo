'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const M = require('../assets/life/collection-metadata.js');
const github = 'https://github.com/jakearchibald/idb?token=never-send#readme';
const response = data => new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
test('Only known public resource addresses yield fixed provider endpoints, without tracking or credentials', () => {
  assert.equal(M.identify(github).endpoint,'https://api.github.com/repos/jakearchibald/idb');
  for(const url of ['https://youtu.be/jNQXAC9IVRw?si=secret','https://m.youtube.com/watch?v=jNQXAC9IVRw&list=private','https://www.youtube.com/shorts/jNQXAC9IVRw']) assert.equal(M.identify(url).url,'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  for(const url of ['http://github.com/a/b','https://github.com.evil.test/a/b','https://u:p@github.com/a/b','https://github.com/a/b/issues','https://youtube.com/playlist?list=x','https://127.0.0.1/a','https://github.com/a/b\\x','https://github.com:123/a/b']) assert.throws(()=>M.identify(url));
});
test('Lookup omits credentials/referrer and returns only plain candidate fields, never remote HTML/images or creator guesses', async () => {
  let request;
  const result=await M.lookup(github,{fetcher:async(...args)=>{request=args;return response({private:false,name:'idb',owner:{login:'jakearchibald'},description:'not my note',html:'<script>',avatar_url:'https://evil.test'});}});
  assert.equal(request[1].credentials,'omit');assert.equal(request[1].referrerPolicy,'no-referrer');assert.equal(request[1].redirect,'error');
  assert.deepEqual(Object.keys(result).sort(),['attribution','attributionLabel','provider','title','type','url']);
  assert.equal(result.attributionLabel,'저장소 소유자');assert.equal(result.title,'idb');
  const video=await M.lookup('https://youtu.be/jNQXAC9IVRw',{fetcher:async()=>response({title:'<b>한글 영상</b>',author_name:'게시자',html:'<iframe src="evil">'})});
  assert.equal(video.title,'<b>한글 영상</b>');assert.equal(video.attributionLabel,'게시 채널');
});
test('Rate limit, unavailable/private repository and malformed or oversized payloads remain recoverable',async()=>{
  for(const status of [401,403,404,429,500]) await assert.rejects(M.lookup(github,{fetcher:async()=>new Response('',{status})}));
  for(const data of [{private:true,name:'x'}, {private:false,name:''},{private:false,name:'x'.repeat(501)}, {private:false,name:'x',owner:{login:'\u0000'}},null]) await assert.rejects(M.lookup(github,{fetcher:async()=>response(data)}));
  await assert.rejects(M.lookup(github,{fetcher:async()=>new Response('x'.repeat(65537))}),/너무 큽니다/);
});
test('Timeout and caller cancellation stop requests; unsupported URLs never fetch',async()=>{
  const hanging=async(_,options)=>new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));});
  await assert.rejects(M.lookup(github,{fetcher:hanging,timeout:5}),/초과/);
  const controller=new AbortController();const pending=M.lookup(github,{fetcher:hanging,signal:controller.signal});controller.abort();await assert.rejects(pending,{name:'AbortError'});
  let calls=0;await assert.rejects(M.lookup('https://unknown.test',{fetcher:()=>{calls++;}}));assert.equal(calls,0);
});

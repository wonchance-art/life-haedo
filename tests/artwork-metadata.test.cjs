'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fresh=()=>{delete require.cache[require.resolve('../assets/life/collection-metadata.js')];return require('../assets/life/collection-metadata.js');};
const response=data=>new Response(JSON.stringify(data));
const source='https://www.artic.edu/artworks/27992/a-sunday-on-la-grande-jatte-1884';
const work={id:27992,title:'A Sunday on La Grande Jatte — 1884',artist_title:'Georges Seurat',artist_display:'Attributed to Georges Seurat\n(French, 1859–1891)',date_display:'1884–86',medium_display:'Oil on canvas',description:'<script>not requested</script>',image_id:'do-not-load',is_public_domain:true};
test('Artwork link lookup fixes the endpoint/identity and keeps attribution qualifiers without images or descriptions',async()=>{
 let request;const result=await fresh().lookup(source,{fetcher:async(...args)=>{request=args;return response({data:work});}});
 const u=new URL(request[0]);assert.equal(u.origin,'https://api.artic.edu');assert.equal(u.pathname,'/api/v1/artworks/27992');assert(!u.searchParams.get('fields').includes('image'));assert(!u.searchParams.get('fields').includes('description'));
 assert.equal(request[1].credentials,'omit');assert.equal(request[1].referrerPolicy,'no-referrer');assert.equal(request[1].redirect,'error');
 assert.equal(result.url,'https://www.artic.edu/artworks/27992');assert.match(result.creator,/^Attributed to Georges Seurat · /);assert.match(result.detail,/1884–86/);assert(!('image_id' in result));assert(!('description' in result));assert(!('is_public_domain' in result));
});
test('Wrong artwork identity, missing title and invalid display cannot become selected metadata',async()=>{
 for(const row of [{...work,id:12},{...work,id:'27992'},{...work,title:''},{...work,artist_display:'bad\u0000name'},{...work,artist_display:'x'.repeat(501)},null])await assert.rejects(fresh().lookup(source,{fetcher:async()=>response({data:row})}));
 for(const u of ['https://www.artic.edu.evil.test/artworks/27992','https://user:pass@www.artic.edu/artworks/27992','https://www.artic.edu/artworks/27992?token=private','https://www.artic.edu/artworks/27992#private'])await assert.rejects(fresh().lookup(u,{fetcher:()=>assert.fail('Unsupported address must never fetch')}));
});
test('Artwork search sends the literal title/artist query, six bounded plain candidates and fixed source URLs',async()=>{
 let request;const result=await fresh().search('artworks','La Grande Jatte Seurat',{page:2,fetcher:async(...args)=>{request=args;return response({pagination:{total:14},data:[work,{...work,id:33,title:'<img src=x onerror=alert(1)>'},{...work,id:'44'},{...work,id:33},{...work,id:-2},{...work,title:'bad\u0000'}]});}});
 const u=new URL(request[0]),p=JSON.parse(u.searchParams.get('params'));assert.equal(u.origin,'https://api.artic.edu');assert.equal(p.query.multi_match.query,'La Grande Jatte Seurat');assert.equal(p.query.multi_match.type,'cross_fields');assert.equal(p.query.multi_match.operator,'and');assert.equal(p.limit,6);assert.equal(p.page,2);assert.equal(result.hasMore,true);assert.equal(result.results.length,2);assert.equal(result.results[1].title,'<img src=x onerror=alert(1)>');
 for(const item of result.results)assert.match(item.url,/^https:\/\/www\.artic\.edu\/artworks\/[0-9]+$/);
});
test('Korean empty results remain empty; malformed response/pagination never invents further candidates',async()=>{
 assert.deepEqual((await fresh().search('artworks','모네',{fetcher:async()=>response({data:[],pagination:{total:0}})})).results,[]);
 await assert.rejects(fresh().search('artworks','Monet',{fetcher:async()=>response({data:{}})}),/형식/);
 for(const page of [0,101,1.5,'2'])await assert.rejects(fresh().search('artworks','Monet',{page,fetcher:()=>assert.fail('Invalid page must not fetch')}));
 const last=await fresh().search('artworks','Monet',{page:100,fetcher:async()=>response({data:[work],pagination:{total:10000}})});assert.equal(last.hasMore,false);
});
test('Artwork search and lookup share pacing and can cancel a waiting request before transmission',async()=>{
 const m=fresh(),controller=new AbortController();let calls=0;
 await m.search('artworks','Monet',{fetcher:async()=>{calls++;return response({data:[]});}});
 const waiting=m.lookup(source,{signal:controller.signal,fetcher:()=>assert.fail('Cancelled follow-up must not fetch')});controller.abort();await assert.rejects(waiting,{name:'AbortError'});assert.equal(calls,1);
 for(const status of [404,429,500])await assert.rejects(fresh().lookup(source,{fetcher:async()=>new Response('',{status})}));
 await assert.rejects(fresh().lookup(source,{fetcher:async()=>new Response('x'.repeat(65537))}),/너무 큽니다/);
 await assert.rejects(fresh().search('artworks','Monet',{timeout:5,fetcher:(_u,{signal})=>new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))}),/초과/);
});

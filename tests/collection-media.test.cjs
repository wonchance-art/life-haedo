'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../assets/life/collection-media.js'),C=require('../assets/life/collection.js'),Metadata=require('../assets/life/collection-metadata.js');
test('Book covers require a valid ISBN or a bounded edition ID and remove URL tracking',()=>{
 assert.equal(M.isbn('978-0-14-032872-1'),'9780140328721');assert.equal(M.isbn('0-8044-2957-x'),'080442957X');
 for(const value of ['9780140328722','0000000000000','01234','9780140328721/x'])assert.equal(M.isbn(value),null);
 assert.deepEqual(M.describe({type:'book',url:'https://openlibrary.org/isbn/978-0-14-032872-1?key=private#x'}),{provider:'Open Library',label:'표지',source:'https://openlibrary.org/isbn/9780140328721',image:'https://covers.openlibrary.org/b/isbn/9780140328721-M.jpg?default=false'});
 assert.equal(M.describe({type:'book',url:'https://openlibrary.org/books/OL7353617M/Matilda'}).image,'https://covers.openlibrary.org/b/olid/OL7353617M-M.jpg?default=false');
 for(const url of ['https://openlibrary.org.evil.test/isbn/9780140328721','https://me:secret@openlibrary.org/isbn/9780140328721','https://openlibrary.org/isbn/9780140328722','https://openlibrary.org/works/OL123W','http://openlibrary.org/books/OL123M','https://openlibrary.org:4433/books/OL123M'])assert.equal(M.describe({type:'book',url}),null);
});
test('Video thumbnails are tied to the exact video and are never treated as album art or an app logo',()=>{
 const source='https://youtu.be/jNQXAC9IVRw?si=private',image='https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg';
 assert.equal(M.describe({type:'video',url:source}).source,'https://www.youtube.com/watch?v=jNQXAC9IVRw');
 for(const type of ['music','tool','person','film','artwork'])assert.equal(M.describe({type,url:source}),null);
 assert.equal(M.thumbnail(image,'jNQXAC9IVRw'),image);
 for(const value of [image+'?token=x',image.replace('i.ytimg.com','evil.test'),image.replace('jNQXAC9IVRw','aaaaaaaaaaa'),'data:image/png,xxx','https://i.ytimg.com/vi/jNQXAC9IVRw/../../evil.svg'])assert.equal(M.thumbnail(value,'jNQXAC9IVRw'),null);
});
test('Metadata exposes only a same-video thumbnail; source lookup does not fetch the image',async()=>{
 let calls=0;
 for(const [thumbnail_url,valid] of [['https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg',true],['https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg',false],['https://evil.test/x',false]]){
 const result=await Metadata.lookup('https://youtu.be/jNQXAC9IVRw',{fetcher:async()=>{calls++;return new Response(JSON.stringify({title:'영상',author_name:'게시 채널',thumbnail_url}));}});assert.equal(Object.hasOwn(result,'thumbnail'),valid);
 }assert.equal(calls,3);
});
test('Source-derived covers preserve exact v1 collection and backup data without an image schema',()=>{
 const item={id:'book',type:'book',title:'익명 한글 책',creator:'내가 확인한 저자',url:M.bookSource('9780140328721'),note:'내 생각',tags:[],details:{year:'2020년경'},archived:false,createdAt:'2026-10-13T00:00:00.000Z',updatedAt:'2026-10-13T00:00:00.000Z'};
 const state={...C.empty('workspace'),items:[item]},before=JSON.stringify(state),backup=C.makeBackup(state);
 assert(M.describe(item));assert.equal(JSON.stringify(state),before);assert.equal(backup.format,'life-collection-backup-v1');const restored=C.appendBackup(C.empty('other'),backup,()=> 'copy');assert.deepEqual(M.describe(restored.items[0]),M.describe(item));assert.equal(restored.items[0].note,item.note);assert.deepEqual(Object.keys(backup).sort(),['exportedAt','format','items']);
});

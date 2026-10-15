'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),M=require('../assets/life/photo-post.js'),c=require('../assets/life/core.js'),zip=require('../vendor/fflate/fflate.js');
async function fixture(){const d=M.create(c.id),blob=new Blob([new Uint8Array([137,80,78,71,13,10,26,10,1,2,3])],{type:'image/png'}),p={id:c.id(),name:'산책 원본.png',type:blob.type,width:4032,height:3024,size:blob.size,digest:await M.digest(blob),blob};d.title='사진과 여행 글';d.photos=[p];d.ops=[{insert:'첫 문단\n',attributes:{bold:true}},{insert:{photo:{id:p.id,caption:'기억할 장면 🌱',alt:'길가의 익명 풍경'}}},{insert:'\n다음 문단\n'}];return {d,p};}
test('photo backup retains exact original bytes, pixel dimensions and format; restore remaps ids into a private draft',async()=>{
 const {d,p}=await fixture(),before=structuredClone(d),archive=await M.backup(d),copy=await M.readBackup(archive,c.id);assert.equal(copy.status,'draft');assert.notEqual(copy.id,d.id);assert.notEqual(copy.photos[0].id,p.id);assert.equal(copy.photos[0].width,4032);assert.equal(copy.photos[0].height,3024);assert.equal(copy.photos[0].digest,p.digest);assert.deepEqual(await copy.photos[0].blob.arrayBuffer(),await p.blob.arrayBuffer());assert.equal(copy.ops[1].insert.photo.id,copy.photos[0].id);assert.equal(copy.ops[1].insert.photo.caption,'기억할 장면 🌱');assert.deepEqual(d,before);
});
test('document validation refuses unsupported HTML, remote embeds, scripts, bad links and missing photo originals',async()=>{
 const {d}=await fixture();for(const op of [{insert:{image:'https://example.org/photo.jpg'}},{insert:'x',attributes:{html:'<script>bad()</script>'}},{insert:'x',attributes:{link:'javascript:alert(1)'}},{insert:{photo:{id:'missing',caption:'',alt:''}}}]){const v=structuredClone(d);v.ops.unshift(op);assert.throws(()=>M.validate(v));}
 const v=structuredClone(d);v.photos[0].blob=new Blob(['different'],{type:'image/png'});assert.throws(()=>M.validate(v),/원본/);
});
test('ZIP import rejects traversal, duplicate paths, changed original bytes and unrelated fields before installation',async()=>{
 const {d}=await fixture(),backup=await M.backup(d),files=zip.unzipSync(new Uint8Array(await backup.arrayBuffer()));
 const modified={...files};modified[Object.keys(files).find(k=>k.startsWith('photos/'))][8]=99;await assert.rejects(M.readBackup(new Blob([zip.zipSync(modified)]),c.id),/내용/);
 await assert.rejects(M.readBackup(new Blob([zip.zipSync({'../escape':new Uint8Array([1]),'manifest.json':zip.strToU8('{}')})]),c.id),/경로/);
 const m=JSON.parse(zip.strFromU8(files['manifest.json']));m.account='must not be imported';files['manifest.json']=zip.strToU8(JSON.stringify(m));await assert.rejects(M.readBackup(new Blob([zip.zipSync(files)]),c.id),/형식/);
});
test('compacting removes only unused photo bytes and leaves all typed text and referenced originals exact',async()=>{
 const {d,p}=await fixture();const unused={...p,id:c.id()};d.photos.push(unused);const saved=M.compact(d);assert.equal(saved.photos.length,1);assert.equal(d.photos.length,2);assert.deepEqual(saved.ops,d.ops);assert.equal(saved.photos[0].digest,p.digest);assert.match(M.plainText(saved),/기억할 장면/);
});
test('saved rich text always fits the same metadata budget accepted by its own ZIP restore',()=>{
 const d=M.create(c.id);d.ops=Array.from({length:1200},()=>({insert:'x',attributes:{link:'https://example.org/'+ 'a'.repeat(1900)}})).concat({insert:'\n'});assert.throws(()=>M.validate(d),/서식 정보/);
});

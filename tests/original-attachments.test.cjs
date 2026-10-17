'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, sha } = require('./fixtures/original-attachments.cjs');
const api = require('../assets/life/original-attachments.js');
const blob = buffer => new Blob([buffer], {type:'application/zip'});
test('stored part preserves exact bytes, Korean paths, roles and note versions', async () => {
  const f = fixture(), progress = [], part = await api.readPart(blob(f.zip), {onProgress:p=>progress.push(p.verified)});
  assert.equal(part.entries.length,5); assert.deepEqual(progress,[1,2,3,4,5]);
  assert.equal(sha(Buffer.from(await part.archive.arrayBuffer())),sha(f.zip));
  for(const e of part.entries) assert.equal(sha(Buffer.from(await part.archive.slice(e.offset,e.offset+e.bytes).arrayBuffer())),e.sha256);
});
test('receipt hash, size, role, MIME, Git version and extra members fail closed', async () => {
  for(const change of [r=>r.entries[0].sha256='0'.repeat(64),r=>r.entries[0].bytes++,r=>r.entries[0].role='unknown',r=>r.entries[0].mime='text/html',r=>r.entries[1].sourceGitCommit='b'.repeat(40),r=>r.entries[0].sourceGitCommit={unsafe:true},(r,f)=>f['extra.html']=Buffer.from('<script/>')]) await assert.rejects(api.readPart(blob(fixture(change).zip)));
});
test('zip-slip, HTML-like paths, duplicate receipts, compressed bombs and damaged payload are rejected', async () => {
  for(const name of ['../escape.png','/absolute.png','C:/file.png','photos/<script>.png','photos/./file.png','photos\\file.png']) await assert.rejects(api.readPart(blob(fixture(r=>{r.entries[0].sourceRelativePath=name;}).zip)));
  await assert.rejects(api.readPart(blob(fixture(()=>{},{level:9}).zip)));
  const f=fixture(), corrupted=Buffer.from(f.zip); corrupted[corrupted.indexOf(f.files[f.receipt.entries[0].snapshotPath])]^=1;
  await assert.rejects(api.readPart(blob(corrupted)), /바이트/);
  const duplicate=Buffer.from(f.zip), central=[]; for(let i=0;i<duplicate.length-4;i++) if(duplicate.readUInt32LE(i)===0x02014b50) central.push(i);
  const symlink=Buffer.from(f.zip);symlink.writeUInt32LE(0xa0000000,central[0]+38);await assert.rejects(api.readPart(blob(symlink)));
  duplicate.writeUInt32LE(duplicate.readUInt32LE(central[0]+42),central[1]+42);
  await assert.rejects(api.readPart(blob(duplicate)));
});
test('cancellation and limits leave no candidate', async()=>{
  const c=new AbortController();c.abort(); await assert.rejects(api.readPart(blob(fixture().zip),{signal:c.signal}),{code:'originals_cancelled'});
  const oversized=blob([]);Object.defineProperty(oversized,'size',{value:api.LIMITS.part+1});await assert.rejects(api.readPart(oversized));
  const f=fixture(r=>r.entries[0].bytes=api.LIMITS.file+1); await assert.rejects(api.readPart(blob(f.zip)));
});

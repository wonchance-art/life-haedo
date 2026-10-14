'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../assets/life/collection-metadata.js');
test('Museum reference identifies a source hint without fetching or inventing artwork metadata',()=>{
 for(const url of ['https://www.artic.edu/artworks/129884/starry-night-and-the-astronauts','https://www.artic.edu/artworks/27992/']){
  assert.deepEqual(M.reference(url),{provider:'시카고 미술관',type:'artwork',url});
  assert.equal(M.reference(url).title,undefined);
 }
});
test('Museum reference rejects lookalikes, credentials, redirects and non-artwork URLs',()=>{
 for(const url of ['',null,{},'http://www.artic.edu/artworks/12','https://www.artic.edu.evil.test/artworks/12','https://www.artic.edu@evil.test/artworks/12','https://person@www.artic.edu/artworks/12','https://www.artic.edu:444/artworks/12','https://www.artic.edu/artworks/0','https://www.artic.edu/artworks/-2','https://www.artic.edu/artworks/12?next=https://evil.test','https://www.artic.edu/artworks/12#fragment','https://www.artic.edu/artworks/12/../terms','https://www.artic.edu/artworks/12/image.jpg','https://www.artic.edu/terms','https://www.artic.edu/artworks/12\\x'])assert.equal(M.reference(url),null,String(url));
});

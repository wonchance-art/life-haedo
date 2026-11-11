'use strict';
// Public copy allow list, ICC part (2026-11-11 review m9). An APP2 ICC_PROFILE continuation
// segment (sequence 2 or later) passed without any check and could carry arbitrary text into
// a public copy. The ICC segments of a file must now be numbered 1..count in file order with
// one shared count, start with a profile header, and together hold exactly the size that
// header declares. The client filter (PhotoPost.publicBytes/metadataFree) and the media
// handler (supabase/functions/haedo-blog-media) apply the same rule.
// What this rule does not do (2026-11-11 review m4, left as it is): the allow list checks
// structure, not content. Bytes inside the declared size of a profile (for example its
// description text), extra DQT/DHT tables, DRI, an unused SOF and text inside a second scan
// are not inspected. A copy is always a new canvas encoding of the pixels, so such bytes
// could only come from the encoder itself; the cases below cover what the review found
// passing unchecked, not every place a JPEG can carry bytes.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { stripTypeScriptTypes } = require('node:module');
const edge = import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '../supabase/functions/haedo-blog-media/index.ts'), 'utf8'))).toString('base64'));
const F = require('./fixtures/photo-metadata.cjs');
globalThis.HaedoLife ||= {};
const Photo = require('../assets/life/photo-post.js');

const SECRET = 'SECRET-GPS-37.5665,126.9780-in-icc';
const segment = (marker, payload) => { const head = Buffer.alloc(4); head[0] = 0xff; head[1] = marker; head.writeUInt16BE(payload.length + 2, 2); return Buffer.concat([head, payload]); };
// A structurally valid profile of `size` bytes: its declared size and the "acsp" signature.
function profile(size, fill = 0x41) {
  const bytes = Buffer.alloc(size, fill); bytes.writeUInt32BE(size, 0); bytes.write('acsp', 36, 'latin1'); return bytes;
}
const chunk = (sequence, count, data) => segment(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([sequence, count]), data]));
// The fixture JPEG carries its encoder's own ICC profile (one whole chunk, kept by the rule).
// `clean` is the same image without any APP2 segment, so each case holds only its own chunks.
const encoded = Buffer.from(Photo.publicBytes('image/jpeg', F.JPEG_8X8));
function withoutApp2(bytes) {
  const kept = [bytes.subarray(0, 2)]; let at = 2;
  while (bytes[at] === 0xff && bytes[at + 1] !== 0xda) {
    const end = at + 2 + bytes.readUInt16BE(at + 2);
    if (bytes[at + 1] !== 0xe2) kept.push(bytes.subarray(at, end));
    at = end;
  }
  return Buffer.concat([...kept, bytes.subarray(at)]);
}
const clean = withoutApp2(encoded);
const withSegments = (...segments) => Buffer.concat([clean.subarray(0, 2), ...segments, clean.subarray(2)]);
const whole = profile(200), halves = [whole.subarray(0, 150), whole.subarray(150)];

const accepted = {
  'one whole profile': withSegments(chunk(1, 1, whole)),
  'one profile in two numbered chunks': withSegments(chunk(1, 2, halves[0]), chunk(2, 2, halves[1])),
  'no profile': clean,
  'the encoder\'s own profile of the fixture': encoded,
};
const refused = {
  'a continuation chunk alone carrying text': withSegments(chunk(2, 2, Buffer.from(SECRET))),
  'a continuation chunk added to an encoder\'s whole profile': Buffer.concat([encoded.subarray(0, 2), chunk(2, 2, Buffer.from(SECRET)), encoded.subarray(2)]),
  'a whole profile followed by a chunk beyond its declared size': withSegments(chunk(1, 2, whole), chunk(2, 2, Buffer.from(SECRET))),
  'text after the declared size inside one chunk': withSegments(chunk(1, 1, Buffer.concat([whole, Buffer.from(SECRET)]))),
  'a declared size larger than the chunks hold': withSegments(chunk(1, 1, Buffer.concat([profile(200).subarray(0, 160)]))),
  'chunks out of order': withSegments(chunk(2, 2, halves[1]), chunk(1, 2, halves[0])),
  'a repeated sequence number': withSegments(chunk(1, 2, halves[0]), chunk(1, 2, halves[1])),
  'a count that names more chunks than the file has': withSegments(chunk(1, 3, halves[0]), chunk(2, 3, halves[1])),
  'a count that names fewer chunks than the file has': withSegments(chunk(1, 1, halves[0]), chunk(2, 1, halves[1])),
  'chunks that disagree on the count': withSegments(chunk(1, 2, halves[0]), chunk(2, 3, halves[1])),
  'sequence zero': withSegments(chunk(0, 1, whole)),
  'a first chunk shorter than a profile header': withSegments(chunk(1, 1, (() => { const b = profile(100); return b; })())),
  'a first chunk without the profile signature': withSegments(chunk(1, 1, (() => { const b = profile(200); b.write('xxxx', 36, 'latin1'); return b; })())),
};

test('whole, exactly sized ICC profiles stay; the client and the media handler agree', async () => {
  const E = await edge;
  for (const [name, bytes] of Object.entries(accepted)) {
    assert.equal(Photo.metadataFree('image/jpeg', bytes), true, 'client: ' + name);
    assert.equal(E.metadataFree('image/jpeg', new Uint8Array(bytes)), true, 'Edge: ' + name);
    assert.deepEqual(Buffer.from(Photo.publicBytes('image/jpeg', bytes)), bytes, name + ' is unchanged');
  }
});

test('an ICC segment set that is not one whole profile is refused by both and removed entirely by the client filter', async () => {
  const E = await edge;
  for (const [name, bytes] of Object.entries(refused)) {
    assert.equal(Photo.metadataFree('image/jpeg', bytes), false, 'client: ' + name);
    assert.equal(E.metadataFree('image/jpeg', new Uint8Array(bytes)), false, 'Edge: ' + name);
    const filtered = Buffer.from(Photo.publicBytes('image/jpeg', bytes));
    assert.deepEqual(filtered, clean, name + ': every ICC segment is removed, the image stays');
    assert.equal(filtered.includes(Buffer.from(SECRET)), false, name + ': no text survives');
    assert.equal(E.metadataFree('image/jpeg', new Uint8Array(filtered)), true, 'filtered ' + name + ' passes the media handler');
  }
});

test('the earlier corpus keeps its verdicts under the ICC rule', async () => {
  const E = await edge;
  for (const item of F.corpus()) {
    assert.equal(Photo.metadataFree(item.type, item.bytes), item.clean, 'client: ' + item.name);
    assert.equal(E.metadataFree(item.type, item.bytes), item.clean, 'Edge: ' + item.name);
  }
});

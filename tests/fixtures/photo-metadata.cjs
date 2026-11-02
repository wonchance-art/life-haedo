'use strict';
/* Synthetic photo metadata fixtures. No real photo, place or device: the
 * coordinates, maker and timestamp below are invented markers. Each helper
 * adds EXIF (with a GPS IFD) and XMP the way cameras and editors store them,
 * so a test can prove that published bytes carry none of it. */
const zlib = require('node:zlib');

// Invented values. Their presence anywhere in published bytes is a leak.
const MARKERS = Object.freeze({
  maker: 'HaedoSyntheticCam',
  time: '2026:11:02 09:12:00',
  xmp: 'haedo-synthetic-gps-37.5512N-126.9882E',
});
const LEAK_PATTERNS = [Buffer.from('Exif\0\0', 'latin1'), Buffer.from('http://ns.adobe.com/xap/1.0/', 'latin1'), Buffer.from('GPS', 'latin1'),
  Buffer.from(MARKERS.maker, 'latin1'), Buffer.from(MARKERS.time, 'latin1'), Buffer.from(MARKERS.xmp, 'latin1'), Buffer.from('eXIf', 'latin1'), Buffer.from('iTXt', 'latin1')];
// Byte patterns of the invented EXIF/GPS/XMP. Returns the names found.
function leaks(bytes) {
  const b = Buffer.from(bytes);
  return LEAK_PATTERNS.filter(pattern => b.indexOf(pattern) >= 0).map(pattern => pattern.toString('latin1').replace(/\0/g, '\\0'));
}

// Little-endian TIFF/EXIF block: IFD0 (Orientation, Make, DateTime, GPS IFD
// pointer) and a GPS IFD with latitude/longitude rationals.
function exif({ orientation = 1 } = {}) {
  const entries0 = [], gps = [], extra = [];
  const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }, u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const ascii = text => Buffer.from(text + '\0', 'latin1');
  const rationals = values => Buffer.concat(values.flatMap(([n, d]) => [u32(n), u32(d)]));
  // Layout: header(8) | IFD0 | GPS IFD | data
  const ifd0Count = 4, gpsCount = 4;
  const ifd0Offset = 8, ifd0Size = 2 + ifd0Count * 12 + 4, gpsOffset = ifd0Offset + ifd0Size, gpsSize = 2 + gpsCount * 12 + 4;
  let dataOffset = gpsOffset + gpsSize;
  const data = value => { const at = dataOffset; extra.push(value); dataOffset += value.length + (value.length & 1); if (value.length & 1) extra.push(Buffer.from([0])); return at; };
  const entry = (list, tag, type, count, value) => list.push(Buffer.concat([u16(tag), u16(type), u32(count), value.length <= 4 ? Buffer.concat([value, Buffer.alloc(4 - value.length)]) : u32(data(value))]));
  entry(entries0, 0x010f, 2, MARKERS.maker.length + 1, ascii(MARKERS.maker));
  entry(entries0, 0x0112, 3, 1, u16(orientation));
  entry(entries0, 0x0132, 2, MARKERS.time.length + 1, ascii(MARKERS.time));
  entry(entries0, 0x8825, 4, 1, u32(gpsOffset));
  entry(gps, 0x0001, 2, 2, ascii('N'));
  entry(gps, 0x0002, 5, 3, rationals([[37, 1], [33, 1], [442, 100]]));
  entry(gps, 0x0003, 2, 2, ascii('E'));
  entry(gps, 0x0004, 5, 3, rationals([[126, 1], [58, 1], [1752, 100]]));
  const ifd = (list) => Buffer.concat([u16(list.length), ...list, u32(0)]);
  const tiff = Buffer.concat([Buffer.from('II*\0', 'latin1'), u32(ifd0Offset), ifd(entries0), ifd(gps), ...extra]);
  return tiff;
}
const xmpPacket = () => Buffer.from('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
  + '<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="37,33.0737N" exif:GPSLongitude="126,58.292E" exif:UserComment="' + MARKERS.xmp + '"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>', 'utf8');

// JPEG: APP1 Exif and APP1 XMP right after SOI (where cameras put them).
function jpegWithGps(jpeg, options) {
  const b = Buffer.from(jpeg); if (b[0] !== 0xff || b[1] !== 0xd8) throw Error('not a JPEG');
  const segment = (marker, payload) => { const head = Buffer.from([0xff, marker, 0, 0]); head.writeUInt16BE(payload.length + 2, 2); return Buffer.concat([head, payload]); };
  const exifSegment = segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exif(options)]));
  const xmpSegment = segment(0xe1, Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), xmpPacket()]));
  return Buffer.concat([b.subarray(0, 2), exifSegment, xmpSegment, b.subarray(2)]);
}
function crc32(bytes) {
  let c, crc = 0xffffffff;
  for (const byte of bytes) { c = (crc ^ byte) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(name, data) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(name, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(name, 'latin1'), data])));
  return Buffer.concat([head, data, crc]);
}
// PNG: eXIf (EXIF with GPS) after IHDR and iTXt XMP before IEND.
function pngWithGps(png, options) {
  const b = Buffer.from(png); if (b.toString('latin1', 1, 4) !== 'PNG') throw Error('not a PNG');
  const ihdrEnd = 8 + 12 + b.readUInt32BE(8), iend = b.length - 12;
  const itxt = Buffer.concat([Buffer.from('XML:com.adobe.xmp\0\0\0\0\0', 'latin1'), xmpPacket()]);
  return Buffer.concat([b.subarray(0, ihdrEnd), pngChunk('eXIf', exif(options)), b.subarray(ihdrEnd, iend), pngChunk('iTXt', itxt), b.subarray(iend)]);
}
// Small RGBA PNG made in Node (no canvas), for server-side tests.
function png(width = 4, height = 3, rgba = [64, 112, 96, 255]) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) Buffer.from(rgba).copy(raw, y * (width * 4 + 1) + 1 + x * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}
// Two-frame animated PNG (acTL/fcTL/fdAT) made in Node.
function apng(width = 4, height = 3) {
  const frame = rgba => { const raw = Buffer.alloc((width * 4 + 1) * height); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) Buffer.from(rgba).copy(raw, y * (width * 4 + 1) + 1 + x * 4); return zlib.deflateSync(raw); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(2); actl.writeUInt32BE(0, 4);
  const fctl = sequence => { const b = Buffer.alloc(26); b.writeUInt32BE(sequence); b.writeUInt32BE(width, 4); b.writeUInt32BE(height, 8); b.writeUInt16BE(1, 20); b.writeUInt16BE(2, 22); return b; };
  const second = frame([200, 40, 40, 255]), fdat = Buffer.concat([Buffer.from([0, 0, 0, 2]), second]);
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), pngChunk('IHDR', ihdr), pngChunk('acTL', actl), pngChunk('fcTL', fctl(0)),
    pngChunk('IDAT', frame([40, 120, 200, 255])), pngChunk('fcTL', fctl(1)), pngChunk('fdAT', fdat), pngChunk('IEND', Buffer.alloc(0))]);
}
// Two-frame animated WebP: each ANMF frame wraps the image chunk of a still WebP.
function animatedWebp(still, width, height) {
  const b = Buffer.from(still); let at = 12, image = null;
  while (at + 8 <= b.length) { const name = b.toString('latin1', at, at + 4), length = b.readUInt32LE(at + 4); if (name === 'VP8 ' || name === 'VP8L') image = b.subarray(at, at + 8 + length + (length & 1)); at += 8 + length + (length & 1); }
  const anmf = () => { const head = Buffer.alloc(16); head.writeUIntLE(width - 1, 6, 3); head.writeUIntLE(height - 1, 9, 3); head.writeUIntLE(100, 12, 3); return Buffer.concat([head, image]); };
  const vp8x = Buffer.alloc(10); vp8x[0] = 0x02; vp8x.writeUIntLE(width - 1, 4, 3); vp8x.writeUIntLE(height - 1, 7, 3);
  return riff([['VP8X', vp8x], ['ANIM', Buffer.alloc(6)], ['ANMF', anmf()], ['ANMF', anmf()]]);
}
function riff(chunks) {
  const body = Buffer.concat(chunks.map(([name, data]) => { const head = Buffer.alloc(8); head.write(name, 0, 'latin1'); head.writeUInt32LE(data.length, 4); return Buffer.concat([head, data, data.length & 1 ? Buffer.from([0]) : Buffer.alloc(0)]); }));
  const head = Buffer.alloc(12); head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(body.length + 4, 4); head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}
// WebP: a simple-format file becomes extended (VP8X with EXIF and XMP flags)
// with EXIF and XMP chunks after the image data, as the container specifies.
function webpWithGps(webp, { width, height, options } = {}) {
  const b = Buffer.from(webp); if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') throw Error('not a WebP');
  const chunks = []; let at = 12, flags = 0x08 | 0x04;
  while (at + 8 <= b.length) { const name = b.toString('latin1', at, at + 4), length = b.readUInt32LE(at + 4); chunks.push([name, b.subarray(at + 8, at + 8 + length)]); at += 8 + length + (length & 1); }
  if (chunks[0][0] === 'VP8X') { flags |= chunks[0][1][0]; chunks.shift(); }
  if (chunks.some(([name]) => name === 'ALPH') || chunks[0][0] === 'VP8L' && (chunks[0][1][4] >> 4) & 1) flags |= 0x10;
  const vp8x = Buffer.alloc(10); vp8x[0] = flags; vp8x.writeUIntLE(width - 1, 4, 3); vp8x.writeUIntLE(height - 1, 7, 3);
  return riff([['VP8X', vp8x], ...chunks, ['EXIF', exif(options)], ['XMP ', xmpPacket()]]);
}
// HEIC: an ISO-BMFF file whose ftyp is a HEVC brand and whose body holds an
// Exif item with GPS and an XMP packet. Not decodable (no image data); tests
// stub decoding and exercise the real JPEG view and publication paths.
function heicWithGps(seed = 1) {
  const box = (type, payload) => { const head = Buffer.alloc(8); head.writeUInt32BE(payload.length + 8); head.write(type, 4, 'latin1'); return Buffer.concat([head, payload]); };
  const ftyp = box('ftyp', Buffer.from('heic\0\0\0\0mif1heic', 'latin1'));
  const exifItem = Buffer.concat([Buffer.from([0, 0, 0, 6]), Buffer.from('Exif\0\0', 'latin1'), exif()]);
  return Buffer.concat([ftyp, box('meta', Buffer.alloc(4)), box('mdat', Buffer.concat([exifItem, xmpPacket(), Buffer.from([seed & 255, 1, 2, 3])]))]);
}
// The same JPEG without any APPn/COM segment other than JFIF: what a canvas
// re-encoding produces structurally. Used only as a server-side stand-in.
function stripJpeg(jpeg) {
  const b = Buffer.from(jpeg), out = [b.subarray(0, 2)]; let at = 2;
  while (at < b.length) {
    const marker = b[at + 1], length = b.readUInt16BE(at + 2);
    if (marker === 0xda) { out.push(b.subarray(at)); break; }
    if (!((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe)) out.push(b.subarray(at, at + 2 + length));
    at += 2 + length;
  }
  return Buffer.concat(out);
}
// An 8x8 JPEG and an 8x8 WebP exactly as Chrome's canvas encodes them
// (JFIF/VP8X with an sRGB colour profile, no other metadata), stored here so
// server-side tests need no browser. Generated 2026-11-02.
const JPEG_8X8 = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAhEAABAgQHAAAAAAAAAAAAAAAABxICERMVFBclMURhYv/EABUBAQEAAAAAAAAAAAAAAAAAAAQG/8QAHREAAgEFAQEAAAAAAAAAAAAAAQMEAAIRMUEh8f/aAAwDAQACEQMRAD8AnVcVzNO1aVbMBV5NZ72eIZSZ3uAAkeOqIoJSMWjQ9OzntTD3skMLWnNx+cr/2Q==', 'base64');
const WEBP_8X8 = Buffer.from('UklGRjICAABXRUJQVlA4WAoAAAAgAAAABwAABwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggRAAAABACAJ0BKggACAAAwBIliALD4oABrVue+4AA/v4yX8W9/+XHMv+f/73Vzrn/wqfDHV3v+9QLqUf/K7cump/ez/ezoiAA', 'base64');
module.exports = { MARKERS, leaks, exif, jpegWithGps, pngWithGps, webpWithGps, heicWithGps, stripJpeg, png, apng, animatedWebp, riff, JPEG_8X8, WEBP_8X8 };

/* Public photo copies in a real browser (2026-11-02 owner decision).
 * Synthetic originals with invented EXIF/GPS/XMP (tests/fixtures/photo-metadata.cjs)
 * go through the actual PhotoPost.readPhoto → publicCopy pipeline (real canvas
 * decoding and encoding). The original stays byte-identical; the copy carries no
 * metadata, applies EXIF rotation and passes the haedo-blog-media byte check.
 * HEIC decoding is stubbed (Linux Chromium has no HEIC decoder); its JPEG view and
 * the copy made from it are still encoded by the real canvas. An Apple-style
 * encoder (minimal Exif APP1 in JPEG, iDOT in PNG) is simulated by wrapping toBlob. No account, server, or Apple-device claim.
 * BASE_URL=http://127.0.0.1:4197 node tests/public-photo-copy-browser.cjs
 */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { playwright } = require('./unified-home-browser.cjs');
const F = require('./fixtures/photo-metadata.cjs');
const base = process.env.BASE_URL || 'http://127.0.0.1:4197';
const report = { scope: 'Linux Chromium canvas, synthetic photos only; HEIC decode stubbed.', checks: [], consoleErrors: [], pageErrors: [] };
const b64 = bytes => Buffer.from(bytes).toString('base64'), bytesOf = text => Buffer.from(text, 'base64');

async function main() {
  const edge = await import('data:text/javascript;base64,' + b64(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '../supabase/functions/haedo-blog-media/index.ts'), 'utf8'))));
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version();
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    await page.goto(base + '/privacy.html', { waitUntil: 'domcontentloaded' });
    for (const name of ['core.js', 'page-posts.js', 'photo-post.js']) await page.addScriptTag({ url: base + '/assets/life/' + name });
    // Base pictures from the real canvas: a red block marks the stored top-left corner.
    const made = await page.evaluate(async () => {
      const draw = (w, h, alpha) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
        x.fillStyle = alpha ? 'rgba(40,90,160,0.4)' : '#2a5aa0'; x.fillRect(0, 0, w, h); x.fillStyle = '#e02020'; x.fillRect(0, 0, w / 4, h / 4); return c; };
      const encode = async (c, type, q) => { const blob = await new Promise(r => c.toBlob(r, type, q)); let s = ''; new Uint8Array(await blob.arrayBuffer()).forEach(n => s += String.fromCharCode(n)); return btoa(s); };
      return { jpeg: await encode(draw(64, 48), 'image/jpeg', 0.95), png: await encode(draw(64, 48, true), 'image/png'),
        webp: await encode(draw(64, 48), 'image/webp', 0.9), webpAlpha: await encode(draw(64, 48, true), 'image/webp', 0.9), still: await encode(draw(8, 8), 'image/webp', 0.9), jpeg90: await encode(draw(64, 48), 'image/jpeg', 0.9) };
    });
    const cases = [
      { name: 'JPEG with EXIF orientation 6, GPS and XMP', file: 'camera.jpg', type: 'image/jpeg', bytes: F.jpegWithGps(bytesOf(made.jpeg), { orientation: 6 }), copy: 'image/jpeg', shown: [48, 64], rotated: true },
      { name: 'PNG with eXIf GPS and iTXt XMP', file: 'screen.png', type: 'image/png', bytes: F.pngWithGps(bytesOf(made.png)), copy: 'image/png', shown: [64, 48], alpha: true },
      { name: 'opaque WebP with EXIF GPS and XMP', file: 'edit.webp', type: 'image/webp', bytes: F.webpWithGps(bytesOf(made.webp), { width: 64, height: 48 }), copy: 'image/jpeg', shown: [64, 48] },
      { name: 'transparent WebP with EXIF GPS and XMP', file: 'sticker.webp', type: 'image/webp', bytes: F.webpWithGps(bytesOf(made.webpAlpha), { width: 64, height: 48 }), copy: 'image/png', shown: [64, 48], alpha: true },
      { name: 'animated PNG (first frame only)', file: 'loop.png', type: 'image/png', bytes: F.apng(4, 3), copy: 'image/png', shown: [4, 3], animated: true, alpha: true },
      { name: 'animated WebP (first frame only)', file: 'loop.webp', type: 'image/webp', bytes: F.animatedWebp(bytesOf(made.still), 8, 8), copy: 'image/jpeg', shown: [8, 8], animated: true },
      // Re-encoding canvas output returns the same bytes; the copy must still differ.
      { name: 'canvas-made PNG whose re-encoding is identical', file: 'plain.png', type: 'image/png', bytes: bytesOf(made.png), copy: 'image/png', shown: [64, 48], alpha: true, plain: true },
      { name: 'canvas-made JPEG at quality 0.9', file: 'plain.jpg', type: 'image/jpeg', bytes: bytesOf(made.jpeg90), copy: 'image/jpeg', shown: [64, 48], plain: true },
    ];
    for (const item of cases) {
      const result = await page.evaluate(async ({ file, type, data }) => {
        const M = HaedoLife.PhotoPost, C = HaedoLife.Core, input = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        const photo = await M.readPhoto(new File([input], file, { type }), C.id), traits = await M.imageTraits(photo.blob);
        const copy = await M.publicCopy(photo), bytes = new Uint8Array(await copy.blob.arrayBuffer());
        const bitmap = await createImageBitmap(copy.blob), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
        const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
        let s = ''; bytes.forEach(n => s += String.fromCharCode(n));
        const original = new Uint8Array(await photo.blob.arrayBuffer());
        return { photo: { type: photo.type, width: photo.width, height: photo.height, digest: photo.digest },
          sameOriginal: original.length === input.length && original.every((v, i) => v === input[i]), traits,
          copy: { type: copy.type, width: copy.width, height: copy.height, size: copy.size, digest: copy.digest, animated: copy.animated, view: !!copy.view, actual: await M.digest(copy.blob) },
          bytes: btoa(s), corners: { topLeft: at(1, 1), topRight: at(bitmap.width - 2, 1) } };
      }, { file: item.file, type: item.type, data: b64(item.bytes) });
      const copy = bytesOf(result.bytes);
      assert.equal(result.sameOriginal, true, item.name + ': the private original keeps its exact bytes');
      assert.equal(result.copy.type, item.copy, item.name + ': copy type');
      assert.deepEqual([result.photo.width, result.photo.height], item.shown, item.name + ': displayed size');
      assert.deepEqual([result.copy.width, result.copy.height], item.shown, item.name + ': copy keeps the displayed size');
      assert.notEqual(result.copy.digest, result.photo.digest, item.name + ': the copy is a separate object');
      assert.equal(result.copy.actual, result.copy.digest); assert.equal(copy.length, result.copy.size);
      assert.equal(result.copy.animated, !!item.animated, item.name + ': animation is reported');
      assert.equal(result.traits.alpha, !!item.alpha, item.name + ': alpha detection');
      assert.deepEqual(F.leaks(copy), [], item.name + ': the copy carries no EXIF/GPS/XMP');
      assert.equal(edge.metadataFree(result.copy.type, copy), true, item.name + ': the media handler accepts the copy');
      if (!item.plain && !item.animated) assert(F.leaks(item.bytes).length > 0, item.name + ': the fixture carries metadata');
      if (item.rotated) {
        // Stored top-left red block → after the EXIF 90° turn it is at the top right.
        assert(result.corners.topRight[0] > 180 && result.corners.topRight[2] < 90, 'rotation applied: red block at the top right');
        assert(result.corners.topLeft[0] < 120, 'rotation applied: top left is the background');
      }
      report.checks.push({ name: item.name, copy: result.copy.type, size: result.copy.size }); console.log('PASS ' + item.name + ' → ' + result.copy.type + ' ' + result.copy.width + '×' + result.copy.height);
    }
    // HEIC: the public bytes are a copy made from the JPEG view (real canvas; the HEIC decode is stubbed).
    const heic = F.heicWithGps();
    await page.evaluate(() => {
      const real = window.createImageBitmap.bind(window);
      window.createImageBitmap = async blob => {
        if (!['image/heic', 'image/heif'].includes(blob.type)) return real(blob);
        const c = document.createElement('canvas'); c.width = 40; c.height = 30; const x = c.getContext('2d'); x.fillStyle = '#336699'; x.fillRect(0, 0, 40, 30); return real(c);
      };
    });
    const heicCopy = async () => page.evaluate(async data => {
      const M = HaedoLife.PhotoPost, input = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      const photo = await M.readPhoto(new File([input], 'IMG_0001.HEIC', { type: 'image/heic' }), HaedoLife.Core.id), copy = await M.publicCopy(photo);
      const original = new Uint8Array(await photo.blob.arrayBuffer()), bytes = new Uint8Array(await copy.blob.arrayBuffer()), view = new Uint8Array(await photo.view.blob.arrayBuffer());
      const text = value => { let s = ''; value.forEach(n => s += String.fromCharCode(n)); return btoa(s); };
      return { sameOriginal: original.length === input.length && original.every((v, i) => v === input[i]), view: copy.view, type: copy.type, digest: copy.digest, viewDigest: photo.view.digest,
        width: copy.width, height: copy.height, bytes: text(bytes), viewBytes: text(view) };
    }, b64(heic));
    const checkHeic = (result, label) => {
      assert.equal(result.sameOriginal, true, label + ': HEIC original keeps its exact bytes');
      assert.equal(result.view, undefined); assert.equal(result.type, 'image/jpeg'); assert.deepEqual([result.width, result.height], [40, 30]);
      assert.notEqual(result.digest, result.viewDigest, label + ': the public copy is a separate object from the view');
      assert.deepEqual(F.leaks(bytesOf(result.bytes)), [], label + ': the copy carries no EXIF/GPS/XMP'); assert(F.leaks(heic).length > 0);
      assert.equal(edge.metadataFree('image/jpeg', bytesOf(result.bytes)), true, label + ': the media handler accepts the copy');
    };
    checkHeic(await heicCopy(), 'HEIC'); report.checks.push({ name: 'HEIC copy from its view', copy: 'image/jpeg' }); console.log('PASS HEIC with Exif GPS → a JPEG copy of its view');

    // Apple ImageIO (iOS/macOS Safari) can add a minimal Exif APP1 to canvas JPEG
    // and an iDOT chunk to canvas PNG. Simulate that encoder: every toBlob output
    // gains those pieces. The copy must still be reduced to the allow list.
    const app0End = 4 + F.JPEG_8X8.readUInt16BE(4), appleSegment = F.appleJpeg(F.JPEG_8X8).subarray(app0End, app0End + F.appleJpeg(F.JPEG_8X8).length - F.JPEG_8X8.length);
    const plainPng = F.png(4, 3), idatAt = 8 + 12 + 13, idotChunk = F.pngWithIdot(plainPng).subarray(idatAt, idatAt + F.pngWithIdot(plainPng).length - plainPng.length);
    await page.evaluate(({ exif, idot }) => {
      const bytes = text => Uint8Array.from(atob(text), c => c.charCodeAt(0)), segment = bytes(exif), chunk = bytes(idot), real = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        return real.call(this, async blob => {
          if (!blob) return callback(blob);
          const b = new Uint8Array(await blob.arrayBuffer());
          if (blob.type === 'image/jpeg') { const at = b[3] === 0xe0 ? 4 + ((b[4] << 8) | b[5]) : 2; return callback(new Blob([b.subarray(0, at), segment, b.subarray(at)], { type: blob.type })); }
          if (blob.type === 'image/png') { let at = 8; while (String.fromCharCode(...b.subarray(at + 4, at + 8)) !== 'IDAT') at += 12 + (((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0); return callback(new Blob([b.subarray(0, at), chunk, b.subarray(at)], { type: blob.type })); }
          callback(blob);
        }, type, quality);
      };
    }, { exif: b64(appleSegment), idot: b64(idotChunk) });
    const probe = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 4; c.height = 3; c.getContext('2d').fillRect(0, 0, 4, 3);
      const read = type => new Promise(r => c.toBlob(async b => r([...new Uint8Array(await b.arrayBuffer())]), type, 0.9)); return { jpeg: await read('image/jpeg'), png: await read('image/png') }; });
    assert.equal(edge.metadataFree('image/jpeg', Buffer.from(probe.jpeg)), false, 'the simulated Apple JPEG output would be refused as is');
    assert.equal(edge.metadataFree('image/png', Buffer.from(probe.png)), false, 'the simulated Apple PNG output would be refused as is');
    for (const item of cases.filter(value => ['JPEG with EXIF orientation 6, GPS and XMP', 'PNG with eXIf GPS and iTXt XMP'].includes(value.name))) {
      const result = await page.evaluate(async ({ file, type, data }) => {
        const M = HaedoLife.PhotoPost, photo = await M.readPhoto(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], file, { type }), HaedoLife.Core.id), copy = await M.publicCopy(photo);
        let s = ''; new Uint8Array(await copy.blob.arrayBuffer()).forEach(n => s += String.fromCharCode(n)); return { type: copy.type, digest: copy.digest, actual: await M.digest(copy.blob), bytes: btoa(s) };
      }, { file: item.file, type: item.type, data: b64(item.bytes) });
      const bytes = bytesOf(result.bytes);
      assert.deepEqual(F.leaks(bytes), [], 'Apple-style ' + item.name + ': no Exif/GPS/XMP');
      assert.equal(edge.metadataFree(result.type, bytes), true, 'Apple-style ' + item.name + ': the media handler accepts the copy');
      assert.equal(result.actual, result.digest, 'the digest names the filtered bytes');
      report.checks.push({ name: 'Apple-style encoder: ' + item.name, copy: result.type }); console.log('PASS Apple-style encoder: ' + item.name + ' → clean ' + result.type);
    }
    const appleHeic = await heicCopy();
    assert(F.leaks(bytesOf(appleHeic.viewBytes)).includes('Exif\\0\\0'), 'the simulated Apple view carries an Exif block');
    checkHeic(appleHeic, 'Apple-style HEIC view'); report.checks.push({ name: 'Apple-style encoder: HEIC view with Exif', copy: 'image/jpeg' }); console.log('PASS Apple-style encoder: HEIC view with Exif → clean JPEG copy');
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []);
  } finally { await browser.close(); }
  console.log(JSON.stringify({ pass: true, checks: report.checks.length, browser: report.browser }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

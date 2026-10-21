'use strict';
const crypto = require('node:crypto');
const Core = require('../../assets/life/core.js');
const OWNER = '11111111-1111-4111-8111-111111111111';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
// Valid 1x1 PNG. Node unit tests use a header-only decoder; actual browser QA
// separately exercises the browser decoder and native IndexedDB transactions.
const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=', 'base64'));
function installDecoder() {
  const before = { Image: globalThis.Image, create: URL.createObjectURL, revoke: URL.revokeObjectURL }, blobs = new Map();
  URL.createObjectURL = blob => { const key = 'blob:naver-test-' + Core.id(); blobs.set(key, blob); return key; };
  URL.revokeObjectURL = key => blobs.delete(key);
  globalThis.Image = class {
    set src(key) {
      if (!key) return;
      const blob = blobs.get(key);
      Promise.resolve().then(async () => {
        if (!blob) throw Error('No blob');
        const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
        this.naturalWidth = view.getUint32(16); this.naturalHeight = view.getUint32(20); this.onload?.();
      }).catch(() => this.onerror?.());
    }
  };
  return () => { globalThis.Image = before.Image; URL.createObjectURL = before.create; URL.revokeObjectURL = before.revoke; };
}
async function fixture(bundle = Core.createWorkspace()) {
  const Capture = require('../../assets/life/naver-capture.js');
  const body = '\uFEFF추출한 원문\r\n🌱 그대로 보관한 구절\r\n끝', sha256 = hash(bytes), stamp = '2026-10-21T01:00:00.000Z';
  const payload = { version: 1, blogId: 'fixture_blog', logNo: '123456789012', url: 'https://blog.naver.com/fixture_blog/123456789012',
    title: '사진이 있는 한글 원문', format: 'text/plain', body, bodyHash: hash(body), htmlHash: hash('<p>fixture</p>'),
    coverage: 'full_text', omissions: [], publishedAt: null, author: '', extractedAt: stamp, extractor: 'fixture@v1',
    photos: [{ index: 0, url: 'https://postfiles.pstatic.net/fixture/photo.png?type=w966',
      storagePath: OWNER + '/naver/fixture_blog/123456789012/' + sha256, sha256, mimeType: 'image/png', width: 1, height: 1,
      bytes: bytes.length, alt: '한글 대체 설명', caption: '원문 사진 설명', status: 'stored', error: null, originalStatus: 'unverified' }] };
  const capture = { id: '22222222-2222-4222-8222-222222222222', owner_id: OWNER, blog_id: payload.blogId, log_no: payload.logNo,
    capture_hash: await Capture.fingerprint(payload), created_at: stamp, payload };
  const prepared = await Core.prepareImport(Capture.toImportInput(payload), bundle);
  const attachment = { sourceId: prepared.source.id, sourceVersionId: prepared.version.id, capture,
    photos: [{ index: 0, blob: new Blob([bytes], { type: 'image/png' }) }] };
  return { bundle, prepared, attachment, changes: Core.buildImportChanges(bundle, prepared), payload, bytes };
}
module.exports = { OWNER, hash, bytes, installDecoder, fixture };

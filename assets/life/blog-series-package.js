/* Private series transport. Reuses unchanged photo-post ZIPs; no storage or network. */
(function (root, factory) {
  const api = factory(root); (root.HaedoLife ||= {}).BlogSeriesPackage = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const FORMAT = 'life-blog-series-package-v1';
  const LIMITS = Object.freeze({ bytes: 256 * 1024 * 1024, json: 16 * 1024 * 1024, posts: 20, photos: 200 });
  const dependency = name => root.HaedoLife?.[name] || require({ PhotoPost: './photo-post.js', Blog: './blog.js', BlogSeries: './blog-series.js' }[name]);
  const zip = () => root.fflate || require('../../vendor/fflate/fflate.js');
  const fail = message => { throw Object.assign(new Error(message), { code: 'invalid_blog_series_package' }); };
  const plain = value => value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  function fields(value, keys) {
    if (!plain(value) || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('모음 파일의 형식을 확인해 주세요.');
  }
  const postPath = itemId => 'posts/' + itemId + '.zip';
  function manifestCheck(value) {
    fields(value, ['format', 'series', 'posts']);
    if (value.format !== FORMAT) fail('해도에서 받은 모음 ZIP 파일을 선택해 주세요.');
    dependency('BlogSeries').validateSeries(value.series);
    if (!Array.isArray(value.posts) || !value.posts.length || value.posts.length > LIMITS.posts || value.posts.length !== value.series.items.length) fail('모음 파일에는 선택한 글을 20편까지 담을 수 있습니다.');
    let photos = 0, bytes = 0;
    const itemIds = new Set();
    value.posts.forEach((row, index) => {
      fields(row, ['itemId', 'doc']); dependency('Blog').validateManifest(row.doc);
      const item = value.series.items[index];
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(row.itemId) || itemIds.has(row.itemId) || row.itemId !== item.id || row.doc.id !== item.postId || row.doc.revision !== item.postRevision || row.doc.title !== item.title || row.doc.status !== 'saved' || row.doc.archived) fail('모음의 글·순서·저장 버전이 일치하지 않습니다.');
      const used = new Set(row.doc.ops.filter(op => typeof op.insert !== 'string').map(op => op.insert.photo.id));
      if (row.doc.photos.some(photo => !used.has(photo.id))) fail('본문에서 사용한 사진만 모음에 보관해 주세요.');
      itemIds.add(row.itemId); photos += row.doc.photos.length;
      row.doc.photos.forEach(photo => { bytes += photo.size; });
    });
    if (photos > LIMITS.photos || bytes > LIMITS.bytes) fail('사진은 합계 200장·256 MiB까지 보관할 수 있습니다. 원본은 줄이지 않았습니다.');
  }
  let crcTable;
  function crc32(bytes) {
    crcTable ||= Uint32Array.from({ length: 256 }, (_, value) => {
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
      return value >>> 0;
    });
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
    return (crc ^ 0xffffffff) >>> 0;
  }
  function stored(bytes, nested = false) {
    // Fixed series/photo-post paths only. No compressed members, ZIP64, extras,
    // descriptors, comments, encryption, symlinks or unlisted/trailing bytes.
    if (bytes.byteLength < 22 || bytes.byteLength > LIMITS.bytes) fail('256 MiB 이하의 모음 ZIP 파일을 선택해 주세요.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = bytes.byteLength - 22;
    if (view.getUint32(end, true) !== 0x06054b50 || view.getUint16(end + 20, true) || view.getUint32(end + 4, true)) fail('모음 ZIP의 파일 목록을 확인해 주세요.');
    const count = view.getUint16(end + 10, true), start = view.getUint32(end + 16, true);
    if (!count || count > LIMITS.posts + 1 || count !== view.getUint16(end + 8, true) || start + view.getUint32(end + 12, true) !== end) fail('모음 ZIP의 파일 개수와 크기가 다릅니다.');
    const rows = new Map(), decoder = new TextDecoder('utf-8', { fatal: true });
    let at = start, local = 0, total = 0;
    for (let index = 0; index < count; index++) {
      if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) fail('모음 ZIP의 파일 목록이 손상됐습니다.');
      const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true), checksum = view.getUint32(at + 16, true);
      const compressed = view.getUint32(at + 20, true), length = view.getUint32(at + 24, true), nameLength = view.getUint16(at + 28, true);
      if (method !== 0) fail('지원하지 않는 ZIP 압축 방식입니다. 모음 ZIP을 다시 압축하지 말고 원래 파일을 선택해 주세요.');
      if (flags & ~0x0800 || !nameLength || view.getUint16(at + 30, true) || view.getUint16(at + 32, true) || view.getUint16(at + 34, true) || view.getUint32(at + 38, true) || at + 46 + nameLength > end) fail('지원하지 않는 ZIP 파일 정보가 있습니다.');
      const encoded = bytes.subarray(at + 46, at + 46 + nameLength);
      let name; try { name = decoder.decode(encoded); } catch (_) { fail('ZIP 파일 경로의 문자 인코딩을 확인해 주세요.'); }
      const metadata = name === (nested ? 'manifest.json' : 'series.json');
      const permitted = nested ? /^photos\/[A-Za-z0-9_-]{1,128}$/ : /^posts\/[A-Za-z0-9_-]{1,128}\.zip$/;
      if ((!metadata && !permitted.test(name)) || rows.has(name)) fail('중복되거나 지원하지 않는 모음 ZIP 경로입니다.');
      total += length;
      if (compressed !== length || length > (metadata ? nested ? 2 * 1024 * 1024 : LIMITS.json : nested ? 64 * 1024 * 1024 : LIMITS.bytes) || total > LIMITS.bytes || view.getUint32(at + 42, true) !== local || local + 30 > start ||
          view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method || view.getUint32(local + 14, true) !== checksum || view.getUint32(local + 18, true) !== length || view.getUint32(local + 22, true) !== length || view.getUint16(local + 26, true) !== nameLength || view.getUint16(local + 28, true)) fail('모음 ZIP의 크기와 원본 위치가 일치하지 않습니다.');
      const data = local + 30 + nameLength;
      if (data + length > start || !encoded.every((byte, offset) => byte === bytes[local + 30 + offset]) || crc32(bytes.subarray(data, data + length)) !== checksum) fail('모음 ZIP의 경로나 원본 바이트 검증값이 다릅니다.');
      rows.set(name, bytes.subarray(data, data + length)); local = data + length; at += 46 + nameLength;
    }
    if (at !== end || local !== start) fail('모음 ZIP에 목록 밖의 바이트가 있습니다.');
    return rows;
  }
  function contents(doc) {
    return { title: doc.title, ops: doc.ops, attachments: doc.attachments || [], photos: doc.photos.map(({ blob, ...photo }) => photo) };
  }
  async function readPost(row, bytes) {
    const nested = stored(bytes, true);
    let format;
    try { format = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(nested.get('manifest.json'))).format; }
    catch (_) { fail('모음 안의 글 ZIP 목록을 읽지 못했습니다.'); }
    if (format !== (row.doc.format === 'life-photo-post-v1' ? 'life-photo-post-backup-v1' : 'life-photo-post-backup-v2')) fail('모음 목록과 글 ZIP의 문서 형식이 다릅니다.');
    let sequence = 0;
    const restored = await dependency('PhotoPost').readBackup(new Blob([bytes], { type: 'application/zip' }), () => 'series_read_' + ++sequence);
    if (restored.photos.length !== row.doc.photos.length) fail('모음 목록과 글 ZIP의 사진 개수가 다릅니다.');
    const ids = new Map(), photos = restored.photos.map((photo, index) => {
      ids.set(photo.id, row.doc.photos[index].id); return { ...photo, id: row.doc.photos[index].id };
    });
    const actual = { ...restored, photos, ops: restored.ops.map(op => typeof op.insert === 'string' ? op : { ...op, insert: { photo: { ...op.insert.photo, id: ids.get(op.insert.photo.id) } } }) };
    if (!equal(contents(actual), contents(row.doc))) fail('모음 목록과 글 ZIP의 본문·사진·첨부가 일치하지 않습니다.');
    // Keep the original snapshot format/IDs/timestamps here. The explicit storage
    // copy operation creates fresh IDs in the current account after all reads.
    return dependency('Blog').hydrate(row.doc, photos);
  }
  async function pack(input) {
    const value = structuredClone(input); fields(value, ['series', 'posts']);
    dependency('BlogSeries').validateSnapshot(value);
    const manifest = { format: FORMAT, series: value.series, posts: value.posts.map(row => ({ itemId: row.itemId, doc: dependency('Blog').pack(row.doc) })) };
    manifestCheck(manifest);
    const json = new TextEncoder().encode(JSON.stringify(manifest));
    if (json.byteLength > LIMITS.json) fail('모음의 설명과 글 정보는 합계 16 MiB까지 보관할 수 있습니다.');
    const files = Object.create(null); files['series.json'] = json; let total = json.byteLength;
    for (const row of value.posts) {
      if (dependency('PhotoPost').compact(row.doc).photos.length !== row.doc.photos.length) fail('본문에서 사용한 사진만 모음에 보관해 주세요.');
      await dependency('Blog').hydrate(dependency('Blog').pack(row.doc), row.doc.photos);
      const file = await dependency('PhotoPost').backup(row.doc); total += file.size;
      if (total > LIMITS.bytes) fail('모음 ZIP 파일은 256 MiB까지 보관할 수 있습니다.');
      const bytes = new Uint8Array(await file.arrayBuffer()); stored(bytes, true); files[postPath(row.itemId)] = bytes;
    }
    const bytes = zip().zipSync(files, { level: 0 });
    if (bytes.byteLength > LIMITS.bytes) fail('모음 ZIP 파일은 256 MiB까지 보관할 수 있습니다.');
    return new Blob([bytes], { type: 'application/zip' });
  }
  async function read(file) {
    if (!(file instanceof Blob) || !Number.isSafeInteger(file.size) || file.size < 22 || file.size > LIMITS.bytes) fail('256 MiB 이하의 모음 ZIP 파일을 선택해 주세요.');
    let rows, manifest;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); if (bytes.byteLength !== file.size) fail('모음 ZIP의 크기가 일치하지 않습니다.');
      rows = stored(bytes);
      if (!rows.has('series.json')) fail('모음 ZIP의 목록 파일이 없습니다.');
      manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rows.get('series.json')));
    } catch (error) {
      if (error.code === 'invalid_blog_series_package') throw error;
      fail('모음 ZIP을 읽지 못했습니다. 원래 파일은 유지됩니다.');
    }
    manifestCheck(manifest);
    if (rows.size !== manifest.posts.length + 1) fail('모음에 누락된 글이나 목록에 없는 파일이 있습니다.');
    const posts = [];
    for (const row of manifest.posts) {
      const bytes = rows.get(postPath(row.itemId)); if (!bytes) fail('모음의 글 ZIP 원본이 없습니다.');
      posts.push({ itemId: row.itemId, doc: await readPost(row, bytes) });
    }
    const result = { series: manifest.series, posts }; dependency('BlogSeries').validateSnapshot(result); return result;
  }
  return Object.freeze({ FORMAT, LIMITS, pack, read });
});

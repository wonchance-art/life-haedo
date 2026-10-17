/* Explicit private ZIP transport. No storage, network, executable files or installation. */
(function (root, factory) {
  const api = factory(root);
  (root.HaedoLife ||= {}).PreservationPackage = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const FORMAT = 'life-preservation-package-v1';
  const LIMITS = Object.freeze({ bytes: 256 * 1024 * 1024, json: 16 * 1024 * 1024, posts: 20, photos: 200 });
  const api = name => root.HaedoLife?.[name] || require({ Core: './core.js', Blog: './blog.js', NineBoard: './nine-board.js', PreservationReferences: './preservation-references.js' }[name]);
  const zip = () => root.fflate || require('../../vendor/fflate/fflate.js');
  const copy = value => structuredClone(value);
  const fail = message => { throw Object.assign(new Error(message), { code: 'invalid_preservation_package' }); };
  function fields(value, keys) {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('근거 포함 ZIP의 형식을 확인해 주세요.');
  }
  function structure(snapshot, packed = false) {
    fields(snapshot, ['bundle', 'posts', 'nineBoard']);
    api('Core').validateWorkspace(snapshot.bundle);
    api('NineBoard').validate(snapshot.nineBoard);
    if (snapshot.nineBoard.workspaceId !== snapshot.bundle.workspaceId) fail('다른 작업공간의 9칸 구성이 섞여 있습니다.');
    if (!Array.isArray(snapshot.posts) || snapshot.posts.length > LIMITS.posts) fail('근거 포함 ZIP에는 저장한 글을 20편까지 담을 수 있습니다.');
    if (!snapshot.posts.length && !snapshot.nineBoard.boards.length) fail('보관할 글이나 9칸 구성을 선택해 주세요.');
    const ids = new Set(); let photos = 0, photoBytes = 0;
    for (const entry of snapshot.posts) {
      fields(entry, ['doc', 'evidence']); fields(entry.evidence, ['revision', 'refs']);
      if (!Number.isSafeInteger(entry.evidence.revision) || entry.evidence.revision < 0 || !Array.isArray(entry.evidence.refs) || entry.evidence.refs.length > 64) fail('글의 원문 연결 정보를 확인해 주세요.');
      const doc = packed ? api('Blog').validateManifest(entry.doc) : entry.doc;
      if (!packed) api('Blog').pack(doc);
      if (doc.status !== 'saved' || doc.revision < 1 || ids.has(doc.id)) fail('중복되지 않은 저장 글을 선택해 주세요. 초안은 이 파일에 포함하지 않습니다.');
      ids.add(doc.id); photos += doc.photos.length;
      for (const photo of doc.photos) photoBytes += photo.size;
    }
    if (photos > LIMITS.photos || photoBytes > LIMITS.bytes) fail('사진은 합계 200장·256 MiB까지 담을 수 있습니다. 원본은 줄이지 않았습니다.');
    return { posts: snapshot.posts.length, photos, photoBytes, sources: snapshot.bundle.sources.length,
      sourceVersions: snapshot.bundle.sourceVersions.length, boards: snapshot.nineBoard.boards.length };
  }
  function manifest(snapshot) {
    return { format: FORMAT, bundle: copy(snapshot.bundle), posts: snapshot.posts.map(entry => ({ doc: api('Blog').pack(entry.doc), evidence: copy(entry.evidence) })), nineBoard: copy(snapshot.nineBoard) };
  }
  function encode(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    if (bytes.byteLength > LIMITS.json) fail('글·원문·구성 정보는 합계 16 MiB까지 담을 수 있습니다.');
    return bytes;
  }
  const photoPath = (doc, photo) => 'photos/' + doc.id + '/' + photo.id;
  let crcTable;
  function crc32(bytes) {
    if (!crcTable) crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
      return value >>> 0;
    });
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
    return (crc ^ 0xffffffff) >>> 0;
  }
  function storedEntries(bytes) {
    // This dedicated format has no ZIP64, comments, extra fields, encryption or
    // descriptors. fflate remains the ZIP engine; preflight binds both headers
    // and CRC to the exact stored bytes before it creates extracted buffers.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = bytes.byteLength - 22;
    if (view.getUint32(end, true) !== 0x06054b50 || view.getUint16(end + 20, true) !== 0 ||
      view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) fail('해도의 근거 포함 ZIP 파일을 선택해 주세요.');
    const count = view.getUint16(end + 10, true), start = view.getUint32(end + 16, true);
    if (count < 1 || count > LIMITS.photos + 1 || count !== view.getUint16(end + 8, true) || start + view.getUint32(end + 12, true) !== end) fail('ZIP의 파일 목록과 크기가 일치하지 않습니다.');
    const entries = new Map(); let at = start, local = 0, total = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (let index = 0; index < count; index++) {
      if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) fail('ZIP의 파일 목록이 손상됐습니다.');
      const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true), checksum = view.getUint32(at + 16, true);
      const compressed = view.getUint32(at + 20, true), size = view.getUint32(at + 24, true), length = view.getUint16(at + 28, true);
      if (method !== 0) fail('지원하지 않는 ZIP 압축 방식입니다. 해도에서 만든 근거 포함 ZIP을 선택해 주세요.');
      if (flags & ~0x0800 || view.getUint16(at + 30, true) || view.getUint16(at + 32, true) || view.getUint16(at + 34, true) ||
        view.getUint32(at + 38, true) || at + 46 + length > end) fail('지원하지 않는 ZIP 파일 정보가 있습니다.');
      const nameBytes = bytes.subarray(at + 46, at + 46 + length), name = decoder.decode(nameBytes);
      if ((name !== 'manifest.json' && !/^photos\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}$/.test(name)) || entries.has(name)) fail('중복되거나 지원하지 않는 ZIP 경로입니다.');
      const limit = name === 'manifest.json' ? LIMITS.json : 64 * 1024 * 1024;
      total += size;
      if (compressed !== size || size > limit || total > LIMITS.bytes || view.getUint32(at + 42, true) !== local || local + 30 > start ||
        view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method ||
        view.getUint32(local + 14, true) !== checksum || view.getUint32(local + 18, true) !== compressed || view.getUint32(local + 22, true) !== size ||
        view.getUint16(local + 26, true) !== length || view.getUint16(local + 28, true) !== 0) fail('ZIP에 기록된 크기나 파일 정보가 일치하지 않습니다.');
      const data = local + 30 + length;
      if (data + size > start || !nameBytes.every((byte, offset) => byte === bytes[local + 30 + offset]) || crc32(bytes.subarray(data, data + size)) !== checksum) fail('ZIP 파일의 경로나 원본 바이트 검증값이 일치하지 않습니다.');
      entries.set(name, size); local = data + size; at += 46 + length;
    }
    if (at !== end || local !== start) fail('ZIP에 목록 밖의 데이터가 있습니다.');
    return entries;
  }
  async function validate(snapshot) {
    const owned = copy(snapshot);
    structure(owned);
    const checked = await api('PreservationReferences').validate(owned);
    structure(checked);
    for (const entry of checked.posts) entry.doc = await api('Blog').hydrate(api('Blog').pack(entry.doc), entry.doc.photos);
    return checked;
  }
  async function pack(snapshot) {
    const checked = await validate(snapshot), files = Object.create(null);
    files['manifest.json'] = encode(manifest(checked));
    let size = files['manifest.json'].byteLength;
    for (const { doc } of checked.posts) for (const photo of doc.photos) {
      size += photo.size;
      if (size > LIMITS.bytes) fail('ZIP을 펼친 크기는 256 MiB까지 담을 수 있습니다.');
      files[photoPath(doc, photo)] = new Uint8Array(await photo.blob.arrayBuffer());
    }
    // Reuse the existing uncompressed original-photo format. This is an in-memory
    // archive, not a streaming/mobile-memory guarantee at the maximum limit.
    const bytes = zip().zipSync(files, { level: 0 });
    if (bytes.byteLength > LIMITS.bytes) fail('근거 포함 ZIP 파일은 256 MiB까지 만들 수 있습니다.');
    return new Blob([bytes], { type: 'application/zip' });
  }
  async function read(file) {
    const size = file?.size;
    if (!Number.isSafeInteger(size) || size < 22 || size > LIMITS.bytes) fail('256 MiB 이하의 근거 포함 ZIP 파일을 선택해 주세요.');
    let files;
    let sizes;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength !== size || bytes.byteLength > LIMITS.bytes) fail('ZIP 파일 크기가 일치하지 않습니다.');
      sizes = storedEntries(bytes);
      files = zip().unzipSync(bytes);
    } catch (error) {
      if (error.code === 'invalid_preservation_package') throw error;
      fail('근거 포함 ZIP을 읽지 못했습니다. 원래 파일은 그대로 유지됩니다.');
    }
    if (!Object.hasOwn(files, 'manifest.json')) fail('근거 포함 ZIP의 목록 파일이 없습니다.');
    for (const [name, bytes] of Object.entries(files)) if (bytes.byteLength !== sizes.get(name)) fail('ZIP에 기록된 크기와 펼친 파일이 일치하지 않습니다.');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files['manifest.json'])); }
    catch (_) { fail('근거 포함 ZIP의 JSON과 문자 인코딩을 확인해 주세요.'); }
    fields(value, ['format', 'bundle', 'posts', 'nineBoard']);
    if (value.format !== FORMAT) fail('근거 포함 ZIP 파일을 선택해 주세요. 기존 사진 글 ZIP과 다릅니다.');
    const snapshot = { bundle: value.bundle, posts: value.posts, nineBoard: value.nineBoard };
    const info = structure(snapshot, true);
    if (sizes.size !== info.photos + 1) fail('목록에 없는 파일이나 누락된 사진 원본이 있습니다.');
    for (const entry of snapshot.posts) {
      const photos = entry.doc.photos.map(photo => {
        const path = photoPath(entry.doc, photo), bytes = files[path];
        if (!bytes || bytes.byteLength !== photo.size) fail('목록에 있는 사진 원본이 없거나 크기가 다릅니다.');
        return { id: photo.id, blob: new Blob([bytes], { type: photo.type }) };
      });
      entry.doc = await api('Blog').hydrate(entry.doc, photos);
    }
    // Verification preserves file IDs. Only the explicit copy/install adapter may
    // create new IDs and reset local revisions; reading never opens a store.
    return api('PreservationReferences').validate(snapshot);
  }
  return Object.freeze({ FORMAT, LIMITS, pack, read, summary: snapshot => structure(snapshot) });
});

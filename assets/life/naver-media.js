/* Immutable private source-version media and a separate portable capture ZIP. */
(function (root, factory) {
  const api = factory(root); (root.HaedoLife ||= {}).NaverMedia = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const FORMAT = 'haedo.naver.capture.v1';
  const LIMITS = Object.freeze({ photos: 20, file: 64 * 1024 * 1024, bytes: 256 * 1024 * 1024, json: 4 * 1024 * 1024 });
  const names = { Core: './core.js', NaverBlog: './naver-blog.js', NaverCapture: './naver-capture.js', PhotoPost: './photo-post.js' };
  const api = name => root.HaedoLife?.[name] || (typeof require === 'function' && require(names[name]));
  const zip = () => root.fflate || require('../../vendor/fflate/fflate.js');
  const clone = value => structuredClone(value);
  const fail = message => { throw Object.assign(new Error(message), { code: 'invalid_naver_media' }); };
  function fields(value, required, optional = []) {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        required.some(key => !Object.hasOwn(value, key)) || Reflect.ownKeys(value).some(key => typeof key !== 'string' ||
          ![...required, ...optional].includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) fail('원문 사진의 형식을 확인해 주세요.');
  }
  function identifier(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail('원문 사진의 식별자를 확인해 주세요.'); }
  const encode = value => new TextEncoder().encode(JSON.stringify(value));
  function checkTarget(bundle, attachment) {
    api('Core').validateWorkspace(bundle);
    const source = bundle.sources.find(value => value.id === attachment.sourceId), version = bundle.sourceVersions.find(value => value.id === attachment.sourceVersionId);
    const payload = attachment.capture.payload, identity = source && api('NaverBlog').postIdentity(source.url);
    if (!source || source.origin !== 'naver_blog' || !identity || identity.blogId !== payload.blogId || identity.logNo !== payload.logNo ||
        !version || version.sourceId !== source.id || version.contentText !== payload.body || version.contentHash !== payload.bodyHash ||
        version.format !== payload.format || version.coverage.status !== payload.coverage) fail('사진을 연결할 정확한 원문 버전이 일치하지 않습니다.');
    return true;
  }
  async function validate(input, { ownerId } = {}) {
    fields(input, ['sourceId', 'sourceVersionId', 'capture', 'photos'], ['localOnly']);
    identifier(input.sourceId); identifier(input.sourceVersionId);
    if (input.localOnly !== undefined && typeof input.localOnly !== 'boolean') fail('원문 사진의 파일 사본 여부를 확인해 주세요.');
    const owned = clone(input), localOnly = owned.localOnly === true;
    let capture;
    if (localOnly) {
      if (ownerId !== undefined) fail('파일 사본은 서버 수집 영수증이 아닙니다.');
      fields(owned.capture, ['capture_hash', 'payload']);
      const payload = await api('NaverCapture').verifyPayload(owned.capture.payload, { local: true });
      if (await api('NaverCapture').fingerprint(payload, { local: true }) !== owned.capture.capture_hash) fail('파일의 원문 수집 해시가 일치하지 않습니다.');
      capture = { capture_hash: owned.capture.capture_hash, payload };
    } else capture = await api('NaverCapture').validateCaptureRow(owned.capture, ownerId === undefined ? {} : { ownerId });
    const descriptors = capture.payload.photos.filter(photo => photo.status === 'stored');
    if (!Array.isArray(owned.photos) || owned.photos.length !== descriptors.length || owned.photos.length > LIMITS.photos) fail('목록과 사진 원본 수가 일치하지 않습니다.');
    const seen = new Set(); let total = 0;
    for (const photo of owned.photos) {
      fields(photo, ['index', 'blob']);
      const descriptor = descriptors.find(value => value.index === photo.index);
      if (!descriptor || seen.has(photo.index) || !(photo.blob instanceof Blob) || photo.blob.size !== descriptor.bytes || photo.blob.type !== descriptor.mimeType) fail('사진 원본이 누락되었거나 선언과 다릅니다.');
      seen.add(photo.index); total += photo.blob.size;
      if (photo.blob.size > LIMITS.file || total > LIMITS.bytes) fail('사진은 한 장64 MiB·합계256 MiB까지 보관할 수 있습니다.');
      // Existing decoder checks signature, actual dimensions, bytes and SHA.
      const actual = await api('PhotoPost').readPhoto(photo.blob, () => 'naver-photo-' + photo.index);
      if (actual.digest !== descriptor.sha256 || actual.width !== descriptor.width || actual.height !== descriptor.height ||
          actual.type !== descriptor.mimeType || actual.size !== descriptor.bytes) fail('사진 해시·해상도·형식이 선언과 일치하지 않습니다.');
    }
    owned.photos.sort((a, b) => a.index - b.index);
    return { sourceId: owned.sourceId, sourceVersionId: owned.sourceVersionId, capture, photos: owned.photos, localOnly };
  }
  function selected(input) {
    fields(input, ['bundle', 'attachment']);
    checkTarget(input.bundle, input.attachment);
    const source = input.bundle.sources.find(value => value.id === input.attachment.sourceId), version = input.bundle.sourceVersions.find(value => value.id === input.attachment.sourceVersionId);
    return { bundle: { ...clone(input.bundle), title: source.title, revision: 0, createdAt: source.createdAt, updatedAt: version.importedAt,
      sources: [clone(source)], sourceVersions: [clone(version)], records: [], links: [], resumeHints: [], tombstones: [] }, attachment: input.attachment };
  }
  async function validateSnapshot(input) {
    fields(input, ['bundle', 'attachment']);
    const owned = clone(input), attachment = await validate(owned.attachment);
    checkTarget(owned.bundle, attachment);
    if (owned.bundle.sources.length !== 1 || owned.bundle.sourceVersions.length !== 1 ||
        ['records', 'links', 'resumeHints', 'tombstones'].some(key => owned.bundle[key].length)) fail('선택한 원문 버전과 사진만 담긴 파일을 선택해 주세요.');
    const portableSize = encode({ bundle: owned.bundle, attachment: { ...attachment, photos: [] } }).length;
    if (portableSize > LIMITS.json || portableSize + attachment.photos.reduce((sum, photo) => sum + photo.blob.size, 0) > LIMITS.bytes) fail('원문 사진 파일의 보관 한도를 넘었습니다.');
    return { bundle: owned.bundle, attachment };
  }
  function portable(attachment) {
    const payload = clone(attachment.capture.payload);
    for (const photo of payload.photos) photo.storagePath = null;
    return { sourceId: attachment.sourceId, sourceVersionId: attachment.sourceVersionId,
      capture: { capture_hash: attachment.capture.capture_hash, payload }, photos: attachment.photos, localOnly: true };
  }
  async function pack(input) {
    // Project first: unrelated sources and private records never enter the ZIP.
    const snapshot = selected(clone(input)); snapshot.attachment = await validate(snapshot.attachment);
    const owned = await validateSnapshot({ ...snapshot, attachment: portable(snapshot.attachment) });
    const manifest = { format: FORMAT, bundle: owned.bundle, attachment: { ...owned.attachment, photos: owned.attachment.photos.map(photo => ({ index: photo.index, path: 'photos/' + photo.index })) } };
    const files = Object.create(null); files['manifest.json'] = encode(manifest);
    for (const photo of owned.attachment.photos) files['photos/' + photo.index] = new Uint8Array(await photo.blob.arrayBuffer());
    const bytes = zip().zipSync(files, { level: 0 });
    if (bytes.byteLength > LIMITS.bytes) fail('원문 사진 ZIP은256 MiB까지 만들 수 있습니다.');
    return new Blob([bytes], { type: 'application/zip' });
  }
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
    // Dedicated stored-only ZIP: reject compression bombs, duplicate/traversal
    // paths, local/central disagreement, extra fields and trailing data first.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = bytes.byteLength - 22;
    if (end < 0 || view.getUint32(end, true) !== 0x06054b50 || view.getUint16(end + 20, true) !== 0 ||
        view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) fail('해도 원문 사진 ZIP 파일을 선택해 주세요.');
    const count = view.getUint16(end + 10, true), start = view.getUint32(end + 16, true);
    if (count < 1 || count > LIMITS.photos + 1 || count !== view.getUint16(end + 8, true) || start + view.getUint32(end + 12, true) !== end) fail('ZIP의 파일 목록과 크기가 일치하지 않습니다.');
    const entries = new Map(), decoder = new TextDecoder('utf-8', { fatal: true }); let at = start, local = 0, total = 0;
    for (let index = 0; index < count; index++) {
      if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) fail('ZIP의 파일 목록이 손상됐습니다.');
      const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true), checksum = view.getUint32(at + 16, true);
      const compressed = view.getUint32(at + 20, true), size = view.getUint32(at + 24, true), length = view.getUint16(at + 28, true);
      if (method !== 0 || flags & ~0x0800 || view.getUint16(at + 30, true) || view.getUint16(at + 32, true) || view.getUint16(at + 34, true) ||
          view.getUint32(at + 38, true) || at + 46 + length > end) fail('지원하지 않는 ZIP 압축·파일 정보입니다.');
      const nameBytes = bytes.subarray(at + 46, at + 46 + length), name = decoder.decode(nameBytes);
      if ((name !== 'manifest.json' && !/^photos\/(?:0|[1-9][0-9]?)$/.test(name)) || entries.has(name)) fail('중복되거나 지원하지 않는 ZIP 경로입니다.');
      const limit = name === 'manifest.json' ? LIMITS.json : LIMITS.file;
      total += size;
      if (compressed !== size || size > limit || total > LIMITS.bytes || view.getUint32(at + 42, true) !== local || local + 30 > start ||
          view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method ||
          view.getUint32(local + 14, true) !== checksum || view.getUint32(local + 18, true) !== compressed || view.getUint32(local + 22, true) !== size ||
          view.getUint16(local + 26, true) !== length || view.getUint16(local + 28, true) !== 0) fail('ZIP에 기록된 크기나 파일 정보가 일치하지 않습니다.');
      const data = local + 30 + length;
      if (data + size > start || !nameBytes.every((byte, offset) => byte === bytes[local + 30 + offset]) || crc32(bytes.subarray(data, data + size)) !== checksum) fail('ZIP 파일 경로나 원본 바이트 검증값이 일치하지 않습니다.');
      entries.set(name, size); local = data + size; at += 46 + length;
    }
    if (at !== end || local !== start) fail('ZIP에 목록 밖의 데이터가 있습니다.');
    return entries;
  }
  async function read(file) {
    if (!(file instanceof Blob) || file.size < 22 || file.size > LIMITS.bytes) fail('256 MiB 이하의 원문 사진 ZIP을 선택해 주세요.');
    let files, value, sizes;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); sizes = storedEntries(bytes); files = zip().unzipSync(bytes);
      if (!files['manifest.json']) fail('원문 사진 ZIP의 목록이 없습니다.');
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files['manifest.json']));
    } catch (error) { if (error.code === 'invalid_naver_media') throw error; fail('원문 사진 ZIP을 읽지 못했습니다. 원본은 유지했습니다.'); }
    fields(value, ['format', 'bundle', 'attachment']);
    if (value.format !== FORMAT || value.attachment?.localOnly !== true) fail('해도 원문 사진 ZIP 형식이 아닙니다.');
    const attachment = value.attachment;
    if (!Array.isArray(attachment.photos) || attachment.photos.length > LIMITS.photos || sizes.size !== attachment.photos.length + 1) fail('ZIP 사진 목록이 일치하지 않습니다.');
    const descriptors = attachment.capture?.payload?.photos;
    if (!Array.isArray(descriptors)) fail('원문 사진 선언이 없습니다.');
    attachment.photos = attachment.photos.map(photo => {
      fields(photo, ['index', 'path']);
      const descriptor = descriptors.find(value => value.index === photo.index && value.status === 'stored');
      if (!descriptor || photo.path !== 'photos/' + photo.index || !files[photo.path] || files[photo.path].length !== descriptor.bytes || sizes.get(photo.path) !== descriptor.bytes) fail('원문 사진이 누락되었거나 크기가 다릅니다.');
      return { index: photo.index, blob: new Blob([files[photo.path]], { type: descriptor.mimeType }) };
    });
    return validateSnapshot({ bundle: value.bundle, attachment });
  }
  async function copy(input, { title } = {}) {
    const value = await validateSnapshot(input), portableAttachment = portable(value.attachment);
    const bundle = await api('Core').restoreBackup(api('Core').makeBackup(value.bundle));
    if (title !== undefined) { if (typeof title !== 'string' || !title.trim() || title.length > 500) fail('새 공간 제목을 확인해 주세요.'); bundle.title = title; }
    portableAttachment.sourceId = bundle.sources[0].id; portableAttachment.sourceVersionId = bundle.sourceVersions[0].id;
    return validateSnapshot({ bundle, attachment: portableAttachment });
  }
  return Object.freeze({ FORMAT, LIMITS, validate, checkTarget, validateSnapshot, pack, read, copy });
});

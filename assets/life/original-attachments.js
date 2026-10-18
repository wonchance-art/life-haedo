/* Private, immutable originals. A dedicated account-scoped Blob database; no remote access. */
(function (root, factory) {
  const api = factory(root); (root.HaedoLife ||= {}).OriginalAttachments = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const LIMITS = Object.freeze({ part: 128 * 1024 * 1024, file: 64 * 1024 * 1024, receipt: 1024 * 1024, entries: 500 });
  const FORMAT = 'haedo-private-originals-part-v1';
  const ROLES = ['git-excluded-attachment', 'working-note-version', 'git-note-version'];
  const TYPES = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', heic: 'image/heic', pdf: 'application/pdf', md: 'text/markdown' });
  const fail = (message, code = 'invalid_original_attachment') => { throw Object.assign(new Error(message), { code }); };
  const aborted = signal => { if (signal?.aborted) fail('파일 확인을 취소했습니다. 원래 자료는 유지됩니다.', 'originals_cancelled'); };
  const decode = bytes => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (_) { fail('파일 목록의 문자 인코딩을 확인해 주세요.'); } };
  function path(value) {
    if (typeof value !== 'string' || !value || value.length > 4000 || /[\\\u0000-\u001f\u007f]/u.test(value) || /<\/?(?:script|iframe|svg|img|object|embed|style|link|meta)(?:\s|>|\/)/i.test(value) || value.startsWith('/') || /^[a-z]:/i.test(value) || value.split('/').some(p => !p || p === '.' || p === '..')) fail('지원하지 않는 원본 경로입니다.');
    return value;
  }
  const hash = async bytes => [...new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  let crcTable;
  function crc32(bytes) {
    crcTable ||= Uint32Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
    let n = 0xffffffff;
    for (const b of bytes) n = crcTable[(n ^ b) & 255] ^ n >>> 8;
    return (n ^ 0xffffffff) >>> 0;
  }
  const mime = value => TYPES[value.split('.').pop().toLowerCase()] || 'application/octet-stream';
  async function bytes(blob, start, end, signal) { aborted(signal); const b = new Uint8Array(await blob.slice(start, end).arrayBuffer()); aborted(signal); return b; }
  async function storedIndex(blob, signal) {
    if (!(blob instanceof Blob) || !Number.isSafeInteger(blob.size) || blob.size < 22 || blob.size > LIMITS.part) fail('원본 파트 ZIP을 한 개씩 선택해 주세요. 파트는 128 MiB 이하입니다.');
    const tail = await bytes(blob, blob.size - 22, blob.size, signal), end = new DataView(tail.buffer);
    if (end.getUint32(0, true) !== 0x06054b50 || end.getUint16(20, true) || end.getUint32(4, true)) fail('압축하지 않은 원본 파트 ZIP을 선택해 주세요.');
    const count = end.getUint16(10, true), at = end.getUint32(16, true), length = end.getUint32(12, true);
    if (!count || count > LIMITS.entries + 1 || count !== end.getUint16(8, true) || length > 2 * 1024 * 1024 || at + length !== blob.size - 22) fail('ZIP의 파일 목록과 크기를 확인해 주세요.');
    const central = await bytes(blob, at, at + length, signal), view = new DataView(central.buffer), rows = new Map();
    let offset = 0, nextLocal = 0;
    for (let i = 0; i < count; i++) {
      if (offset + 46 > length || view.getUint32(offset, true) !== 0x02014b50) fail('ZIP 파일 목록이 손상됐습니다.');
      const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true), crc = view.getUint32(offset + 16, true), size = view.getUint32(offset + 20, true);
      const unpacked = view.getUint32(offset + 24, true), nameLength = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true), localOffset = view.getUint32(offset + 42, true);
      if (((view.getUint32(offset + 38, true) >>> 16) & 0xf000) === 0xa000 || (flags & ~0x0800) || method !== 0 || size !== unpacked || size > LIMITS.file || !nameLength || nameLength > 16000 || extra || comment || view.getUint16(offset + 34, true) || offset + 46 + nameLength > length || localOffset !== nextLocal) fail('원본 파트의 저장 방식·크기·위치를 확인해 주세요.');
      const name = path(decode(central.subarray(offset + 46, offset + 46 + nameLength)));
      if (rows.has(name)) fail('중복된 ZIP 경로입니다.');
      const header = await bytes(blob, localOffset, localOffset + 30 + nameLength, signal), local = new DataView(header.buffer);
      if (header.length !== 30 + nameLength || local.getUint32(0, true) !== 0x04034b50 || local.getUint16(6, true) !== flags || local.getUint16(8, true) !== 0 || local.getUint32(14, true) !== crc || local.getUint32(18, true) !== size || local.getUint32(22, true) !== size || local.getUint16(26, true) !== nameLength || local.getUint16(28, true) || decode(header.subarray(30)) !== name) fail('ZIP의 원본 위치와 파일 목록이 다릅니다.');
      const start = localOffset + header.length;
      if (start + size > at) fail('ZIP 원본 범위가 겹칩니다.');
      rows.set(name, { name, start, size, crc }); nextLocal = start + size; offset += 46 + nameLength;
    }
    if (offset !== length || nextLocal !== at) fail('ZIP에 확인하지 못한 바이트가 있습니다.');
    return rows;
  }
  function validateReceipt(value, rows) {
    if (!value || value.format !== FORMAT || !Number.isSafeInteger(value.partCount) || value.partCount < 1 || value.partCount > 200 || !Number.isSafeInteger(value.part) || value.part < 1 || value.part > value.partCount || !/^[a-f0-9]{40}$/.test(value.sourceHead) || !Array.isArray(value.entries) || !value.entries.length || value.entries.length > LIMITS.entries || rows.size !== value.entries.length + 1) fail('원본 파트 영수증의 형식을 확인해 주세요.');
    const names = new Set();
    return value.entries.map(item => {
      const original = path(item.sourceRelativePath), packed = path(item.snapshotPath), role = item.role;
      const prefix = { 'git-excluded-attachment': 'attachments', 'working-note-version': 'working-version', 'git-note-version': 'git-version' }[role];
      const ext = original.split('.').pop().toLowerCase();
      if (!ROLES.includes(role) || packed !== 'snapshot/' + prefix + '/' + original || names.has(packed) || !TYPES[ext] || (role === 'git-excluded-attachment' ? ext === 'md' : ext !== 'md') || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > LIMITS.file || !/^[a-f0-9]{64}$/.test(item.sha256) || !rows.has(packed) || rows.get(packed).size !== item.bytes || mime(original) !== item.mime || item.sourceGitCommit != null && !/^[a-f0-9]{40}$/.test(item.sourceGitCommit) || role === 'git-note-version' && item.sourceGitCommit !== value.sourceHead) fail('원본 경로·종류·해시·버전 선언이 일치하지 않습니다.');
      names.add(packed);
      return { sourceRelativePath: original, snapshotPath: packed, role, bytes: item.bytes, sha256: item.sha256, mime: mime(original), sourceGitCommit: item.sourceGitCommit || null, offset: rows.get(packed).start, crc: rows.get(packed).crc };
    });
  }
  async function readPart(blob, { signal, onProgress = () => {} } = {}) {
    const rows = await storedIndex(blob, signal), receiptRow = rows.get('part-receipt.json');
    if (!receiptRow || receiptRow.size > LIMITS.receipt) fail('원본 파트 영수증이 없습니다.');
    const raw = await bytes(blob, receiptRow.start, receiptRow.start + receiptRow.size, signal);
    if (crc32(raw) !== receiptRow.crc) fail('영수증 바이트가 손상됐습니다.');
    let receipt; try { receipt = JSON.parse(decode(raw)); } catch (_) { fail('원본 파트 영수증을 읽지 못했습니다.'); }
    const entries = validateReceipt(receipt, rows);
    let verified = 0;
    for (const entry of entries) {
      const content = await bytes(blob, entry.offset, entry.offset + entry.bytes, signal);
      if (content.length !== entry.bytes || crc32(content) !== entry.crc || await hash(content) !== entry.sha256) fail('원본 파일의 바이트·SHA-256이 다릅니다. 원래 파트로 다시 확인해 주세요.');
      aborted(signal); onProgress({ verified: ++verified, count: entries.length });
    }
    return { archive: blob.slice(0, blob.size, 'application/zip'), part: receipt.part, partCount: receipt.partCount, sourceHead: receipt.sourceHead, entries };
  }
  function accountKey(account) {
    if (!account || typeof account.userId !== 'string' || !account.userId.trim()) fail('로그인한 계정에서 원본을 열어 주세요.', 'auth_scope_required');
    let u; try { u = new URL(account.projectUrl); } catch (_) { fail('로그인 프로젝트를 확인해 주세요.', 'auth_scope_required'); }
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname !== '/') fail('로그인 프로젝트를 확인해 주세요.', 'auth_scope_required');
    return JSON.stringify([u.origin, account.userId]);
  }
  function create(options = {}) {
    const auth = options.auth || root.HaedoAuth, account = options.account || auth?.getAccount(), owner = accountKey(account);
    const current = options.isCurrent || (() => { try { return accountKey(auth?.getAccount()) === owner; } catch (_) { return false; } });
    const dbFactory = options.indexedDB || root.indexedDB, tickets = new Map(), transactions = new Set();
    let db, opening, disposed = false, unsubscribe;
    const guard = () => { if (disposed || !current()) fail('계정이 바뀌었습니다. 현재 계정에서 다시 열어 주세요.', 'originals_scope_closed'); };
    const dispose = () => { disposed = true; tickets.clear(); for (const t of transactions) { try { t.abort(); } catch (_) {} } db?.close(); db = null; unsubscribe?.(); };
    unsubscribe = auth?.onAccountChange?.(next => { try { if (accountKey(next) !== owner) dispose(); } catch (_) { dispose(); } });
    async function open() {
      guard(); if (db) return db;
      if (!dbFactory) fail('브라우저 원본 저장소를 사용할 수 없습니다. 파일은 유지됩니다.', 'originals_storage_unavailable');
      if (!opening) opening = new Promise((resolve, reject) => {
        const request = dbFactory.open(options.dbName || 'life-original-attachments-v1', 1);
        request.onupgradeneeded = () => { request.result.createObjectStore('copies', { keyPath: 'id' }).createIndex('owner', 'owner'); };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(Object.assign(new Error('다른 원본 보관 화면을 닫고 다시 확인해 주세요.'), { code: 'originals_storage_blocked' }));
        request.onsuccess = () => { try { guard(); db = request.result; db.onversionchange = dispose; resolve(db); } catch (e) { request.result.close(); reject(e); } };
      }).finally(() => { opening = null; });
      return opening;
    }
    async function transaction(mode, fn, signal) {
      const connection = await open(); guard(); aborted(signal);
      return new Promise((resolve, reject) => {
        const tx = connection.transaction('copies', mode); transactions.add(tx); let result;
        const onAbort = () => { try { tx.abort(); } catch (_) {} };
        signal?.addEventListener('abort', onAbort, { once: true });
        const end = () => { transactions.delete(tx); signal?.removeEventListener('abort', onAbort); };
        tx.oncomplete = () => { end(); try { guard(); resolve(result); } catch (e) { reject(e); } };
        tx.onabort = tx.onerror = () => { end(); reject(Object.assign(new Error('원본 저장을 완료하지 못했습니다. 기존 사본은 유지됩니다. 공간을 확인하고 다시 시도해 주세요.'), { code: tx.error?.name === 'QuotaExceededError' ? 'originals_quota' : 'originals_storage_aborted' })); };
        try { fn(tx.objectStore('copies'), value => { try { guard(); result = value; } catch (e) { onAbort(); reject(e); } }, tx); } catch (e) { onAbort(); reject(e); }
      });
    }
    async function prepare(blob, opts) {
      guard(); const data = await readPart(blob, opts); guard();
      const ticket = Object.freeze({ id: root.crypto.randomUUID() }); tickets.set(ticket.id, data);
      return { ticket, part: data.part, partCount: data.partCount, sourceHead: data.sourceHead, count: data.entries.length, bytes: data.entries.reduce((n, e) => n + e.bytes, 0), entries: data.entries.map(({ offset, crc, ...e }) => ({ ...e })) };
    }
    async function install(ticket, { signal } = {}) {
      guard(); const data = tickets.get(ticket?.id); if (!data) fail('먼저 원본 파트의 포함 범위를 확인해 주세요.');
      const record = { id: root.crypto.randomUUID(), owner, createdAt: new Date().toISOString(), ...data };
      const result = await transaction('readwrite', (store, done) => { const req = store.add(record); req.onsuccess = () => done({ id: record.id, count: record.entries.length, part: record.part }); }, signal);
      tickets.delete(ticket.id); return result;
    }
    async function get(id) {
      if (typeof id !== 'string') fail('원본 사본을 확인해 주세요.');
      const row = await transaction('readonly', (store, done) => { store.get(id).onsuccess = event => done(event.target.result); });
      if (!row || row.owner !== owner) fail('현재 계정의 원본 사본을 찾을 수 없습니다.', 'originals_not_found');
      return row;
    }
    const summary = row => ({ id: row.id, part: row.part, partCount: row.partCount, createdAt: row.createdAt, count: row.entries.length, bytes: row.entries.reduce((n, e) => n + e.bytes, 0) });
    async function list() {
      return transaction('readonly', (store, done) => { const req = store.index('owner').getAll(owner); req.onsuccess = () => done(req.result.map(summary)); });
    }
    async function entries(id) { const row = await get(id); return row.entries.map(({ offset, crc, ...e }) => ({ ...e })); }
    async function file(id, packedPath) {
      const row = await get(id), entry = row.entries.find(e => e.snapshotPath === packedPath);
      if (!entry) fail('해당 원본을 찾을 수 없습니다.');
      const blob = row.archive.slice(entry.offset, entry.offset + entry.bytes, entry.mime), data = await bytes(blob, 0, blob.size);
      if (data.length !== entry.bytes || crc32(data) !== entry.crc || await hash(data) !== entry.sha256) fail('보관 원본의 해시가 다릅니다. 원래 파트 파일로 확인해 주세요.');
      guard(); return { blob, entry: { ...entry } };
    }
    async function archive(id) { const row = await get(id); await readPart(row.archive); guard(); return { blob: row.archive, name: 'originals-part-' + String(row.part).padStart(2, '0') + '.zip' }; }
    async function matchSource(entry, storage) {
      guard(); const matches = [];
      for (const workspace of await storage.listWorkspaces()) {
        guard(); const bundle = await storage.read(workspace.workspaceId); guard();
        for (const source of bundle.sources.filter(s => s.sourceKey === entry.sourceRelativePath)) {
          for (const version of bundle.sourceVersions.filter(v => v.sourceId === source.id && v.contentHash === entry.sha256)) matches.push({ workspaceId: bundle.workspaceId, versionId: version.id, title: source.title, sourceRelativePath: entry.sourceRelativePath });
        }
      }
      return matches;
    }
    return Object.freeze({ prepare, install, list, entries, file, archive, matchSource,
      cancel(ticket) { tickets.delete(ticket?.id); }, dispose });
  }
  return Object.freeze({ FORMAT, LIMITS, readPart, create, mime });
});

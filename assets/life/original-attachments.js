/* Private, immutable originals. Account-scoped cache and durable archive uploads. */
(function (root, factory) {
  const api = factory(root); (root.HaedoLife ||= {}).OriginalAttachments = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const LIMITS = Object.freeze({ part: 128 * 1024 * 1024, file: 64 * 1024 * 1024, receipt: 1024 * 1024, entries: 500 });
  const FORMAT = 'haedo-private-originals-part-v1';
  const REMOTE_FORMAT = 'life-library-original-v1', CHUNK_BYTES = 8 * 1024 * 1024;
  const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  const HASH = /^[a-f0-9]{64}$/;
  const canonical = value => JSON.stringify(value, function (_key, item) { return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item; });
  const fields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
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
  function validateManifest(input, userId) {
    const value = structuredClone(input);
    if (!UUID.test(userId || '') || !fields(value, ['format', 'id', 'sourceHead', 'part', 'partCount', 'archiveBytes', 'archiveHash', 'entries', 'chunks']) || value.format !== REMOTE_FORMAT || !UUID.test(value.id || '') || !HASH.test(value.archiveHash || '') || !Number.isSafeInteger(value.archiveBytes) || value.archiveBytes < 22 || value.archiveBytes > LIMITS.part || new TextEncoder().encode(JSON.stringify(value)).length > 2 * 1024 * 1024 || !Array.isArray(value.entries) || !value.entries.length || value.entries.length > LIMITS.entries || !Array.isArray(value.chunks) || !value.chunks.length || value.chunks.length > 16) fail('계정 원본의 목록과 크기를 확인하지 못했습니다.', 'originals_invalid_remote');
    const rows = new Map([['part-receipt.json', {}]]);
    for (const entry of value.entries) {
      if (!fields(entry, ['sourceRelativePath', 'snapshotPath', 'role', 'bytes', 'sha256', 'mime', 'sourceGitCommit', 'offset', 'crc']) || !Number.isSafeInteger(entry.offset) || entry.offset < 30 || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.offset + entry.bytes > value.archiveBytes || !Number.isSafeInteger(entry.crc) || entry.crc < 0 || entry.crc > 0xffffffff || rows.has(entry.snapshotPath)) fail('계정 원본의 파일 범위가 다릅니다.', 'originals_invalid_remote');
      rows.set(entry.snapshotPath, { start: entry.offset, size: entry.bytes, crc: entry.crc });
    }
    try { validateReceipt({ ...value, format: FORMAT }, rows); } catch (_) { fail('계정 원본의 경로·종류·해시가 다릅니다.', 'originals_invalid_remote'); }
    let total = 0;
    value.chunks.forEach((chunk, index) => {
      if (!fields(chunk, ['index', 'path', 'bytes', 'sha256']) || chunk.index !== index || !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 1 || chunk.bytes > CHUNK_BYTES || !HASH.test(chunk.sha256 || '') || chunk.path !== `${userId}/${value.archiveHash}/${String(index).padStart(4, '0')}-${chunk.sha256}`) fail('계정 원본의 조각 경로·크기가 다릅니다.', 'originals_invalid_remote');
      total += chunk.bytes;
    });
    if (total !== value.archiveBytes) fail('계정 원본의 전체 크기가 다릅니다.', 'originals_invalid_remote');
    return value;
  }
  function create(options = {}) {
    const auth = options.auth || root.HaedoAuth, account = structuredClone(options.account || auth?.getAccount()), owner = accountKey(account), authEpoch = auth?.epoch;
    const current = options.isCurrent || (() => { try { return accountKey(auth?.getAccount()) === owner; } catch (_) { return false; } });
    const dbFactory = options.indexedDB || root.indexedDB, tickets = new Map(), transactions = new Set();
    const listeners = new Set();
    let db, opening, disposed = false, unsubscribe, remote, mode = 'local', capabilityTask, catalogTask, uploadTask, started = false, channel, catalogError = null;
    let catalogRevision = 0, state = { mode: 'local', status: 'cached', pending: 0, error: null, catalogRevision };
    const guard = () => { if (disposed || !current() || authEpoch !== undefined && auth?.epoch !== authEpoch) fail('계정이 바뀌었습니다. 현재 계정에서 다시 열어 주세요.', 'originals_scope_closed'); };
    const dispose = () => { disposed = true; tickets.clear(); for (const t of transactions) { try { t.abort(); } catch (_) {} } db?.close(); db = null; unsubscribe?.(); remote?.dispose(); channel?.close(); listeners.clear(); root.removeEventListener?.('online', automatic); root.removeEventListener?.('focus', automatic); root.document?.removeEventListener('visibilitychange', automatic); };
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
        try { fn(tx.objectStore('copies'), (value, error) => { try { if (error) throw error; guard(); result = value; } catch (e) { onAbort(); reject(e); } }, tx); } catch (e) { onAbort(); reject(e); }
      });
    }
    const getState = () => structuredClone(state);
    function emit() { if (disposed) return; for (const listener of listeners) { try { listener(getState()); } catch (_) {} } }
    function publicError(error) { return { code: error?.code || 'originals_network', message: '계정 원본 보관을 완료하지 못했습니다. 기존 원본과 전송 대기는 유지합니다.' }; }
    function changed() { emit(); channel?.postMessage({ owner }); }
    async function localRows() { return transaction('readonly', (store, done) => { store.index('owner').getAll(owner).onsuccess = event => done(event.target.result); }); }
    async function updateState(error) {
      const rows = await localRows(); guard();
      const pending = rows.filter(row => row.archive && row.sync?.status !== 'stored').length;
      const failure = error ? publicError(error) : catalogError || rows.find(row => row.sync?.error)?.sync.error || null;
      state = { mode, pending: mode === 'local' || mode === 'legacy' ? 0 : pending, status: failure ? 'error' : mode === 'account' ? pending ? 'pending' : 'saved' : mode === 'legacy' ? 'unsupported' : 'cached', error: failure, catalogRevision }; emit();
      return getState();
    }
    async function mutate(id, change) {
      return transaction('readwrite', (store, done) => {
        store.get(id).onsuccess = event => {
          try {
            const previous = event.target.result;
            if (previous && previous.owner !== owner) fail('다른 계정의 원본은 바꾸지 않습니다.', 'originals_scope_closed');
            const next = change(previous ? structuredClone(previous) : null);
            if (!next) { done(previous); return; }
            guard(); store.put(next).onsuccess = () => done(next);
          } catch (error) { done(null, error); }
        };
      });
    }
    function transport() {
      guard(); if (remote) return remote;
      if (options.remote) remote = options.remote;
      else if (auth?.ready && root.HaedoLife?.LibraryOriginalsRemote) remote = root.HaedoLife.LibraryOriginalsRemote.create({ auth });
      return remote;
    }
    async function ensureMode() {
      guard(); if (mode === 'account' || mode === 'legacy') return mode;
      const adapter = transport(); if (!adapter) return mode;
      mode = 'unknown';
      if (!capabilityTask) capabilityTask = (async () => { const value = await adapter.capabilities(); guard(); mode = value.version === 1 && value.originalsVersion === 1 ? 'account' : 'legacy'; return mode; })().finally(() => { capabilityTask = null; });
      return capabilityTask;
    }
    async function catalog() {
      if (catalogTask) return catalogTask;
      catalogTask = (async () => {
        if (await ensureMode() !== 'account') return;
        const all = [], seen = new Set(); let after = null;
        do {
          const page = await remote.list(after); guard();
          for (const item of page.items) { if (seen.has(item.id)) fail('계정 원본 목록이 중복됐습니다.', 'originals_invalid_remote'); seen.add(item.id); all.push(item); }
          if (page.next && (page.next === after || all.length > 100000)) fail('계정 원본 목록 확인을 완료하지 못했습니다.', 'originals_invalid_remote');
          after = page.next;
        } while (after !== null);
        let altered = false;
        for (const item of all) {
          await mutate(item.id, row => {
            if (row?.sync?.manifest && row.sync.manifest.archiveHash !== item.archive_sha256 || row?.remoteSummary && row.remoteSummary.archive_sha256 !== item.archive_sha256) fail('계정 원본의 해시가 바뀌었습니다.', 'originals_invalid_remote');
            if (row?.remoteSummary && canonical(row.remoteSummary) === canonical(item)) return null;
            altered = true;
            return { ...(row || { id: item.id, owner, createdAt: item.created_at, part: item.part, partCount: item.part_count, sourceHead: item.source_head }), remoteSummary: item };
          }); guard();
        }
        if (altered) { catalogRevision++; changed(); }
        catalogError = null;
      })().catch(error => { catalogError = publicError(error); throw error; }).finally(() => { catalogTask = null; });
      return catalogTask;
    }
    async function makeManifest(row) {
      const verified = await readPart(row.archive); guard();
      if (verified.part !== row.part || verified.partCount !== row.partCount || verified.sourceHead !== row.sourceHead || canonical(verified.entries) !== canonical(row.entries)) fail('보관 원본의 파일 목록이 다릅니다.', 'originals_invalid_remote');
      const archiveHash = await hash(await bytes(row.archive, 0, row.archive.size)); guard(); const chunks = [];
      for (let at = 0; at < row.archive.size; at += CHUNK_BYTES) {
        const size = Math.min(CHUNK_BYTES, row.archive.size - at), sha256 = await hash(await bytes(row.archive, at, at + size)); guard();
        const index = chunks.length; chunks.push({ index, path: `${account.userId}/${archiveHash}/${String(index).padStart(4, '0')}-${sha256}`, bytes: size, sha256 });
      }
      return validateManifest({ format: REMOTE_FORMAT, id: row.id, sourceHead: row.sourceHead, part: row.part, partCount: row.partCount, archiveBytes: row.archive.size, archiveHash, entries: row.entries, chunks }, account.userId);
    }
    async function upload(row) {
      if (row.sync?.status === 'stored' || row.sync?.status === 'missing') return;
      if (!row.sync) {
        const manifest = await makeManifest(row); guard();
        row = await mutate(row.id, currentRow => currentRow.sync ? null : { ...currentRow, sync: { status: 'pending', operationId: root.crypto.randomUUID(), manifest, error: null } }); guard();
      }
      if (row.sync.status === 'stored' || row.sync.status === 'missing') return;
      const expected = structuredClone(row.sync), manifest = validateManifest(expected.manifest, account.userId);
      try {
        let at = 0;
        for (const chunk of manifest.chunks) { await remote.uploadChunk(chunk, row.archive.slice(at, at + chunk.bytes)); guard(); at += chunk.bytes; }
        const result = await remote.write({ id: row.id, operationId: expected.operationId, manifest }); guard();
        await mutate(row.id, currentRow => {
          if (!currentRow || currentRow.sync?.operationId !== expected.operationId) fail('원본 전송 상태가 바뀌었습니다.', 'originals_invalid_remote');
          return { ...currentRow, sync: { ...currentRow.sync, status: result.status === 'stored' ? 'stored' : 'missing', error: result.status === 'stored' ? null : publicError({ code: 'originals_remote_missing' }) } };
        }); guard(); changed();
      } catch (error) {
        guard(); await mutate(row.id, currentRow => currentRow?.sync?.operationId === expected.operationId && currentRow.sync.status !== 'stored' ? { ...currentRow, sync: { ...currentRow.sync, error: publicError(error) } } : null); guard(); changed(); throw error;
      }
    }
    async function uploadPending() {
      if (uploadTask) return uploadTask;
      uploadTask = (async () => { if (await ensureMode() !== 'account') return; for (const row of await localRows()) { guard(); if (row.archive) await upload(row); } })().finally(() => { uploadTask = null; });
      return uploadTask;
    }
    async function reconcile() {
      guard(); try { await catalog(); await updateState(); await uploadPending(); return await updateState(); }
      catch (error) { guard(); await updateState(error); throw error; }
    }
    function automatic() { if (disposed || root.document?.visibilityState === 'hidden') return; reconcile().catch(() => {}); }
    function start() {
      guard(); if (!started) { started = true; root.addEventListener?.('online', automatic); root.addEventListener?.('focus', automatic); root.document?.addEventListener('visibilitychange', automatic); }
      automatic(); return getState();
    }
    if (typeof root.BroadcastChannel === 'function' && options.broadcast !== false) {
      channel = new root.BroadcastChannel('life-originals:' + owner);
      channel.onmessage = event => { if (!disposed && event.data?.owner === owner) { catalogRevision++; updateState().catch(() => {}); } };
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
      tickets.delete(ticket.id);
      if (mode === 'account' || mode === 'unknown') state = { ...state, mode, status: 'pending', pending: state.pending + 1, error: null };
      changed(); automatic(); return { ...result, storage: mode === 'account' || mode === 'unknown' ? 'pending' : 'local' };
    }
    async function get(id) {
      if (typeof id !== 'string') fail('원본 사본을 확인해 주세요.');
      const row = await transaction('readonly', (store, done) => { store.get(id).onsuccess = event => done(event.target.result); });
      if (row && row.owner !== owner) fail('현재 계정의 원본 사본을 찾을 수 없습니다.', 'originals_not_found');
      if (row?.archive) return row;
      if (await ensureMode() !== 'account') fail('현재 계정의 원본 사본을 찾을 수 없습니다.', 'originals_not_found');
      const remoteRow = await remote.read(id); guard();
      if (!remoteRow) fail('계정에서 원본을 찾을 수 없습니다.', 'originals_remote_missing');
      const manifest = validateManifest(remoteRow.manifest, account.userId), parts = [];
      for (const chunk of manifest.chunks) { parts.push(await remote.downloadChunk(chunk)); guard(); }
      const archiveBlob = new Blob(parts, { type: 'application/zip' });
      if (archiveBlob.size !== manifest.archiveBytes || await hash(await bytes(archiveBlob, 0, archiveBlob.size)) !== manifest.archiveHash) fail('계정 원본 ZIP의 해시가 다릅니다.', 'originals_invalid_remote');
      guard(); const data = await readPart(archiveBlob); guard();
      if (data.part !== manifest.part || data.partCount !== manifest.partCount || data.sourceHead !== manifest.sourceHead || canonical(data.entries) !== canonical(manifest.entries)) fail('계정 원본의 ZIP과 목록이 다릅니다.', 'originals_invalid_remote');
      const cached = await mutate(id, existing => {
        if (existing?.archive) return null;
        if (existing?.remoteSummary && existing.remoteSummary.archive_sha256 !== manifest.archiveHash) fail('계정 원본 목록이 바뀌었습니다.', 'originals_invalid_remote');
        return { ...existing, id, owner, createdAt: remoteRow.created_at, ...data, sync: { status: 'stored', manifest, operationId: null, error: null } };
      }); guard(); changed(); return cached;
    }
    const summary = row => ({ id: row.id, part: row.part, partCount: row.partCount, createdAt: row.createdAt, count: row.entries?.length || row.remoteSummary?.entry_count || 0, bytes: row.entries ? row.entries.reduce((n, e) => n + e.bytes, 0) : row.remoteSummary?.total_file_bytes || 0, storage: mode === 'account' ? row.sync?.status === 'stored' || !row.archive && row.remoteSummary ? 'account' : 'pending' : 'local' });
    async function list({ cached = false } = {}) {
      if (!cached) { try { await catalog(); await updateState(); } catch (error) { guard(); await updateState(error); } }
      const rows = await localRows(); guard(); if (!cached && mode === 'account') uploadPending().then(() => updateState()).catch(error => { if (!disposed) updateState(error).catch(() => {}); });
      return rows.map(summary);
    }
    async function entries(id) { const row = await get(id); return row.entries.map(({ offset, crc, ...e }) => ({ ...e })); }
    async function file(id, packedPath) {
      const row = await get(id), entry = row.entries.find(e => e.snapshotPath === packedPath);
      if (!entry) fail('해당 원본을 찾을 수 없습니다.');
      const blob = row.archive.slice(entry.offset, entry.offset + entry.bytes, entry.mime), data = await bytes(blob, 0, blob.size);
      if (data.length !== entry.bytes || crc32(data) !== entry.crc || await hash(data) !== entry.sha256) fail('보관 원본의 해시가 다릅니다. 원래 파트 파일로 확인해 주세요.');
      guard(); return { blob, entry: { ...entry } };
    }
    async function archive(id) {
      const row = await get(id); await readPart(row.archive); guard();
      if (row.sync?.manifest && await hash(await bytes(row.archive, 0, row.archive.size)) !== row.sync.manifest.archiveHash) fail('보관 원본 ZIP의 해시가 다릅니다.', 'originals_invalid_remote');
      guard(); return { blob: row.archive, name: 'originals-part-' + String(row.part).padStart(2, '0') + '.zip' };
    }
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
    return Object.freeze({ prepare, install, list, entries, file, archive, matchSource, start, reconcile, retry: reconcile, getState,
      subscribe(listener) { guard(); listeners.add(listener); return () => listeners.delete(listener); },
      cancel(ticket) { tickets.delete(ticket?.id); }, dispose });
  }
  return Object.freeze({ FORMAT, REMOTE_FORMAT, CHUNK_BYTES, LIMITS, readPart, create, mime, validateManifest });
});

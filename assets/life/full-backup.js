/* One ZIP for every account workspace. Each file inside keeps its existing
 * backup format; the bundle adds only README.txt and manifest.json (path,
 * format/version, counts, bytes, SHA-256). Restore always creates new
 * workspace copies through the existing single-transaction install functions
 * and never writes to an existing workspace. No network, no publication. */
(function (root, factory) {
  const api = factory(root);
  (root.HaedoLife ||= {}).FullBackup = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const FORMAT = 'haedo-full-backup-v1', VERSION = 1, DOCS_FORMAT = 'haedo-account-documents-v1';
  const MiB = 1024 * 1024, GiB = 1024 * MiB;
  // ZIP32 without ZIP64: every offset must stay below 4 GiB. Large photo sets are
  // streamed into Blob parts; the warning is about device memory, not a guarantee.
  const LIMITS = Object.freeze({ bundle: 3.5 * GiB, warn: 1 * GiB, files: 20000, manifest: 16 * MiB, json: 64 * MiB, chunk: 8 * MiB });
  const paths = { Core: './core.js', Workbench: './workbench.js', SourceFolders: './source-folders.js', Collection: './collection.js',
    NineBoard: './nine-board.js', PhotoPost: './photo-post.js' };
  const dep = name => root.HaedoLife?.[name] || (typeof require === 'function' && require(paths[name]));
  const zip = () => root.fflate || (typeof require === 'function' && require('../../vendor/fflate/fflate.js'));
  const fault = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
  const clone = value => structuredClone(value);
  const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const encoder = new TextEncoder();
  const json = value => encoder.encode(JSON.stringify(value, null, 2));

  // Labels are functional names shown in the UI, README and restore report.
  const KINDS = Object.freeze({
    library: Object.freeze({ label: '자료·구성', detail: '원문·발췌·메모·출처, 자료 폴더·묶음·내 페이지·회고·책' }),
    collection: Object.freeze({ label: '컬렉션', detail: '컬렉션 항목·비공개 메모·보관 상태' }),
    photoPosts: Object.freeze({ label: '사진 글', detail: '글별 ZIP · 원본 사진 바이트와 HEIC 보기용 JPEG' }),
    nineBoards: Object.freeze({ label: '9칸 구성', detail: '구성·영역·선택 이유·직접 담은 근거' }),
    accountDocuments: Object.freeze({ label: '계정 설정·기록 문서', detail: '뉴스 설정·관심·연간 계획·읽던 위치·페이지 초안·인용 근거' }),
    timeline: Object.freeze({ label: '연표·목표·습관', detail: '이 기기에 내려받은 사본 · 연표 목록 화면에서 복원' }),
    preservation: Object.freeze({ label: '보관 범위·근거 파일', detail: '선택한 글·9칸과 정확한 원문 근거' }),
    annualPlan: Object.freeze({ label: '연간 계획 파일', detail: '연간 계획 화면에서 복원' })
  });
  const ORDER = Object.freeze(['library', 'collection', 'photoPosts', 'nineBoards', 'accountDocuments', 'timeline']);
  // Account documents mirror storage.js ACCOUNT_DOC_*_PREFIXES. Keys of the
  // first group embed the account; the rest belong to an owned workspace.
  const ACCOUNT_PREFIXES = Object.freeze(['readingPosition', 'interestProfile', 'annualPlan', 'discoveryProfile', 'discoverySettings',
    'discoveryLanguageSettings', 'discoveryActions', 'discoveryReading']);
  const WORKSPACE_PREFIXES = Object.freeze(['public-cover', 'page-drafts', 'post-evidence']);
  // Public-cover state describes publication; restoring it into a copy could
  // pair two workspaces with one public page. It stays in the file, unrestored.
  const NOT_RESTORED = Object.freeze({ 'public-cover': '공개 표지 설정은 공개 상태와 연결돼 있어 새 사본에 복원하지 않습니다.' });
  const ID = /^[A-Za-z0-9_-]{1,128}$/;
  const BUNDLE_PATH = /^(?:workspaces\/\d{2,4}\/(?:library|collection|nine-boards)\.json|workspaces\/\d{2,4}\/photo-posts\/[A-Za-z0-9_-]{1,128}\.zip|account-documents\.json|timeline-goals-habits\.json)$/;
  const PHOTO_FORMATS = ['life-photo-post-backup-v1', 'life-photo-post-backup-v2'];
  const PATH_KIND = Object.freeze({ library: /\/library\.json$/, collection: /\/collection\.json$/, nineBoards: /\/nine-boards\.json$/,
    photoPosts: /\/photo-posts\/[A-Za-z0-9_-]+\.zip$/, accountDocuments: /^account-documents\.json$/, timeline: /^timeline-goals-habits\.json$/ });

  function versionOf(format, data) {
    if (plain(data) && Number.isSafeInteger(data.schemaVersion)) return data.schemaVersion;
    const match = /-v(\d+)$/.exec(format || '');
    return match ? Number(match[1]) : 1;
  }
  async function sha256(bytes) {
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function blobBytes(blob) { return new Uint8Array(await blob.arrayBuffer()); }
  const pause = () => new Promise(resolve => (root.setTimeout || setTimeout)(resolve, 0));
  const pad = index => String(index).padStart(2, '0');

  // ---- Counts per existing format (shown before download and in the manifest) ----
  function libraryParts(data) {
    if (data?.format === 'life-tools-backup-v1') return { bundle: data.workspace, workbench: null, folders: null };
    if (data?.format === 'life-workbench-backup-v1') return { bundle: data.sourceBackup?.workspace, workbench: data.workbench, folders: null };
    if (data?.format === dep('SourceFolders').BACKUP_FORMAT) return { bundle: data.libraryBackup?.sourceBackup?.workspace, workbench: data.libraryBackup?.workbench, folders: data.sourceFolders };
    return null;
  }
  const COUNT = {
    library(data) {
      const { bundle, workbench, folders } = libraryParts(data) || {};
      return { sources: bundle?.sources?.length || 0, sourceVersions: bundle?.sourceVersions?.length || 0, records: bundle?.records?.length || 0,
        groups: workbench?.groups?.length || 0, pageEntries: workbench?.page?.entries?.length || 0, books: workbench?.books?.length || 0,
        folders: folders?.folders?.length || 0 };
    },
    collection: data => ({ items: data.items.length, archived: data.items.filter(item => item.archived).length }),
    nineBoards: data => ({ boards: data.boards.length, items: data.boards.reduce((sum, board) => sum + board.areas.reduce((n, area) => n + area.items.length, 0), 0) }),
    photoPosts: manifest => ({ posts: 1, photos: manifest.photos.length, views: manifest.photos.filter(photo => photo.view).length, attachments: (manifest.attachments || []).length }),
    accountDocuments: data => ({ documents: data.documents.length }),
    timeline: data => ({ timelines: (data.docs || []).length, goals: (data.items || []).filter(item => item?.kind === 'goal').length,
      habits: (data.items || []).filter(item => item?.kind === 'habit').length })
  };
  const COUNT_LABELS = { sources: '자료', sourceVersions: '원문 버전', records: '발췌', groups: '묶음', pageEntries: '페이지 항목', books: '책', folders: '폴더',
    items: '항목', archived: '보관', boards: '구성', posts: '글', photos: '사진', views: 'HEIC 보기용', attachments: '첨부', documents: '문서',
    timelines: '연표', goals: '목표', habits: '습관', workspaces: '자료공간' };
  function countText(counts) {
    return Object.entries(counts || {}).filter(([key, value]) => value || ['sources', 'items', 'boards', 'posts', 'documents', 'timelines'].includes(key))
      .map(([key, value]) => (COUNT_LABELS[key] || key) + ' ' + value).join(' · ');
  }
  function addCounts(target, counts) { for (const [key, value] of Object.entries(counts || {})) target[key] = (target[key] || 0) + value; return target; }

  // ---- Reading the account (export) ----
  const accountKeyOf = storage => JSON.stringify([storage.account.projectUrl, storage.account.userId]);
  function docKey(storage, prefix, workspaceId, postId) {
    if (ACCOUNT_PREFIXES.includes(prefix)) return prefix + ':' + accountKeyOf(storage) + ':' + workspaceId;
    return prefix + ':' + workspaceId + (prefix === 'post-evidence' ? ':' + postId : '');
  }
  function timelineSnapshot({ platformData, localStorage, uid, now = () => new Date().toISOString() }) {
    // Byte-for-byte the shape of platform-store backup(): local account copy only.
    const reg = platformData.registry(localStorage, uid), keys = platformData.keys(uid);
    return { format: 'haedo-platform-backup-v1', exportedAt: now(),
      docs: reg.docs.map(doc => ({ id: doc.id, name: doc.name, data: JSON.parse(localStorage.getItem(keys.docs + doc.id)) })),
      items: clone(platformData.read(localStorage, keys.items, [])) };
  }
  async function plan({ storage, timeline = null }) {
    if (!storage?.isAccountScoped || !storage.account) throw fault('auth_scope_required', '로그인한 계정에서 백업을 만들어 주세요.');
    const libraries = await storage.listAccountLibraries();
    const workspaces = libraries.map((row, i) => ({ index: i + 1, workspaceId: row.workspaceId, title: row.title || '제목 없는 자료공간', recovery: row.eligible === false }));
    const tasks = [];
    for (const ws of workspaces) {
      const base = 'workspaces/' + pad(ws.index) + '/';
      tasks.push({ id: 'library:' + ws.index, kind: 'library', workspace: ws.index, path: base + 'library.json' },
        { id: 'collection:' + ws.index, kind: 'collection', workspace: ws.index, path: base + 'collection.json' },
        { id: 'nineBoards:' + ws.index, kind: 'nineBoards', workspace: ws.index, path: base + 'nine-boards.json' });
      let posts;
      try { posts = await storage.listPhotoPosts(ws.workspaceId); }
      catch (error) { tasks.push({ id: 'photoPosts:' + ws.index, kind: 'photoPosts', workspace: ws.index, path: null, listError: error }); continue; }
      for (const row of posts) if (ID.test(row.id)) tasks.push({ id: 'photoPosts:' + ws.index + ':' + row.id, kind: 'photoPosts', workspace: ws.index, postId: row.id,
        title: row.title || '', status: row.status, archived: row.archived === true, path: base + 'photo-posts/' + row.id + '.zip' });
    }
    tasks.push({ id: 'accountDocuments', kind: 'accountDocuments', workspace: null, path: 'account-documents.json' });
    if (timeline) tasks.push({ id: 'timeline', kind: 'timeline', workspace: null, path: 'timeline-goals-habits.json' });
    return { workspaces, tasks };
  }
  async function readPart(task, { storage, workspaces, timeline }) {
    const ws = workspaces.find(row => row.index === task.workspace);
    if (task.listError) throw task.listError;
    if (task.kind === 'library') {
      const snapshot = await (storage.readLibraryBackupSnapshot ? storage.readLibraryBackupSnapshot(ws.workspaceId) : storage.readWorkbenchSnapshot(ws.workspaceId));
      const folders = snapshot.sourceFolders, nonempty = folders && (folders.folders.length || folders.assignments.length);
      // Same choice as the 자료·구성 screen: folders only when there is something to keep.
      return nonempty ? dep('SourceFolders').makeBackup(snapshot.bundle, snapshot.workbench, folders) : dep('Workbench').makeBackup(snapshot.bundle, snapshot.workbench);
    }
    if (task.kind === 'collection') return dep('Collection').makeBackup(await storage.readCollection(ws.workspaceId));
    if (task.kind === 'nineBoards') return dep('NineBoard').backup((await storage.readNineBoard(ws.workspaceId)).boards);
    if (task.kind === 'photoPosts') return storage.readPhotoPost(ws.workspaceId, task.postId);
    if (task.kind === 'accountDocuments') {
      const known = new Set(workspaces.map(row => row.workspaceId)), documents = [];
      for (const row of await storage.listAccountDocs()) {
        if (!known.has(row.workspaceId)) continue;
        const record = await storage.readAccountDocRecord(row.key);
        if (!record.exists) continue;
        const postId = row.prefix === 'post-evidence' ? row.key.split(':')[2] : null;
        documents.push({ prefix: row.prefix, workspaceId: row.workspaceId, ...(postId ? { postId } : {}), value: record.value });
      }
      documents.sort((a, b) => (a.workspaceId + a.prefix + (a.postId || '')).localeCompare(b.workspaceId + b.prefix + (b.postId || '')));
      return { format: DOCS_FORMAT, exportedAt: new Date().toISOString(), documents };
    }
    if (task.kind === 'timeline') return timeline();
    throw fault('unknown_part', '알 수 없는 백업 항목입니다.');
  }
  // Light count pass shown before download. Photo bytes are summed from the
  // stored Blob sizes without reading them.
  async function inventory(planned, context) {
    const rows = [];
    for (const task of planned.tasks) {
      try {
        const value = await readPart(task, { ...context, workspaces: planned.workspaces });
        if (task.kind === 'photoPosts') {
          const bytes = value.photos.reduce((sum, photo) => sum + photo.blob.size + (photo.view?.blob?.size || 0), 0);
          rows.push({ id: task.id, kind: task.kind, workspace: task.workspace, status: 'ready', counts: { posts: 1, photos: value.photos.length }, estimate: bytes + 4096 });
        } else rows.push({ id: task.id, kind: task.kind, workspace: task.workspace, status: 'ready', counts: COUNT[task.kind](value), estimate: JSON.stringify(value).length });
      } catch (error) { rows.push({ id: task.id, kind: task.kind, workspace: task.workspace, status: 'failed', error: message(error) }); }
      await pause();
    }
    return summarizeRows(rows, planned);
  }
  function summarizeRows(rows, planned) {
    const kinds = {};
    for (const row of rows) {
      const entry = kinds[row.kind] ||= { kind: row.kind, label: KINDS[row.kind].label, files: 0, failed: 0, counts: {}, estimate: 0, workspaces: new Set() };
      if (row.status === 'failed') entry.failed++;
      else { entry.files++; addCounts(entry.counts, row.counts); entry.estimate += row.estimate || 0; }
      if (row.workspace) entry.workspaces.add(row.workspace);
    }
    const list = ORDER.filter(kind => kinds[kind]).map(kind => ({ ...kinds[kind], workspaces: kinds[kind].workspaces.size }));
    return { workspaces: planned.workspaces.length, kinds: list, rows, estimate: list.reduce((sum, row) => sum + row.estimate, 0) };
  }
  const message = error => (error && typeof error.message === 'string' && error.message) || '읽지 못했습니다.';

  async function runTask(task, context) {
    const value = await readPart(task, context);
    if (task.kind === 'photoPosts') {
      const P = dep('PhotoPost'), blob = await P.backup(value), bytes = await blobBytes(blob);
      const format = value.format === 'life-photo-post-v1' ? 'life-photo-post-backup-v1' : 'life-photo-post-backup-v2';
      const counts = { posts: 1, photos: value.photos.length, views: value.photos.filter(photo => photo.view).length, attachments: (value.attachments || []).length };
      return { blob, size: bytes.byteLength, sha256: await sha256(bytes), format, formatVersion: versionOf(format), counts,
        meta: { postId: task.postId, title: value.title || '', status: value.status, archived: value.archived === true } };
    }
    const bytes = json(value);
    if (bytes.byteLength > LIMITS.json) throw fault('part_too_large', KINDS[task.kind].label + ' 파일이 64 MiB를 넘습니다.');
    return { blob: new Blob([bytes], { type: 'application/json' }), size: bytes.byteLength, sha256: await sha256(bytes), format: value.format || 'haedo-backup-v1',
      formatVersion: versionOf(value.format, value), counts: COUNT[task.kind](value) };
  }
  // Runs (or re-runs) tasks. Each failure stays per part; nothing is retried silently.
  async function collect(planned, context, { only = null, results = new Map(), onProgress = () => {}, isCurrent = () => true } = {}) {
    const tasks = planned.tasks.filter(task => !only || only.has(task.id));
    let done = 0;
    for (const task of tasks) {
      if (!isCurrent()) throw fault('backup_cancelled', '계정이나 화면이 바뀌어 백업을 멈췄습니다. 자료는 바뀌지 않았습니다.');
      onProgress({ phase: 'read', done, total: tasks.length, task });
      try { results.set(task.id, { status: 'ok', ...(await runTask(task, { ...context, workspaces: planned.workspaces })) }); }
      catch (error) { results.set(task.id, { status: 'failed', error: message(error) }); }
      done++; await pause();
    }
    onProgress({ phase: 'read', done, total: tasks.length });
    return results;
  }
  function readme(manifest) {
    const lines = ['해도 전체 백업', '', '만든 시각: ' + manifest.createdAt, '앱 버전: ' + (manifest.appVersion || '확인 불가'),
      '상태: ' + (manifest.complete ? '모든 항목 포함' : '일부 항목 빠짐 · 아래 "빠진 항목"을 확인하세요'), '',
      '이 ZIP은 하나의 형식이 아닙니다. 아래 파일마다 기존 백업 형식을 그대로 담았습니다.',
      '복원: 해도 → 설정 → 백업·복원 → 복원에서 이 ZIP을 고르면 새 자료공간 사본으로 복원합니다. 기존 자료는 바뀌지 않습니다.',
      '각 파일은 원래 화면(자료·구성 백업, 컬렉션, 9칸, 사진 글, 연표 목록)에서도 따로 복원할 수 있습니다.', '', '자료공간'];
    for (const ws of manifest.workspaces) lines.push('  ' + pad(ws.index) + ' ' + ws.title + (ws.recovery ? ' (복구 사본)' : ''));
    lines.push('', '파일 (경로 · 종류 · 형식/버전 · 개수 · 바이트 · SHA-256)');
    for (const file of manifest.files) lines.push('  ' + file.path, '    ' + KINDS[file.kind].label + ' · ' + file.format + ' v' + file.formatVersion + ' · ' + countText(file.counts) + ' · ' + file.bytes + ' · ' + file.sha256);
    if (manifest.missing.length) {
      lines.push('', '빠진 항목');
      for (const item of manifest.missing) lines.push('  ' + KINDS[item.kind].label + (item.workspace ? ' · 자료공간 ' + pad(item.workspace) : '') + (item.title ? ' · ' + item.title : '') + ' · ' + item.error);
    }
    return lines.join('\n') + '\n';
  }
  // Builds the ZIP from collected parts. A part that failed blocks a complete
  // ZIP; `partial: true` writes the rest with complete=false and lists what is missing.
  async function build(planned, results, { appVersion = null, partial = false, now = () => new Date().toISOString(), onProgress = () => {} } = {}) {
    const failed = planned.tasks.filter(task => results.get(task.id)?.status !== 'ok');
    if (failed.length && !partial) throw fault('backup_incomplete', '일부 항목을 읽지 못해 전체 백업을 만들지 않았습니다.', { failed: failed.map(task => task.id) });
    const ok = planned.tasks.filter(task => results.get(task.id)?.status === 'ok');
    if (!ok.length) throw fault('backup_empty', '담을 수 있는 항목이 없습니다.');
    const files = ok.map(task => {
      const result = results.get(task.id);
      return { path: task.path, kind: task.kind, workspace: task.workspace, ...(result.meta || {}), format: result.format, formatVersion: result.formatVersion,
        counts: result.counts, bytes: result.size, sha256: result.sha256 };
    });
    const manifest = { format: FORMAT, version: VERSION, createdAt: now(), appVersion, complete: !failed.length,
      workspaces: planned.workspaces.map(ws => ({ index: ws.index, workspaceId: ws.workspaceId, title: ws.title, recovery: ws.recovery })),
      files, missing: failed.map(task => ({ kind: task.kind, workspace: task.workspace, ...(task.postId ? { postId: task.postId, title: task.title } : {}),
        error: results.get(task.id)?.error || '읽지 못했습니다.' })) };
    const total = files.reduce((sum, file) => sum + file.bytes, 0);
    if (total > LIMITS.bundle) throw fault('backup_too_large', '백업이 3.5 GiB를 넘어 ZIP 하나로 만들 수 없습니다. 형식별로 나눠 받아 주세요.');
    const F = zip(), parts = [];
    let pending = [], pendingBytes = 0, written = 0, error = null;
    const flush = () => { if (pending.length) { parts.push(new Blob(pending)); pending = []; pendingBytes = 0; } };
    const archive = new F.Zip((cause, chunk) => {
      if (cause) { error = cause; return; }
      pending.push(chunk); pendingBytes += chunk.byteLength; written += chunk.byteLength;
      if (pendingBytes >= LIMITS.chunk) flush();
    });
    const add = (name, bytes) => { const entry = new F.ZipPassThrough(name); archive.add(entry); entry.push(bytes, true); if (error) throw error; };
    add('README.txt', encoder.encode(readme(manifest)));
    add('manifest.json', json(manifest));
    let index = 0;
    for (const task of ok) {
      onProgress({ phase: 'zip', done: index, total: ok.length, task });
      // Each part was hashed once when read; a Blob cannot change afterwards.
      const result = results.get(task.id), bytes = await blobBytes(result.blob);
      if (bytes.byteLength !== result.size) throw fault('backup_changed', '백업 중 파일 크기가 바뀌었습니다. 다시 받아 주세요.');
      add(task.path, bytes); index++;
      await pause();
    }
    archive.end(); if (error) throw error; flush();
    onProgress({ phase: 'zip', done: ok.length, total: ok.length });
    const stamp = manifest.createdAt.slice(0, 10);
    return { blob: new Blob(parts, { type: 'application/zip' }), manifest, bytes: written,
      fileName: 'haedo-backup-' + stamp + (manifest.complete ? '' : '-partial') + '.zip' };
  }

  // ---- Reading a ZIP lazily from its central directory (stored entries only) ----
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
  async function zipEntries(file) {
    const bad = () => fault('invalid_zip', 'ZIP 파일 구조를 읽지 못했습니다. 원래 파일은 그대로 두었습니다.');
    if (file.size < 22) throw bad();
    const tailSize = Math.min(file.size, 22 + 65535), tailStart = file.size - tailSize;
    const tail = await blobBytes(file.slice(tailStart)), view = new DataView(tail.buffer);
    let end = -1;
    for (let at = tail.byteLength - 22; at >= 0; at--) if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
    if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw bad();
    const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), offset = view.getUint32(end + 16, true);
    if (count !== view.getUint16(end + 8, true) || count > LIMITS.files || offset + size !== tailStart + end || size > 64 * MiB) throw bad();
    const directory = await blobBytes(file.slice(offset, offset + size)), dir = new DataView(directory.buffer), decoder = new TextDecoder('utf-8', { fatal: true });
    const entries = new Map(); let at = 0;
    for (let index = 0; index < count; index++) {
      if (at + 46 > directory.byteLength || dir.getUint32(at, true) !== 0x02014b50) throw bad();
      const flags = dir.getUint16(at + 8, true), method = dir.getUint16(at + 10, true), crc = dir.getUint32(at + 16, true);
      const compressed = dir.getUint32(at + 20, true), length = dir.getUint32(at + 24, true), nameLength = dir.getUint16(at + 28, true);
      const extra = dir.getUint16(at + 30, true), comment = dir.getUint16(at + 32, true), local = dir.getUint32(at + 42, true);
      if (method !== 0 || compressed !== length || flags & ~0x0808 || at + 46 + nameLength + extra + comment > directory.byteLength) throw fault('invalid_zip', '압축하지 않은 해도 ZIP만 열 수 있습니다.');
      let name;
      try { name = decoder.decode(directory.subarray(at + 46, at + 46 + nameLength)); } catch (_) { throw bad(); }
      if (entries.has(name) || name.includes('..') || name.startsWith('/')) throw fault('invalid_zip', '중복되거나 허용하지 않는 ZIP 경로가 있습니다.');
      entries.set(name, { name, size: length, crc, local });
      at += 46 + nameLength + extra + comment;
    }
    if (at !== directory.byteLength) throw bad();
    // Local headers decide where each entry's bytes begin; they must agree with the directory.
    const sorted = [...entries.values()].sort((a, b) => a.local - b.local);
    let previousEnd = 0;
    for (const entry of sorted) {
      if (entry.local < previousEnd || entry.local + 30 > offset) throw bad();
      const header = await blobBytes(file.slice(entry.local, entry.local + 30)), h = new DataView(header.buffer);
      if (h.getUint32(0, true) !== 0x04034b50 || h.getUint16(8, true) !== 0) throw bad();
      const nameLength = h.getUint16(26, true), extra = h.getUint16(28, true), start = entry.local + 30 + nameLength + extra;
      const nameBytes = await blobBytes(file.slice(entry.local + 30, entry.local + 30 + nameLength));
      if (decoder.decode(nameBytes) !== entry.name || start + entry.size > offset) throw bad();
      entry.blob = file.slice(start, start + entry.size);
      previousEnd = start + entry.size;
    }
    return entries;
  }
  async function entryText(entry, limit) {
    if (entry.size > limit) throw fault('part_too_large', '백업 안의 목록 파일이 너무 큽니다.');
    const bytes = await blobBytes(entry.blob);
    if (bytes.byteLength !== entry.size) throw fault('invalid_zip', 'ZIP 파일 크기가 기록과 다릅니다.');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (_) { throw fault('invalid_backup', 'UTF-8 파일을 읽지 못했습니다.'); }
  }
  function parseJson(text, label) {
    try { return JSON.parse(text); } catch (_) { throw fault('invalid_backup', label + ' JSON을 읽지 못했습니다.'); }
  }

  // ---- Opening any supported file ----
  function detectJson(data) {
    if (!plain(data)) return null;
    const format = data.format;
    if (['life-tools-backup-v1', 'life-workbench-backup-v1', dep('SourceFolders').BACKUP_FORMAT].includes(format)) return 'library';
    if (format === 'life-collection-backup-v1') return 'collection';
    if (['life-nine-board-backup-v1', 'life-nine-board-backup-v2'].includes(format)) return 'nineBoards';
    if (format === DOCS_FORMAT) return 'accountDocuments';
    if (['haedo-platform-backup-v1', 'haedo-backup-v1'].includes(format) || format === undefined && Array.isArray(data.docs)) return 'timeline';
    if (format === 'haedo-annual-plan') return 'annualPlan';
    return null;
  }
  function validateDocuments(data) {
    if (!plain(data) || data.format !== DOCS_FORMAT || !Array.isArray(data.documents) || typeof data.exportedAt !== 'string')
      throw fault('invalid_backup', '계정 설정·기록 문서 파일의 형식을 확인해 주세요.');
    for (const doc of data.documents) {
      if (!plain(doc) || ![...ACCOUNT_PREFIXES, ...WORKSPACE_PREFIXES].includes(doc.prefix) || !ID.test(doc.workspaceId || '') ||
        doc.prefix === 'post-evidence' && !ID.test(doc.postId || '') || !Object.hasOwn(doc, 'value'))
        throw fault('invalid_backup', '계정 설정·기록 문서의 항목을 확인해 주세요.');
    }
    return data;
  }
  function libraryTitle(data) { return libraryParts(data)?.bundle?.title || null; }
  async function open(file, { onProgress = () => {} } = {}) {
    if (!file || !Number.isSafeInteger(file.size) || file.size < 2) throw fault('invalid_backup', '백업 파일을 골라 주세요.');
    const head = await blobBytes(file.slice(0, 4));
    if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4) {
      if (file.size > LIMITS.bundle) throw fault('backup_too_large', '3.5 GiB 이하의 백업 ZIP을 골라 주세요.');
      const entries = await zipEntries(file), list = entries.get('manifest.json');
      if (!list) throw fault('unsupported_backup', '해도 백업 ZIP이 아닙니다. 목록 파일(manifest.json)이 없습니다.');
      const text = await entryText(list, LIMITS.manifest);
      if (crc32(encoder.encode(text)) !== list.crc) throw fault('tampered', 'manifest.json이 손상됐습니다. 이 파일은 복원하지 않았습니다.');
      const manifest = parseJson(text, '목록');
      if (manifest?.format === FORMAT) return verifyBundle(manifest, entries, onProgress);
      if (typeof manifest?.format === 'string' && manifest.format.startsWith('haedo-full-backup-'))
        throw fault('unsupported_version', '이 앱이 모르는 전체 백업 버전입니다(' + manifest.format + '). 앱을 새로 고친 뒤 다시 시도해 주세요.');
      if (PHOTO_FORMATS.includes(manifest?.format)) {
        const photos = Array.isArray(manifest.photos) ? manifest.photos : [];
        return { type: 'single', fileName: file.name || '', workspaces: [{ index: 1, workspaceId: null, title: manifest.title || '복원한 사진 글' }],
          entries: [{ kind: 'photoPosts', workspace: 1, format: manifest.format, formatVersion: versionOf(manifest.format), blob: file,
            counts: { posts: 1, photos: photos.length, views: photos.filter(photo => photo?.view).length }, title: manifest.title || '' }] };
      }
      if (manifest?.format === 'life-preservation-package-v1') return { type: 'preservation', fileName: file.name || '', file, format: manifest.format, formatVersion: 1,
        counts: { posts: Array.isArray(manifest.posts) ? manifest.posts.length : 0, sources: manifest.bundle?.sources?.length || 0 } };
      throw fault('unsupported_backup', '지원하지 않는 ZIP 형식입니다. Obsidian ZIP은 내보내기·사본 복원 화면에서 복원해 주세요.');
    }
    if (file.size > LIMITS.json) throw fault('backup_too_large', '64 MiB 이하의 JSON 백업을 골라 주세요.');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(await blobBytes(file)); } catch (_) { throw fault('invalid_backup', 'UTF-8 JSON 백업을 읽지 못했습니다.'); }
    const data = parseJson(text, '백업');
    const kind = detectJson(data);
    if (!kind) throw fault('unsupported_backup', '지원하지 않는 백업 형식입니다. 해도에서 받은 백업 파일을 골라 주세요.');
    const format = data.format || 'haedo-backup-v1';
    if (kind === 'timeline' || kind === 'annualPlan') return { type: 'external', kind, fileName: file.name || '', format, formatVersion: versionOf(format, data),
      counts: kind === 'timeline' ? COUNT.timeline(data) : {}, text };
    if (kind === 'accountDocuments') validateDocuments(data);
    const workspaces = kind === 'accountDocuments'
      ? [...new Set(data.documents.map(doc => doc.workspaceId))].map((workspaceId, i) => ({ index: i + 1, workspaceId, title: '복원한 설정 · ' + (i + 1) }))
      : [{ index: 1, workspaceId: libraryParts(data)?.bundle?.workspaceId || null, title: libraryTitle(data) || '복원한 ' + KINDS[kind].label }];
    let counts;
    try { counts = COUNT[kind](data); } catch (_) { throw fault('invalid_backup', KINDS[kind].label + ' 파일의 형식을 확인해 주세요.'); }
    return { type: 'single', fileName: file.name || '', workspaces,
      entries: [{ kind, workspace: kind === 'accountDocuments' ? null : 1, format, formatVersion: versionOf(format, data), counts, data }] };
  }
  async function verifyBundle(manifest, entries, onProgress) {
    const invalid = text => fault('invalid_backup', text);
    if (!plain(manifest) || manifest.version !== VERSION) throw fault('unsupported_version', '이 앱이 모르는 전체 백업 버전입니다. 앱을 새로 고친 뒤 다시 시도해 주세요.');
    const keys = ['format', 'version', 'createdAt', 'appVersion', 'complete', 'workspaces', 'files', 'missing'];
    if (Object.keys(manifest).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(manifest, key))) throw invalid('전체 백업 목록의 항목을 확인해 주세요.');
    if (!Array.isArray(manifest.workspaces) || !Array.isArray(manifest.files) || !Array.isArray(manifest.missing) || typeof manifest.complete !== 'boolean' ||
      manifest.complete !== !manifest.missing.length || !Number.isFinite(Date.parse(manifest.createdAt))) throw invalid('전체 백업 목록의 항목을 확인해 주세요.');
    const indexes = new Set();
    for (const ws of manifest.workspaces) {
      if (!plain(ws) || !Number.isSafeInteger(ws.index) || ws.index < 1 || indexes.has(ws.index) || typeof ws.title !== 'string' || !ID.test(ws.workspaceId || '')) throw invalid('자료공간 목록을 확인해 주세요.');
      indexes.add(ws.index);
    }
    const expected = new Set(['README.txt', 'manifest.json']);
    for (const file of manifest.files) {
      if (!plain(file) || !KINDS[file.kind] || !ORDER.includes(file.kind) || typeof file.path !== 'string' || !BUNDLE_PATH.test(file.path) || expected.has(file.path) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[0-9a-f]{64}$/.test(file.sha256 || '') || typeof file.format !== 'string' ||
        (file.workspace !== null && !indexes.has(file.workspace)) || (file.workspace === null) !== ['accountDocuments', 'timeline'].includes(file.kind))
        throw invalid('파일 목록의 항목을 확인해 주세요.');
      const prefix = file.workspace ? 'workspaces/' + pad(file.workspace) + '/' : null;
      if ((prefix ? !file.path.startsWith(prefix) : file.path.startsWith('workspaces/')) || !PATH_KIND[file.kind].test(file.path))
        throw invalid('파일 경로와 자료공간·종류가 맞지 않습니다.');
      if (file.kind === 'photoPosts' && (!ID.test(file.postId || '') || !['saved', 'draft'].includes(file.status) || typeof file.archived !== 'boolean' ||
        !file.path.endsWith('/' + file.postId + '.zip'))) throw invalid('사진 글 항목을 확인해 주세요.');
      expected.add(file.path);
    }
    if (entries.size !== expected.size || [...entries.keys()].some(name => !expected.has(name)))
      throw fault('tampered', 'ZIP 안의 파일이 목록과 다릅니다. 이 파일은 복원하지 않았습니다.');
    const result = [];
    let done = 0;
    for (const file of manifest.files) {
      onProgress({ phase: 'verify', done, total: manifest.files.length });
      const entry = entries.get(file.path), bytes = await blobBytes(entry.blob);
      if (bytes.byteLength !== file.bytes || await sha256(bytes) !== file.sha256)
        throw fault('tampered', file.path + '의 내용이 목록의 SHA-256과 다릅니다. 이 파일은 복원하지 않았습니다.');
      const item = { ...file, blob: entry.blob };
      if (file.path.endsWith('.json')) {
        const data = parseJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), KINDS[file.kind].label);
        if ((data.format || 'haedo-backup-v1') !== file.format || detectJson(data) !== file.kind) throw invalid(file.path + '의 형식이 목록과 다릅니다.');
        if (file.kind === 'accountDocuments') validateDocuments(data);
        item.data = data;
      } else if (!PHOTO_FORMATS.includes(file.format)) throw invalid(file.path + '의 형식이 목록과 다릅니다.');
      result.push(item); done++;
      await pause();
    }
    onProgress({ phase: 'verify', done, total: manifest.files.length });
    return { type: 'bundle', manifest, workspaces: clone(manifest.workspaces), entries: result };
  }
  function summarize(opened) {
    if (opened.type !== 'single' && opened.type !== 'bundle') return [];
    const kinds = {};
    for (const entry of opened.entries) {
      const row = kinds[entry.kind] ||= { kind: entry.kind, label: KINDS[entry.kind].label, files: 0, counts: {}, workspaces: new Set(), formats: new Set(), restorable: entry.kind !== 'timeline' };
      row.files++; addCounts(row.counts, entry.counts); row.formats.add(entry.format + ' v' + entry.formatVersion);
      if (entry.workspace) row.workspaces.add(entry.workspace);
      if (entry.kind === 'accountDocuments') for (const doc of entry.data.documents) {
        const ws = opened.workspaces.find(item => item.workspaceId === doc.workspaceId);
        if (ws) row.workspaces.add(ws.index);
      }
    }
    return ORDER.filter(kind => kinds[kind]).map(kind => ({ ...kinds[kind], workspaces: kinds[kind].workspaces.size, formats: [...kinds[kind].formats] }));
  }

  // ---- Restore: one new workspace copy per original workspace ----
  function remap(value, map) {
    if (typeof value === 'string') return map.has(value) ? map.get(value) : value;
    if (Array.isArray(value)) return value.map(item => remap(item, map));
    if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item, map)]));
    return value;
  }
  function libraryMapping(original, restored) {
    // Core.restoreBackup keeps each collection's order while issuing new IDs.
    const map = new Map([[original.workspaceId, restored.workspaceId]]);
    for (const name of ['sources', 'sourceVersions', 'records', 'links', 'resumeHints', 'tombstones']) {
      const before = original[name] || [], after = restored[name] || [];
      if (before.length !== after.length) throw fault('restore_mapping', '복원한 자료의 순서를 확인하지 못했습니다.');
      before.forEach((item, index) => map.set(item.id, after[index].id));
    }
    return map;
  }
  async function installLibrary(storage, data) {
    if (data.format === 'life-tools-backup-v1') {
      const bundle = await dep('Core').restoreBackup(clone(data));
      const installed = await storage.installWorkspace(bundle);
      return { bundle: installed, map: libraryMapping(data.workspace, installed) };
    }
    const material = data.format === dep('SourceFolders').BACKUP_FORMAT;
    const candidate = material ? await dep('SourceFolders').restoreBackup(clone(data)) : await dep('Workbench').restoreBackup(clone(data));
    // Same choice as the 자료·구성 screen: folders and library commit together.
    const installed = candidate.sourceFolders && storage.installLibraryCopy ? await storage.installLibraryCopy(candidate) : await storage.installWorkbenchCopy({ bundle: candidate.bundle, workbench: candidate.workbench });
    const original = material ? data.libraryBackup.sourceBackup.workspace : data.sourceBackup.workspace;
    return { bundle: installed.bundle, map: libraryMapping(original, installed.bundle) };
  }
  function defaultVerifyPhoto() {
    if (!root.document || typeof root.File !== 'function') return null;
    // Same check as the photo editor's ZIP restore: the displayed image must decode at its recorded size.
    return async candidate => {
      const P = dep('PhotoPost');
      for (const p of candidate.photos) {
        const shown = p.view || p;
        const checked = await P.readPhoto(new root.File([shown.blob], p.name, { type: shown.type }), () => p.id);
        if (checked.width !== shown.width || checked.height !== shown.height) throw fault('photo_mismatch', '사진 해상도 정보가 실제 원본과 다릅니다.');
      }
    };
  }
  async function entryData(entry) {
    if (entry.data !== undefined) return entry.data;
    return parseJson(await entryText(entry, LIMITS.json), KINDS[entry.kind].label);
  }
  // `select(kind, workspaceIndex, entry)` decides what to restore; `targets`
  // carries copies made by an earlier run so a retry fills the same new copy.
  async function restore(opened, { storage, kinds, select = null, targets = new Map(), makeId = () => dep('Core').id(),
    verifyPhoto = defaultVerifyPhoto(), onProgress = () => {}, isCurrent = () => true } = {}) {
    if (!storage?.isAccountScoped || !storage.account) throw fault('auth_scope_required', '로그인한 계정에서 복원해 주세요.');
    if (opened.type !== 'bundle' && opened.type !== 'single') throw fault('unsupported_backup', '이 화면에서 복원할 수 없는 파일입니다.');
    const wanted = (kind, ws, entry) => kinds.has(kind) && (!select || select(kind, ws, entry));
    const guard = () => { if (!isCurrent()) throw fault('restore_cancelled', '계정이나 화면이 바뀌어 복원을 멈췄습니다. 이미 만든 새 사본은 그대로 있습니다.'); };
    const docsEntry = opened.entries.find(entry => entry.kind === 'accountDocuments');
    const documents = docsEntry ? (await entryData(docsEntry)).documents : [];
    const previousActive = await storage.getActive().catch(() => null);
    const report = { workspaces: [], items: [] };
    const record = (kind, ws, status, details = {}) => { const item = { kind, label: KINDS[kind].label, workspace: ws.index, workspaceTitle: ws.title, status, ...details }; report.items.push(item); return item; };
    const work = opened.workspaces.map(ws => {
      const own = opened.entries.filter(entry => entry.workspace === ws.index && wanted(entry.kind, ws.index, entry));
      const docs = wanted('accountDocuments', ws.index, null) ? documents.filter(doc => doc.workspaceId === ws.workspaceId && doc.prefix !== 'post-evidence') : [];
      return { ws, own, docs };
    }).filter(item => item.own.length || item.docs.length);
    const total = work.reduce((sum, item) => sum + item.own.length + (item.docs.length ? 1 : 0), 0);
    let done = 0;
    const step = label => onProgress({ phase: 'restore', done: done++, total, label });
    try {
      for (const { ws, own, docs } of work) {
        guard();
        const target = targets.get(ws.index) || { workspaceId: null, title: ws.title, map: new Map(), posts: new Map(), library: false };
        targets.set(ws.index, target);
        const summary = { index: ws.index, title: ws.title, targetId: target.workspaceId, targetTitle: target.title };
        report.workspaces.push(summary);
        const library = own.find(entry => entry.kind === 'library');
        if (library) {
          step(KINDS.library.label);
          try {
            const data = await entryData(library); guard();
            const installed = await installLibrary(storage, data);
            target.workspaceId = installed.bundle.workspaceId; target.title = installed.bundle.title;
            for (const [from, to] of installed.map) target.map.set(from, to);
            target.library = true;
            if (ws.workspaceId) target.map.set(ws.workspaceId, target.workspaceId);
            record('library', ws, 'restored', { targetId: target.workspaceId, counts: COUNT.library(data) });
          } catch (error) {
            record('library', ws, 'failed', { message: message(error) });
            // Without the library, references of the other parts would point nowhere.
            for (const entry of own.filter(item => item !== library)) record(entry.kind, ws, 'skipped', { postId: entry.postId, title: entry.title,
              message: '자료·구성 복원이 실패해 이 자료공간의 나머지 형식도 복원하지 않았습니다.' });
            if (docs.length) record('accountDocuments', ws, 'skipped', { message: '자료·구성 복원이 실패해 설정 문서도 복원하지 않았습니다.' });
            summary.status = 'failed';
            continue;
          }
        }
        if (!target.workspaceId) {
          const created = await storage.createWorkspace(ws.title);
          target.workspaceId = created.workspaceId; target.title = created.title;
          if (ws.workspaceId) target.map.set(ws.workspaceId, target.workspaceId);
        }
        summary.targetId = target.workspaceId; summary.targetTitle = target.title;
        const id = target.workspaceId;
        for (const entry of own.filter(item => item.kind === 'collection')) {
          step(KINDS.collection.label); guard();
          try {
            const data = await entryData(entry), C = dep('Collection'), state = await storage.readCollection(id);
            const next = C.appendBackup(state, data, makeId);
            await storage.saveCollection(id, next, state.revision);
            record('collection', ws, 'restored', { targetId: id, counts: COUNT.collection(data) });
          } catch (error) { record('collection', ws, 'failed', { message: message(error) }); }
        }
        for (const entry of own.filter(item => item.kind === 'photoPosts')) {
          step(KINDS.photoPosts.label); guard();
          try {
            const P = dep('PhotoPost'), candidate = await P.readBackup(entry.blob, makeId);
            if (verifyPhoto) await verifyPhoto(candidate);
            // The bundle's manifest keeps each post's state; the ZIP alone restores a draft as before.
            if (entry.status === 'saved') candidate.status = 'saved';
            if (entry.archived === true && candidate.format === 'life-photo-post-v2') candidate.archived = true;
            const evidence = entry.postId && documents.find(doc => doc.prefix === 'post-evidence' && doc.workspaceId === ws.workspaceId && doc.postId === entry.postId);
            let saved, evidenceNote = null;
            if (evidence?.value?.refs?.length && target.library) {
              const refs = remap(evidence.value.refs, target.map);
              try { saved = await storage.savePhotoPostWithEvidence(id, candidate, 0, refs, 0); }
              catch (error) { evidenceNote = '인용 근거 ' + refs.length + '개는 원문과 맞지 않아 연결하지 않았습니다.'; }
            } else if (evidence?.value?.refs?.length) evidenceNote = '자료·구성을 함께 복원하지 않아 인용 근거 ' + evidence.value.refs.length + '개를 연결하지 않았습니다.';
            if (!saved) saved = await storage.savePhotoPost(id, candidate, 0);
            if (entry.postId) { target.posts.set(entry.postId, saved.id); target.map.set(entry.postId, saved.id); }
            record('photoPosts', ws, 'restored', { targetId: id, postId: entry.postId, newPostId: saved.id, title: saved.title, postStatus: saved.status,
              counts: entry.counts, ...(evidenceNote ? { message: evidenceNote } : {}) });
          } catch (error) { record('photoPosts', ws, 'failed', { postId: entry.postId, title: entry.title, message: message(error) }); }
        }
        for (const entry of own.filter(item => item.kind === 'nineBoards')) {
          step(KINDS.nineBoards.label); guard();
          try {
            const N = dep('NineBoard'), incoming = N.readBackup(await entryData(entry));
            // Exact source versions point to their copies in this new workspace when they came along.
            const added = N.copies(remap(incoming, target.map), makeId), state = await storage.readNineBoard(id);
            const next = { ...state, format: N.hasReferences(state.boards.concat(added)) ? 'life-nine-board-v2' : state.format, boards: state.boards.concat(added) };
            N.validate(next);
            if (added.length) await storage.saveNineBoardCopy(id, next, next.revision);
            record('nineBoards', ws, 'restored', { targetId: id, counts: COUNT.nineBoards({ boards: added }) });
          } catch (error) { record('nineBoards', ws, 'failed', { message: message(error) }); }
        }
        if (docs.length) {
          step(KINDS.accountDocuments.label); guard();
          let applied = 0, skipped = 0, rejected = 0; const notes = new Set();
          for (const doc of docs) {
            if (NOT_RESTORED[doc.prefix]) { skipped++; notes.add(NOT_RESTORED[doc.prefix]); continue; }
            try {
              const result = await storage.applyAccountDoc(docKey(storage, doc.prefix, id), { value: remap(doc.value, target.map), expectedHash: null });
              if (result.status === 'applied') applied++;
              else if (result.status === 'changed') { skipped++; notes.add('새 사본에 이미 있던 문서는 덮어쓰지 않았습니다.'); }
              else { rejected++; notes.add(result.error?.message || '형식을 확인하지 못한 문서가 있습니다.'); }
            } catch (error) { rejected++; notes.add(message(error)); }
          }
          record('accountDocuments', ws, rejected && !applied ? 'failed' : 'restored', { targetId: id, counts: { documents: applied }, skipped, rejected,
            ...(notes.size ? { message: [...notes].join(' ') } : {}) });
        }
      }
    } finally {
      // Installing a copy marks it active; keep the workspace the person was using.
      if (previousActive) await storage.setActive(previousActive).catch(() => {});
      onProgress({ phase: 'restore', done: total, total });
    }
    return report;
  }
  async function appVersion() {
    try {
      const keys = await root.caches?.keys?.();
      const versions = (keys || []).map(key => /^haedo-v(\d+)$/.exec(key)?.[1]).filter(Boolean).map(Number);
      return versions.length ? 'haedo-v' + Math.max(...versions) : null;
    } catch (_) { return null; }
  }
  return Object.freeze({ FORMAT, VERSION, DOCS_FORMAT, LIMITS, KINDS, ORDER, plan, inventory, collect, build, open, summarize, restore,
    timelineSnapshot, countText, appVersion, zipEntries, docKey });
});
